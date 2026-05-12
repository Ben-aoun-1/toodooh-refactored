# TOODOOH Pricing Model v3.0 — Configuration Reference

Companion to `Toodooh_Simulateur_Pricing_v3.html` (same directory). The HTML file is the
authoritative behavioral reference — when in doubt, open the simulator and compare outputs. This
document names the configurable values and current defaults.

The structure of the model is stable. Values may change. Every value listed below must be a
**parameter** in the implementation, not a hardcoded constant.

## Pricing parameters

- **CPM (Cost Per Mille):** default **15 TND**. Standard cost per 1000 impressions.
- **F (maximum frequency window):** default **300 seconds**. Caps spot repetition rate per hour to
  one every F seconds.
- **Credibility thresholds (T):**
  - `T_short` for spots ≤ 10 s: default **0.50**
  - `T_medium` for spots ≤ 20 s: default **0.65**
  - `T_long` for spots ≤ 30 s: default **0.80**
  Used as ceiling on impressions-per-hour: `R_T = (3600 / S) × T_S` (S = spot length in seconds).
- **Effective rotation rate:** `R = min(R_T, R_F)` where `R_F = F / S`. (The simulator labels which
  one is limiting — "F (fréquence max)" vs "T (crédibilité)".)

## Event pricing parameters

- **Event CPM coefficient:** default **×2**. Event CPM = base CPM × coefficient.
- **Event window padding:** **1 hour before + match duration + 1 hour after**. Fixed once selected
  (non-modifiable by advertiser).
- **Eligibility:** only screenhosts flagged `eligibleEvt` participate in events.
- Events **block their window** in the standard-campaign calculation (reduce `Hi` for affected
  screenhosts — the `evtSlots` term).

## Screenhost performance score (SPS) weights

Six criteria, each between 0 and 1. Weights must sum to 100%. Defaults:

- `w1` (acceptance rate — `txAccept`): **25%**
- `w2` (event respect rate — `txRespectEvt`): **30%**
- `w3` (screen activity — `txActivite`): **20%**
- `w4` (sensor quality — `qualiteCapteur`): **10%**
- `w5` (seniority — `anciennete`): **5%**
- `w6` (fill rate — `txRemplissage`): **10%**

`SPS = (w1·txAccept + w2·txRespectEvt + w3·txActivite + w4·qualiteCapteur + w5·anciennete + w6·txRemplissage) × 100`

Used for: ranking screenhosts (descending), cascade priority, display badges.

Color thresholds (UI concern, configurable):

- ≥ 75: high (green)
- ≥ 50: mid (orange)
- < 50: low (red)

## Revenue split (must sum to 100%)

Default:

- Screenhosts: **50%**
- Toodooh: **44%**
- Agent SH (screenhost agent): **3%**
- Agent SC (advertiser agent): **3%**

The screenhost portion distributes proportionally to each screenhost's share of total impressions
for the campaign (`Ii / I_max`).

## Per-screenhost availability math (structure — not configurable)

Campaign inputs (advertiser-chosen, not model config — the simulator defaults them to S = 10 s,
N = 25 days for the demo):

- `S` = spot length (seconds), `N` = campaign duration (days).

For each active screenhost over a campaign of N days:

- `Hi = max(0, opens × N − occupied_slots − event_blocked_slots)`
- `Ii = affluence × Hi × R`
- `I_max = Σ Ii` across active screenhosts
- `C_max = CPM × I_max / 1000`

Budget targeting: the advertiser picks a target budget `C_cible ≤ C_max`; fill rate
`τ = C_cible / C_max`; targeted impressions `I_cible = C_cible × 1000 / CPM`.

For events (window `Hi_evt = 1 + duration + 1` hours):

- `Ii_evt = amax × Hi_evt × R` (uses `amax`, the **historical maximum** affluence, not regular affluence)
- `I_evt_max = Σ` across eligible screenhosts
- `C_evt_max = CPM_evt × I_evt_max / 1000`

## Cascade mechanism (structure — not configurable)

When a screenhost refuses a campaign, their share redistributes to accepting screenhosts in
descending SPS order. Refused screenhosts receive zero revenue.

## Implementation requirements

- Every value labeled "default" above must be read from a config object at calculation time, never
  hardcoded in math functions.
- In the current frontend phase, the config can be a module-level constant (single source of truth).
- In Phase 1 (backend), the config moves to a database table. The math functions stay unchanged.
- Math functions must be pure: deterministic, no I/O, no module-level side effects, no `Date.now()`
  or `Math.random()`.
