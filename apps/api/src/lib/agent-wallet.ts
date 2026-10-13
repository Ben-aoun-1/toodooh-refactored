import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { agentCommissionLines, agentPayouts, agents, notifications, users } from '../db/schema.js';

import { agentRibState } from './agent-sheet.js';

// AGT-3 (agent specs v1.0 §10 « Versements », rulings Q3 A + Q5 A) — the agent wallet and its
// monthly payouts, one home.
//   cumulés  = Σ acquired commission (regularisation lines are signed)
//   actuel   = cumulés − Σ payouts 'effectue'
//   prévu    = Σ forecast of the lines still 'previsionnel'
// A month's payout is prepared in the hub for every positive balance not yet prepared, with no
// threshold; without a VALIDATED RIB the balance waits for the next month. A Screencaster agent's
// payout needs his invoice before the admin can mark it 'effectue' — the only step that debits.

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export interface AgentWallet {
  cumulative_tnd: number;
  paid_tnd: number;
  balance_tnd: number;
  forecast_tnd: number;
  /** Acquired but in no payout yet (what the next preparation would take). */
  unprepared_tnd: number;
}

export const agentWallet = async (agentUserId: string): Promise<AgentWallet> => {
  const [lines] = await db
    .select({
      acquired: sql<string>`coalesce(sum(${agentCommissionLines.acquiredTnd}) filter (where ${agentCommissionLines.status} = 'acquise'), 0)`,
      forecast: sql<string>`coalesce(sum(${agentCommissionLines.forecastTnd}) filter (where ${agentCommissionLines.status} = 'previsionnel'), 0)`,
    })
    .from(agentCommissionLines)
    .where(eq(agentCommissionLines.agentUserId, agentUserId));
  const [payouts] = await db
    .select({
      paid: sql<string>`coalesce(sum(${agentPayouts.amountTnd}) filter (where ${agentPayouts.status} = 'effectue'), 0)`,
      all: sql<string>`coalesce(sum(${agentPayouts.amountTnd}), 0)`,
    })
    .from(agentPayouts)
    .where(eq(agentPayouts.agentUserId, agentUserId));
  const cumulative = Number(lines?.acquired ?? 0);
  const paid = Number(payouts?.paid ?? 0);
  return {
    cumulative_tnd: round4(cumulative),
    paid_tnd: round4(paid),
    balance_tnd: round4(cumulative - paid),
    forecast_tnd: round4(Number(lines?.forecast ?? 0)),
    unprepared_tnd: round4(cumulative - Number(payouts?.all ?? 0)),
  };
};

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** « octobre 2026 » from '2026-10'. */
export const monthLabelFr = (month: string): string =>
  format(parseISO(`${month}-01`), 'MMMM yyyy', { locale: fr });

export interface PreparationResult {
  prepared: { agent_user_id: string; amount_tnd: number }[];
  waiting_rib: string[];
  already_prepared: string[];
}

/** Prepare `month`'s payouts for every agent with an unprepared positive balance. */
export const prepareAgentPayouts = async (
  month: string,
  preparedBy: string | null,
): Promise<PreparationResult> => {
  const result: PreparationResult = { prepared: [], waiting_rib: [], already_prepared: [] };
  const all = await db.select({ userId: agents.userId }).from(agents);
  for (const { userId } of all) {
    const wallet = await agentWallet(userId);
    if (wallet.unprepared_tnd < 0.001) continue;
    if (!(await agentRibState(userId)).validated) {
      result.waiting_rib.push(userId);
      continue;
    }
    const inserted = await db
      .insert(agentPayouts)
      .values({
        agentUserId: userId,
        month,
        amountTnd: String(wallet.unprepared_tnd),
        preparedBy,
      })
      .onConflictDoNothing()
      .returning({ id: agentPayouts.id });
    if (inserted.length === 0) result.already_prepared.push(userId);
    else result.prepared.push({ agent_user_id: userId, amount_tnd: wallet.unprepared_tnd });
  }
  return result;
};

export type MarkPaidResult =
  | { ok: true }
  | { ok: false; error: 'NOT_FOUND' | 'ALREADY_PAID' | 'INVOICE_REQUIRED' };

/** The admin marks a payout done: the wallet is debited and the agent notified. */
export const markAgentPayoutPaid = async (
  payoutId: string,
  paidBy: string | null,
  transferDate: string,
): Promise<MarkPaidResult> => {
  const [row] = await db
    .select({ payout: agentPayouts, role: users.role })
    .from(agentPayouts)
    .innerJoin(users, eq(users.id, agentPayouts.agentUserId))
    .where(eq(agentPayouts.id, payoutId))
    .limit(1);
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  if (row.payout.status === 'effectue') return { ok: false, error: 'ALREADY_PAID' };
  if (row.role === 'screencast_agent' && !row.payout.invoiceKey) {
    return { ok: false, error: 'INVOICE_REQUIRED' };
  }
  const done = await db.transaction(async (tx) => {
    const updated = await tx
      .update(agentPayouts)
      .set({ status: 'effectue', paidAt: new Date(), paidBy, transferDate })
      .where(and(eq(agentPayouts.id, payoutId), eq(agentPayouts.status, 'en_preparation')))
      .returning({ id: agentPayouts.id });
    if (updated.length === 0) return false;
    const amount = Number(row.payout.amountTnd).toLocaleString('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
    await tx.insert(notifications).values({
      userId: row.payout.agentUserId,
      type: 'agent_payout_done',
      title: `Nouveau versement effectué pour le mois de ${monthLabelFr(row.payout.month)}`,
      body: `${amount} TND ont été virés sur votre RIB.`,
    });
    return true;
  });
  return done ? { ok: true } : { ok: false, error: 'ALREADY_PAID' };
};
