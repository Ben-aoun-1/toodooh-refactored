import { sql } from 'drizzle-orm';

import { db } from '../../db/client.js';

// DEL-2 (Mariem's sheet row 12, operator ruling 2026-10-28 « both, superadmin choice ») — has
// this account ever DONE anything? An ADMIN may delete only an account with no activity (an
// erroneous signup, a duplicate); otherwise the deletion is refused and deactivation offered. A
// SUPERADMIN may still force the complete DEL-1 deletion.
//
// Activity = any trace of business: a campaign beyond a draft, an allocation on one of the
// account's venues, an airing, a payout or reversement line, an invoice or facture, money in
// (a recharge, a wallet adjustment), an agent commission.

export interface AccountActivity {
  campaigns: number;
  allocations: number;
  airings: number;
  payouts: number;
  invoices: number;
  money: number;
}

export const hasActivity = (a: AccountActivity): boolean =>
  Object.values(a).some((n) => n > 0);

/** The activity counts of one account (all zero = deletable by an admin). */
export async function accountActivity(userId: string): Promise<AccountActivity> {
  const rows = await db.execute<{ [K in keyof AccountActivity]: string }>(sql`
    WITH venues AS (SELECT id FROM screenhosts WHERE owner_id = ${userId}),
         own_campaigns AS (SELECT id FROM campaigns WHERE advertiser_id = ${userId})
    SELECT
      (SELECT count(*) FROM campaigns WHERE advertiser_id = ${userId} AND status <> 'draft')
        AS campaigns,
      (SELECT count(*) FROM campaign_dispatch_allocation
        WHERE screenhost_id IN (SELECT id FROM venues)) AS allocations,
      (SELECT count(*) FROM proof_of_play
        WHERE screenhost_id IN (SELECT id FROM venues)
           OR campaign_id IN (SELECT id FROM own_campaigns)) AS airings,
      (SELECT count(*) FROM reversement_lines
        WHERE screenhost_id IN (SELECT id FROM venues)
           OR agent_sh_id = ${userId} OR agent_sc_id = ${userId})
      + (SELECT count(*) FROM campaign_screenhost_payout
        WHERE screenhost_id IN (SELECT id FROM venues))
      + (SELECT count(*) FROM screenhost_versements WHERE user_id = ${userId})
      + (SELECT count(*) FROM agent_payouts WHERE agent_user_id = ${userId})
      + (SELECT count(*) FROM agent_commission_lines WHERE agent_user_id = ${userId}) AS payouts,
      (SELECT count(*) FROM monthly_invoices WHERE advertiser_id = ${userId})
      + (SELECT count(*) FROM screenhost_factures
        WHERE screenhost_id IN (SELECT id FROM venues)) AS invoices,
      (SELECT count(*) FROM recharges WHERE advertiser_id = ${userId})
      + (SELECT count(*) FROM wallet_adjustments WHERE advertiser_id = ${userId}) AS money
  `);
  const r = [...rows][0];
  return {
    campaigns: Number(r?.campaigns ?? 0),
    allocations: Number(r?.allocations ?? 0),
    airings: Number(r?.airings ?? 0),
    payouts: Number(r?.payouts ?? 0),
    invoices: Number(r?.invoices ?? 0),
    money: Number(r?.money ?? 0),
  };
}
