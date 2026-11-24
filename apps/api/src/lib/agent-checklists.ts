import { and, desc, eq, inArray, ne } from 'drizzle-orm';

import { db } from '../db/client.js';
import { type AgentChecklist, agentChecklists, agents, notifications } from '../db/schema.js';
import { env } from '../env.js';

import {
  type Answers,
  QUESTIONS,
  checklistResult,
  firstMissing,
  renderAnswers,
} from './checklist-model.js';
import { userLabelById } from './user-label.js';
import { decryptWifiPassword, encryptWifiPassword } from './wifi-crypto.js';

// Mariem 12/11/2026 (Agent Screenhost spec VF §11, Hub spec « Checklists ») — the qualification
// fiches, one home. The agent fills a draft (saved as he types), sends it to the manager; the
// result that travels with it is computed HERE from the stored answers. The manager decides in
// the Hub, which calls decideChecklist once: validated or refused, final.

const WIFI_FIELD = 'wifi_mdp';
const MAX_TEXT = 500;

/** Every key an answer may carry: question ids, field ids and their « _autre » precision. */
const ANSWER_KEYS: ReadonlySet<string> = new Set(
  QUESTIONS.flatMap((q) => [q.id, `${q.id}_autre`, ...(q.fields ?? []).map((f) => f.id)]),
);

/** Keep known keys only, trimmed strings (or lists of strings), nothing empty. */
export const sanitizeAnswers = (raw: unknown): Record<string, string | string[]> => {
  const out: Record<string, string | string[]> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!ANSWER_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      const v = value.trim().slice(0, MAX_TEXT);
      if (v) out[key] = v;
    } else if (Array.isArray(value)) {
      const v = value
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim().slice(0, MAX_TEXT))
        .slice(0, 30);
      if (v.length) out[key] = v;
    }
  }
  return out;
};

/** The answers as the model reads them: the Wi-Fi password back in its field. */
const fullAnswers = (row: AgentChecklist): Answers => ({
  ...row.answers,
  ...(row.wifiPasswordEncrypted
    ? { [WIFI_FIELD]: decryptWifiPassword(row.wifiPasswordEncrypted) }
    : {}),
});

const text = (a: Answers, id: string): string | null => {
  const v = a[id];
  return typeof v === 'string' && v ? v : null;
};

export interface MyChecklistRow {
  id: string;
  status: AgentChecklist['status'];
  name: string | null;
  category: string | null;
  governorate: string | null;
  delegation: string | null;
  created_at: string;
  result: AgentChecklist['result'];
  agent_opinion: AgentChecklist['agentOpinion'];
}

const myRow = (r: AgentChecklist): MyChecklistRow => ({
  id: r.id,
  status: r.status,
  name: r.name,
  category: r.category,
  governorate: r.governorate,
  delegation: r.delegation,
  created_at: r.createdAt.toISOString(),
  result: r.status === 'draft' ? null : r.result,
  agent_opinion: r.agentOpinion,
});

export const myChecklists = async (agentUserId: string): Promise<MyChecklistRow[]> =>
  (
    await db
      .select()
      .from(agentChecklists)
      .where(eq(agentChecklists.agentUserId, agentUserId))
      .orderBy(desc(agentChecklists.createdAt))
  ).map(myRow);

const mine = async (agentUserId: string, id: string): Promise<AgentChecklist | null> => {
  const [row] = await db
    .select()
    .from(agentChecklists)
    .where(and(eq(agentChecklists.id, id), eq(agentChecklists.agentUserId, agentUserId)))
    .limit(1);
  return row ?? null;
};

export interface MyChecklist extends MyChecklistRow {
  answers: Answers;
  result_detail: AgentChecklist['resultDetail'];
}

export const myChecklist = async (agentUserId: string, id: string): Promise<MyChecklist | null> => {
  const row = await mine(agentUserId, id);
  return row ? { ...myRow(row), answers: fullAnswers(row), result_detail: row.resultDetail } : null;
};

export const createChecklist = async (agentUserId: string): Promise<{ id: string }> => {
  const [row] = await db
    .insert(agentChecklists)
    .values({ agentUserId })
    .returning({ id: agentChecklists.id });
  if (!row) throw new Error('checklist insert failed');
  return row;
};

/** The columns derived from the answers (the list reads them without opening the answers). */
const derived = (a: Answers) => ({
  name: text(a, 'nom'),
  category: text(a, 'categorie'),
  governorate: text(a, 'gouvernorat'),
  delegation: text(a, 'quartier'),
  agentOpinion:
    text(a, 'avis') === 'oui'
      ? ('oui' as const)
      : text(a, 'avis') === 'non'
        ? ('non' as const)
        : null,
});

export type SaveResult = { ok: true } | { ok: false; error: 'NOT_FOUND' | 'NOT_A_DRAFT' };

/** Autosave: replace the draft's answers. Only the agent's own draft can change. */
export const saveChecklist = async (
  agentUserId: string,
  id: string,
  raw: unknown,
  now: Date = new Date(),
): Promise<SaveResult> => {
  const row = await mine(agentUserId, id);
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  const answers = sanitizeAnswers(raw);
  const wifi = typeof answers[WIFI_FIELD] === 'string' ? answers[WIFI_FIELD] : null;
  delete answers[WIFI_FIELD];
  const done = await db
    .update(agentChecklists)
    .set({
      answers,
      wifiPasswordEncrypted: wifi ? encryptWifiPassword(wifi) : null,
      ...derived(answers),
      updatedAt: now,
    })
    .where(and(eq(agentChecklists.id, id), eq(agentChecklists.status, 'draft')))
    .returning({ id: agentChecklists.id });
  return done.length ? { ok: true } : { ok: false, error: 'NOT_A_DRAFT' };
};

export const deleteDraft = async (agentUserId: string, id: string): Promise<boolean> =>
  (
    await db
      .delete(agentChecklists)
      .where(
        and(
          eq(agentChecklists.id, id),
          eq(agentChecklists.agentUserId, agentUserId),
          eq(agentChecklists.status, 'draft'),
        ),
      )
      .returning({ id: agentChecklists.id })
  ).length > 0;

export type SendResult =
  | { ok: true; checklist: AgentChecklist }
  | { ok: false; error: 'NOT_FOUND' | 'NOT_A_DRAFT' }
  | { ok: false; error: 'INCOMPLETE'; question: string };

/** « Envoyer au manager »: every visible question answered, the result computed and frozen. */
export const sendChecklist = async (
  agentUserId: string,
  id: string,
  now: Date = new Date(),
): Promise<SendResult> => {
  const row = await mine(agentUserId, id);
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  if (row.status !== 'draft') return { ok: false, error: 'NOT_A_DRAFT' };
  const answers = fullAnswers(row);
  const missing = firstMissing(answers);
  if (missing) return { ok: false, error: 'INCOMPLETE', question: missing.id };
  const { res, ...detail } = checklistResult(answers);
  const [agent] = await db
    .select({ code: agents.code })
    .from(agents)
    .where(eq(agents.userId, agentUserId))
    .limit(1);
  const [sent] = await db
    .update(agentChecklists)
    .set({
      status: 'sent',
      result: res,
      resultDetail: detail,
      ...derived(answers),
      agentName: await userLabelById(agentUserId),
      agentCode: agent?.code ?? null,
      sentAt: now,
      updatedAt: now,
    })
    .where(and(eq(agentChecklists.id, id), eq(agentChecklists.status, 'draft')))
    .returning();
  return sent ? { ok: true, checklist: sent } : { ok: false, error: 'NOT_A_DRAFT' };
};

/** Tell the Hub's managers a fiche waits for them. Best-effort: the fiche is in their list anyway. */
export const pushChecklistSubmitted = async (row: AgentChecklist): Promise<boolean> => {
  if (!env.WEDOOH_INGEST_URL || !env.TOODOOH_SYNC_KEY) return false;
  try {
    const res = await fetch(`${env.WEDOOH_INGEST_URL}/api/sync/checklist-submitted`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.TOODOOH_SYNC_KEY },
      body: JSON.stringify({
        checklist_id: row.id,
        name: row.name ?? 'Sans nom',
        agent_name: row.agentName ?? '',
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

// ── the Hub's window (manager and admin) ───────────────────────────────────────────────────

export interface HubChecklistRow {
  id: string;
  name: string;
  category: string;
  governorate: string;
  delegation: string | null;
  agent_name: string;
  agent_code: string | null;
  result: 'elig' | 'non' | 'inc';
  agent_opinion: 'oui' | 'non' | null;
  status: 'sent' | 'validated' | 'refused';
  sent_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  manager_comment: string | null;
}

const hubRow = (r: AgentChecklist): HubChecklistRow => ({
  id: r.id,
  name: r.name ?? 'Sans nom',
  category: r.category ?? '',
  governorate: r.governorate ?? '',
  delegation: r.delegation,
  agent_name: r.agentName ?? '',
  agent_code: r.agentCode,
  result: r.result ?? 'inc',
  agent_opinion: r.agentOpinion,
  status: r.status === 'draft' ? 'sent' : r.status,
  sent_at: (r.sentAt ?? r.createdAt).toISOString(),
  decided_at: r.decidedAt?.toISOString() ?? null,
  decided_by_name: r.decidedByName,
  manager_comment: r.managerComment,
});

/** Fiches sent to the manager (never a draft); `decided` narrows to validated and refused. */
export const hubChecklists = async (scope: 'all' | 'decided'): Promise<HubChecklistRow[]> =>
  (
    await db
      .select()
      .from(agentChecklists)
      .where(
        scope === 'decided'
          ? inArray(agentChecklists.status, ['validated', 'refused'])
          : ne(agentChecklists.status, 'draft'),
      )
      .orderBy(desc(agentChecklists.sentAt))
  ).map(hubRow);

const sentRow = async (id: string): Promise<AgentChecklist | null> => {
  const [row] = await db
    .select()
    .from(agentChecklists)
    .where(and(eq(agentChecklists.id, id), ne(agentChecklists.status, 'draft')))
    .limit(1);
  return row ?? null;
};

/** One fiche for the Hub: every answer rendered as label / value, the result, the opinion. */
export const hubChecklist = async (id: string) => {
  const row = await sentRow(id);
  if (!row) return null;
  const answers = fullAnswers(row);
  const { pages, hidden_pages } = renderAnswers(answers);
  const d = row.resultDetail;
  return {
    ...hubRow(row),
    agent_comment: text(answers, 'avis_com'),
    pages,
    hidden_pages,
    result_detail: {
      motifs: d?.motifs ?? [],
      conditions: d?.cond ?? [],
      verifier: d?.verif ?? [],
      signaux: d?.sig ?? [],
    },
  };
};

export const ALREADY_DECIDED = 'Cette fiche a déjà reçu une décision';

export type DecideResult =
  | { ok: true; checklist: HubChecklistRow }
  | { ok: false; error: 'NOT_FOUND' | 'ALREADY_DECIDED' };

/**
 * The manager's decision, written once. The same decision repeated answers the stored fiche
 * (a retried call); a different one is refused: the decision is final.
 */
export const decideChecklist = async (
  id: string,
  decision: 'validated' | 'refused',
  comment: string | null,
  manager: { hub_user_id: number; name: string },
  now: Date = new Date(),
): Promise<DecideResult> => {
  const [done] = await db
    .update(agentChecklists)
    .set({
      status: decision,
      decidedAt: now,
      decidedByHubUserId: manager.hub_user_id,
      decidedByName: manager.name,
      managerComment: comment,
      updatedAt: now,
    })
    .where(and(eq(agentChecklists.id, id), eq(agentChecklists.status, 'sent')))
    .returning();
  if (!done) {
    const row = await sentRow(id);
    if (!row) return { ok: false, error: 'NOT_FOUND' };
    return row.status === decision
      ? { ok: true, checklist: hubRow(row) }
      : { ok: false, error: 'ALREADY_DECIDED' };
  }
  if (done.agentUserId) {
    const name = done.name ?? 'Sans nom';
    await db.insert(notifications).values({
      userId: done.agentUserId,
      type: decision === 'validated' ? 'agent_checklist_validated' : 'agent_checklist_refused',
      title:
        decision === 'validated'
          ? `Fiche validée éligible par le manager : ${name}`
          : `Fiche refusée par le manager : ${name}`,
      body: comment ?? 'Consultez la fiche dans votre onglet Checklist.',
      link: '/agent/checklist',
    });
  }
  return { ok: true, checklist: hubRow(done) };
};
