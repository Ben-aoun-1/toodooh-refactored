import { getDispatchConfig } from './dispatch/config.js';
import { computeReversement, type ReversementPcts, tndToMillimes } from './reversement/split.js';

// Operator ruling 2026-10-09 (confirms SH-TTC1) — a screenhost sees ONE money: its share, i.e.
// the SH line of the reversement split (50 % by default) of what the screencaster pays HT, shown
// as TTC. 100 TND HT paid (119 TTC) → the screenhost sees 50 TND TTC. Every owner-facing amount
// that is derived from a campaign's value (dispatch revenu_previsionnel, event montant) goes
// through here, so an estimate equals what the settlement will actually pay (same split, same
// millime flooring — lib/reversement/split). Settled payouts (campaign_screenhost_payout
// .earnings_tnd) already store this share (E7) and need no conversion.

/** The configured split, as the settlement reads it. */
export const loadOwnerSharePcts = async (): Promise<ReversementPcts> => {
  const cfg = await getDispatchConfig();
  return {
    sh: cfg.pctSh,
    toodooh: cfg.pctToodooh,
    agentSh: cfg.pctAgentSh,
    agentSc: cfg.pctAgentSc,
  };
};

/** The owner's share of a campaign value (HT) — the SH line, in TND. 0 for a non-positive value. */
export const ownerShareTnd = (valueHtTnd: number, pcts: ReversementPcts): number => {
  if (!Number.isFinite(valueHtTnd) || valueHtTnd <= 0) return 0;
  return computeReversement(tndToMillimes(valueHtTnd), pcts).shMillimes / 1000;
};
