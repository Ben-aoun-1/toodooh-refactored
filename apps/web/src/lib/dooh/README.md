# `lib/dooh/v3-model.ts` — v3.0 pricing IP

This module is TOODOOH's pricing engine for the v3.0 model, written as a single file of pure
functions. It exists to be portable: once Phase 1 starts (`apps/api/`), this file moves there
verbatim and the React app imports the wired-up endpoints rather than the math.

It is currently **unwired** — nothing in the app imports it. Wiring happens in Phase 1
(`docs/handoff/v3-data-requirements.md` lists the schema work needed first).

## Behavioural reference

The single source of truth for the v3.0 math is the standalone simulator at
`docs/handoff/Toodooh_Simulateur_Pricing_v3.html`. Every function in `v3-model.ts` matches
exactly one routine in the simulator's `<script>` block; see the mapping below. When the
simulator and this module disagree, the simulator wins — file a regression test against the
demo fixtures and patch the module.

Conceptual write-up: `docs/handoff/pricing-model-v3.md`.

## Function ↔ simulator mapping

| `v3-model.ts`                  | Simulator routine             | Returns                                                                                       |
| ------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `clampSpotSeconds`             | `clampS(s)`                   | `s` clamped to `[1, 30]`                                                                      |
| `credibilityThreshold`         | `getT(s)`                     | `0.5` (≤10s), `0.65` (≤20s), `0.8` (>20s)                                                     |
| `repetitionRate`               | `getR(s) = min((3600/s)·T, F/s)` | `{ rate, limitedBy: 'frequency' \| 'credibility' }`                                        |
| `screenhostPerformanceScore`   | `calcSPS(sh)`                 | weighted sum × 100, range `[0, 100]`                                                          |
| `spsColorBand`                 | `spsColor(sps)`               | `'green'` (≥75), `'yellow'` (≥50), `'red'`                                                    |
| `computeStandardCampaign`      | `recalcNormale()`             | per-screenhost `Hi`, `Ii`, SPS-ranked accepting list, refused cascade, `I_max`, `C_max`       |
| `splitRevenue`                 | `rep-amounts-*`               | `{ screenhost, toodooh, agentSh, agentSc }` summing to the input                              |
| `applyBudget`                  | budget slider                 | clamps to `[0, C_max]`, distributes screenhost pool by impression share                       |
| `computeEventCampaign`         | `recalcEvenement()`           | event window, `CPM_evt`, eligible accepting list, separate `refused` / `ineligible`, `I_evt_max`, `C_evt_max` |
| `applyEventBudget`             | event budget slider           | same shape as `applyBudget`, priced at `CPM_evt`                                              |
| `combineCart`                  | combined view                 | event windowHours feeds standard's `evtSlots`; totals across both portions                    |

## Vocabulary

| Symbol     | Meaning                                            | Source field                                |
| ---------- | -------------------------------------------------- | ------------------------------------------- |
| `s`        | Spot length, seconds                               | `contentSeconds` (arg)                      |
| `N`        | Campaign day count                                 | `daysCount` (arg)                           |
| `R`        | Billable repetitions per hour                      | `repetitionRate(s).rate`                    |
| `T(s)`     | Credibility threshold for `s`                      | `credibilityThreshold(s)`                   |
| `F`        | Frequency-cap, seconds-per-hour ceiling on repeats | `config.frequencyCapSecondsPerHour` (300)   |
| `Ei`       | Operating hours per day                            | `screenhost.operatingHoursPerDay`           |
| `Ai`       | Regular affluence, people/hour                     | `screenhost.affluencePerHour`               |
| `A_max`    | Historical maximum affluence (events only)         | `screenhost.historicalMaxAffluence`         |
| `Oi`       | Sold spot slots in the campaign period             | `screenhost.soldSlotsInPeriod`              |
| `evtSlots` | Hours of event blackout per screenhost             | `eventSlotsBlockedHours` (arg) / event window |
| `Hi`       | Net availability hours                             | `max(0, Ei·N − Oi − evtSlots)`              |
| `Ii`       | Per-screenhost impressions, standard               | `Ai · Hi · R`                               |
| `Ii_evt`   | Per-screenhost impressions, event                  | `A_max · windowHours · R`                   |
| `I_max`    | Max impressions, standard (Σ Ii over accepting)    | `result.maxImpressions`                     |
| `I_evt_max`| Max impressions, event                             | `result.maxImpressions`                     |
| `C_max`    | Max budget envelope, TND                           | `CPM · I_max / 1000`                        |
| `C_evt_max`| Max event budget envelope, TND                     | `CPM_evt · I_evt_max / 1000`                |
| `CPM`      | Cost per 1000 impressions, TND                     | `config.cpmTnd` (15)                        |
| `CPM_evt`  | Event CPM                                          | `CPM · cpmEventCoefficient` (30)            |
| `SPS`      | Screenhost performance score, `[0, 100]`           | `screenhostPerformanceScore(sh)`            |

## Assumptions

- **Pure functions only.** No I/O, no `Date.now()`, no `Math.random()`, no module-level state.
  This is what makes the module trivially testable today and trivially portable to `apps/api/`
  tomorrow. Wiring (DB reads, schema mapping, persistence) lives outside this module.
- **All thresholds and weights are configurable.** Every numeric constant in a formula comes
  from `DoohConfigV3`. The only hardcoded literals are `MIN_SPOT_SECONDS` / `MAX_SPOT_SECONDS`
  (the simulator clamps `[1, 30]`) and the `3600` in `R_T = (3600/s) · T(s)` (seconds → hour).
- **Cascade for refused screenhosts.** A screenhost with `refused: true` gets `0` revenue and
  is excluded from `I_max` entirely; the remaining accepting screenhosts renormalise to share
  the full screenhost pool. This matches the simulator and prevents "ghost" impressions.
- **Events use `A_max`, not `Ai`.** The event impression formula intentionally substitutes
  historical maximum affluence — the rationale (per the simulator's design notes) is that
  events draw exceptional traffic, so the regular hourly average is the wrong baseline.
- **Event window = padding + duration + padding.** Default padding is `1` hour each side
  (configurable). The window is the same for every accepting screenhost in the event.
- **`refused` ≠ `ineligible` for events.** A screenhost that is not `eventEligible` lands in
  `ineligible[]`; a screenhost that is `eventEligible` but `refused` lands in `refused[]`.
  The UI must show these as distinct states so the screenhost can opt in vs. accept.
- **SPS ranking is stable.** Sort is by `sps` descending, ties broken by `id` ascending. This
  guarantees the same ranking for the same inputs across runs.
- **Tie-breaker for division-by-zero.** `C_max = 0` (no accepting screenhosts, or all `Hi = 0`)
  yields `fillRate = 0` and an empty `perScreenhost[]` — `applyBudget` does not divide.

## Demo screenhosts (test fixtures)

The four demo screenhosts in `v3-model.test.ts` mirror the simulator's `script` block (around
lines 1128–1137 in `Toodooh_Simulateur_Pricing_v3.html`). They exist solely so the test suite
can reproduce the simulator's published outputs:

| `id`  | Name              | `Ei` | `Ai` | `A_max` | `eventEligible` | SPS    | Band   |
| ----- | ----------------- | ---- | ---- | ------- | --------------- | ------ | ------ |
| `sh1` | Café El Bey       | 8    | 55   | 90      | ✓               | 91.15  | green  |
| `sh2` | Lounge Arts       | 6    | 40   | 75      | ✓               | 79.75  | green  |
| `sh3` | Salle SportPlus   | 7    | 35   | 60      | ✗               | 66.75  | yellow |
| `sh4` | Bar Le Zinc       | 5    | 30   | 80      | ✓               | 53.00  | yellow |

Anchor numbers the test suite locks in (with `s = 10`, default config):

- `R = 30` (frequency-limited at `F = 300`).
- Standard, `N = 25`, no event: `I_max = 806_250`, `C_max = 12_093.75 TND`.
- Standard, `sh4` refused: `I_max = 693_750` (cascade subtracts `Ii(sh4) = 112_500`).
- Event, duration `2.5h`: `windowHours = 4.5`, `I_evt_max = 33_075`, `C_evt_max = 992.25 TND`,
  `sh3` in `ineligible[]`.
- `splitRevenue(1000) = { screenhost: 500, toodooh: 440, agentSh: 30, agentSc: 30 }`.

If any of these drift, the simulator and the module have diverged — fix the module, not the
test.
