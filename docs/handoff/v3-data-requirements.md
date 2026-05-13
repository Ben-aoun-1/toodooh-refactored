# v3.0 pricing model — data requirements (Phase 1 input)

The v3.0 pricing model (`apps/web/src/lib/dooh/v3-model.ts`, parameter reference
`docs/handoff/pricing-model-v3.md`, behavioral reference `Toodooh_Simulateur_Pricing_v3.html`) is
written and tested but **unwired**: nothing computes prices with it yet. Wiring it (Phase 1) needs
per-screenhost data the current Supabase schema does not have. This doc lists those fields — input
for the CEO/CTO conversation and Phase 1 schema planning. It is not exhaustive; it's the gap list.

**Open question first: what *is* a "screenhost" in the model?** The simulator's screenhosts are
establishments ("Café El Bey", …) with operating hours per day. In the current schema there are
`business_profiles` (the screenhost *account* — `individual_owner` / `fleet_owner`), `screens`, and
`locations` (admin treats a location as distinct from a screen; the owner side conflates them). The
v3.0 model treats a "screenhost" as one opaque unit with the fields below — but Phase 1 has to
decide which entity that maps to (a `business_profiles` row? a `location`? a screen?). Everything
below assumes that decision is made; the fields attach to whatever that unit ends up being.

## Per-screenhost fields v3.0 needs

| Model field (`v3-model.ts`) | Simulator | Used for | Current schema analogue? | Sketch of what Phase 1 would add |
|---|---|---|---|---|
| `operatingHoursPerDay` (`Ei`) | `opens` | `Hi = Ei·N − Oi − evtSlots` | none found | a numeric column on the screenhost unit (hours/day, e.g. 0–24, fractional allowed); or derive from a weekly opening-hours table if one is introduced |
| `affluencePerHour` (`Ai`) | `affluence` | `Ii = Ai·Hi·R` (standard) | partial — `location_affluence_schedule(day_of_week, hour, estimated_impressions)` is a *richer* per-hour table; v3.0 wants a single scalar. Could be derived (e.g. mean over operating hours) but that's a modeling choice, not a 1:1 mapping. | either a derived/materialized scalar, or v3.0's `Ai` is redefined to consume the hourly table directly (a model change — flag) |
| `historicalMaxAffluence` (`A_max`) | `amax` | event impressions only: `Ii_evt = A_max·Hi_evt·R` | none found (`location_affluence_schedule` has no historical-max concept; sensor data CRUD exists admin-side via `admin-screens.service.ts` `*AffluenceData`, but no "historical max" field) | a numeric column (people/hour), maintained from sensor history (e.g. rolling-90-day max) |
| `soldSlotsInPeriod` (`Oi`) | `occupied` | `Hi = Ei·N − Oi − evtSlots` | partial — `campaign_hourly_location_plan` records planned repetitions per (campaign, location, date, hour); a per-screenhost sold-slots-in-window count would be an aggregate over it for `active`/`pending` campaigns. Not a stored field. | a query/materialized view aggregating `campaign_hourly_location_plan` (or a successor table) for the campaign's window |
| `eventEligible` (`eligibleEvt`) | `eligibleEvt` | filters who participates in events | none found | a boolean flag on the screenhost unit (set during onboarding/admin review) |
| `acceptanceRate` (SPS `w1`, `txAccept`) | `txAccept` | SPS criterion 1 | partial — derivable from approve/reject history (`OwnerCampaignApprovals` / `OwnerCampaigns` write via `campaignOwnerApprovalService`); not stored as a rate | a materialized rate over a 90-day window, or stored + periodically recomputed |
| `eventRespectRate` (SPS `w2`, `txRespectEvt`) | `txRespectEvt` | SPS criterion 2 (weighted highest, 30%) | none found — there's no "did the screenhost actually diffuse the event it accepted" tracking | needs event-diffusion verification (sensor/log evidence) → a rate |
| `activityRate` (SPS `w3`, `txActivite`) | `txActivite` | SPS criterion 3 | partial — screens have a status (`active`/`maintenance`/`inactive`/`unavailable`); an uptime/activity rate would be derived from status history, which isn't kept | screen status-history table → an uptime rate |
| `sensorQuality` (SPS `w4`, `qualiteCapteur`) | `qualiteCapteur` | SPS criterion 4 | none found (sensor/affluence data exists; a quality *score* doesn't) | a derived sensor-health/quality score (0–1) per screenhost |
| `seniority` (SPS `w5`, `anciennete`) | `anciennete` | SPS criterion 5 | derivable — `business_profiles` has a created/approved date | a normalized seniority value (0–1), computed from the join date against some cap |
| `fillRate` (SPS `w6`, `txRemplissage`) | `txRemplissage` | SPS criterion 6 | partial — could be derived from `campaign_hourly_location_plan` (planned vs available slot capacity) over a window; not stored | a materialized fill-rate over a 90-day window |

## Config v3.0 needs (already has a home)

The configurable scalars (`cpmTnd`, `cpmEventCoefficient`, `frequencyCapSecondsPerHour` / `F`, the
credibility thresholds, the six SPS weights, the 50/44/3/3 `revenueSplit`, the
`eventWindowPaddingHours`, the SPS colour cutoffs `spsColorBands`) extend the existing
`global_configuration` table and the
`getDoohConfigNumbers` path — `/admin-global-config` already edits that table. Phase 1: add the new
keys + a migration to seed the defaults from `docs/handoff/pricing-model-v3.md`, and extend
`mapParsedToDoohNumbers` (or add a `getDoohConfigV3`). `lib/dooh/v3-model.ts` already takes a
`DoohConfigV3` argument and never reads config itself.

## Other v3.0 inputs that are campaign- or event-scoped (not screenhost-level)

- `spotSeconds` (`S`) — the campaign's spot length; the wizard already collects a video duration.
- `campaignDays` (`N`) — derive from the campaign's start/end (`lib/dooh/dates.ts`
  `computeCampaignDayCount`).
- `matchDurationHours` per event, and a per-event CPM coefficient override — `special_events` has
  start/end dates; it would need a match-duration (hours) field and an optional coefficient field
  (the simulator stores `duration` and `coeff` per event).

## Wiring constraints (Phase 1)

v3.0's `applyBudget(result, targetBudgetTnd, cfg)` (and `applyEventBudget` likewise) treats
`targetBudgetTnd` as an arbitrary number — the math clamps it into `[0, C_max]` and returns a
sensible result either way (`fillRate` saturates at `1`, no error). **It is the caller's job to
ensure the requested budget is actually *achievable* against the advertiser's wallet.** The math
side is correct by construction; the wallet-balance cap is a UX / business-rule concern, applied at
three points when wiring v3.0 into the live wizard (`NewCampaign.tsx`) and cart (`CartPage.tsx`):

1. **Wizard input cap.** The budget input field's `max` =
   `min(advertiser_available_balance, C_max)`. Display the cap inline; prevent entry above it.
   - "available balance" = `wallet_balance − Σ targetBudget of other cart lines belonging to the
     same advertiser`.
   - This prevents the "fill the cart with three campaigns each at full balance, afford only one"
     failure mode.

2. **Cart-confirmation re-check.** When the user clicks "Confirmer et jouer" in the cart,
   re-validate that each line's `targetBudget` is still ≤ available balance at that moment. The
   balance can have changed since the wizard ran (another tab, parallel session, admin manual
   debit). If insufficient, redirect to `/my-recharges` (the existing pattern in
   `CartPage.handleConfirmAndLaunch`).

3. **Launch-payment transaction.** The actual debit at launch already exists in `CartPage.tsx` via
   `balanceService`. No change needed here — noted for completeness so whoever wires v3.0 does not
   accidentally bypass it.

Note on the math: `applyBudget` already clamps `C_cible` to `[0, C_max]`, so the "user enters a
value above `C_max`" case is handled gracefully (fillRate clamps to `1`, no error). The wallet-
balance cap is purely a UX/business-rule concern on top of that, not a math concern.
