# SIM-1 — Simulator world generator (design)

Date: 2026-09-13. Status: awaiting operator review. Parent: the admin **Simulateur** program
(see `2026-09-13-sim-0-sandbox-foundation-design.md` §2 for the slice map). Stacks on SIM-0
(PR #212): a simulation is a sandbox database; `db` is context-routed.

## 1. Rulings (brainstorm 2026-09-13)

| # | Question | Ruling |
| --- | --- | --- |
| Q1 | How a world is described | **A** — one parametric preset with a few knobs + a seed |
| Q2 | Plant campaigns too? | **B** — world only; campaigns arrive through the real routes (SIM-4) |
| — | Zones | ONE zone (the seeded « Grand Tunis »): the event zone filter (EV7) is not built, a second zone would exercise code that does not exist |
| — | Measured history | generated from the grid with noise (knob `history_days`, default 28) so audience views are not empty on day one |
| Q3 | Architecture | **1** — pure seeded spec → one transactional write; behaviours stored in MAIN |

Rejected: driving the real signup/approval routes (better-auth is bound to MAIN — synthetic
users can never sign up or log in; consequence for SIM-4: « play as » = admin impersonation,
never a real session); static SQL fixtures (not parametric).

## 2. Scope

In: the `POST /world` generator, its pure spec module and writer, the two read endpoints, the
`simulation_actors` table + `simulations.world` column (migration 0072), the « Générer un
monde » panel and the world card + venues table on the simulation detail, tests.

Out: campaigns/creatives/events, any tick, editing a generated world, more than one zone,
device sessions (SIM-2 emulates playout at library level), S3 objects, `screenhost_amax`
(the engine falls back to its default), `screenhost_monthly_stats` (a report-side artefact).

## 3. Inputs — `POST /api/admin/simulations/:id/world`

Routed (the SIM-0 `enterSimulation` preHandler, last in the chain). Body (zod):

| knob | type | default | bounds |
| --- | --- | --- | --- |
| `seed` | string | random 8 hex, always returned | 1–32 chars |
| `venues` | int | 12 | 1–60 |
| `owners` | int | ⌈venues × 2/3⌉ | 1–venues |
| `advertisers` | int | 6 | 0–40 |
| `agents` | int | 2 (one `screenhost_agent`, one `screencast_agent`) | 0–10 |
| `history_days` | int | 28 | 0–90 |
| `wallet_min_tnd` / `wallet_max_tnd` | int | 500 / 5000 | 0 ≤ min ≤ max ≤ 100 000 |

Guards: the sandbox must be `ready` (SIM-0) and EMPTY — the probe counts (screenhosts,
campaigns, users) all zero, else **409 `WORLD_EXISTS`**. One world per simulation; « régénérer »
= delete the simulation and create a new one. Answer **201** with the world summary (§6).

## 4. The spec — pure (`apps/api/src/simulator/world/`)

`generateWorld(params: WorldParams): WorldSpec` — deterministic: same params (incl. seed) →
byte-identical spec. Random source: a tiny in-house xorshift/mulberry32 seeded from the seed
string (no dependency; `Math.random` never called). Entity ids are uuid-shaped strings drawn
from the rng so a re-run produces the same ids.

Venues (`VenueSpec`): sector drawn from the five owner sectors with weights (Café 35, Resto 25,
Resto/Bar 15, Salle de sport 15, Espace de loisir 10 — looked up by NAME at write time, never by
id); class 50/30/20 populaire/moyen/premium; opening hours per sector (Café 7–23, Resto 11–23
or 11–01 wrap, Resto/Bar 12–02 wrap, Salle de sport 6–22, Espace de loisir 10–24); capacity 4
(prod's value); screens 1–3 (premium biased to 2–3); initial SPS 35–85 (stored as a string,
the E4 job may recompute later); coordinates scattered within ~12 km of Tunis centre;
demographic ratios by class (gender pair + the THREE age bands 17–30 / 31–45 / 46+, summing to
100 — the CLS-AGE1 shape; the retained old 4-band columns stay NULL); `screenCount` = screens.

Footfall: a per-sector hourly curve (persons/hour, e.g. Café peaks 8–10 and 16–19, Resto 12–14
and 19–22, Salle de sport 7–9 and 18–21) × a per-venue scale by class (populaire 0.8–1.4,
moyen 1.0–1.8, premium 1.3–2.5) → the weekly grid `grid[dow 1..7][hour 0..23]` with a weekend
factor, written as BOTH half-hour slots equal (`bothHalves` semantics, `in_effect` NULL,
`source` `'backup'`). Measured history: for each of the `history_days` Tunis calendar days
STRICTLY BEFORE the virtual day of `virtual_now` (the virtual day itself has no rows — SIM-2's
PAX fills it), cell = grid × day-noise (0.7–1.3) × hour-noise
(0.85–1.15), rounded, `deviceOnline = true`, only within opening hours (closed hours = no row).

People: owners (`individual_owner` for one venue, `fleet_owner` for 2–4 venues — the venue→owner
assignment fills fleets first), advertisers, agents; generated French-Tunisian names, emails
`sim.<slug>.<n>@simulateur.invalid` (a reserved TLD — never deliverable), all `status =
'approved'`, `emailVerified = true`, `onboardingCompleted = true`, `termsAcceptedAt` set.

Behaviours (`ActorSpec[]`, MAIN-side): owners `{ acceptance_rate: 0.55–0.95, response_delay_hours:
1–36 }`; screens `{ offline_probability: 0–0.08 }`; advertisers `{}` for now. Also the venue
→ owner and referral graph: half of the owners are referred by the screenhost agent, half of
the advertisers by the screencast agent (when the agent exists).

## 5. The writer (`apps/api/src/simulator/world/write.ts`)

`writeWorld(spec, ctx)` runs inside `runInSandbox` + ONE `db.transaction` on the routed `db`:

1. `users` — owners, advertisers, agents; `agents` rows for the two agents (code `SIM-SH-<seed>`
   / `SIM-SC-<seed>`); `agent_referrals` per the graph.
2. `screenhosts` — `zoneId` = the seeded « Grand Tunis » row (looked up by name in the sandbox),
   `businessSectorId` looked up by sector name (`audience = 'owner'`), `ownerId`, class, hours,
   `broadcastCapacity`, `sps`, lat/lng, `screenCount`, demographics, `isActive = true`.
3. `screens` — per venue, `pairedAt = lastSeenAt = virtual_now` (online at t0; SIM-2 moves it).
4. `screenhost_affluence` — 7 × 48 rows per venue; `screenhost_affluence_hourly` — the history.
5. `recharges` — one confirmed recharge per advertiser, `amountTnd` in range, `reference`
   `SIM-<seed>-<n>` (unique).

Then, through the explicit `mainDb` handle (the route handler is still inside the sandbox
context; `mainDb` bypasses routing by design): insert the `simulation_actors` rows and set
`simulations.world` = `{ seed, params, counts, generated_at }`. Writer failure inside the
sandbox transaction rolls back and nothing is written to main; a main-side failure after a
committed sandbox write is logged and answered 500 — the sandbox is then non-empty, so the
operator deletes the simulation (documented, acceptable for a test tool).

Migration **0072** (main + sandboxes, same migrations): table `simulation_actors (id uuid pk,
simulation_id uuid → simulations on delete cascade, kind text check in ('owner','screen',
'advertiser'), entity_id uuid, params jsonb not null default '{}', unique (simulation_id,
entity_id))` + `simulations.world jsonb null`.

## 6. Reads

- `GET /api/admin/simulations/:id/world` → 404 `NO_WORLD` when `simulations.world` is null; else
  `{ seed, params, generated_at, counts: { venues, screens, owners, advertisers, agents,
  history_days }, by_sector: { [name]: n }, by_class: { populaire, moyen, premium },
  wallet_total_tnd }` (counts recomputed live through the routed `db`).
- `GET /api/admin/simulations/:id/world/venues` → `{ venues: [{ id, name, sector, class,
  opening_hour, closing_hour, screens, sps, owner: { id, name, role }, acceptance_rate,
  lat, lng }] }` — sandbox rows joined with MAIN-side behaviours in code (two queries, no
  cross-database join). This is the feed SIM-3's board renders.

## 7. Web

No new page. `SimulationDetail` gains: when the probe shows an empty sandbox →
`GenerateWorldForm` (knobs with defaults, seed field, one « Générer » button, errors inline);
when `GET /world` answers → `WorldCard` (summary counts, by sector, by class, wallet total, seed
with a copy affordance) and `VenuesTable` (sortable by sector, class, SPS; owner name, hours,
screens, acceptance rate). Service extension `admin-simulator.service.ts` (+3 calls), hooks
`useWorld`, `useWorldVenues`, `useGenerateWorld` (invalidates probe + world queries). French
labels, Tailwind only, `date-fns` for the generated-at line.

## 8. Tests

Pure (no DB): determinism (same seed → deep-equal spec, different seed → different); counts
match the knobs; every venue's hours are broadcastable (`broadcastableHours(...).length > 0`);
every grid is 7 × 24 hours, non-negative, both halves equal after expansion; sector/class
frequencies within ±15 points of the weights at 60 venues; wallets in range; history rows only
inside opening hours; demographics sum to 100.

Sandbox integration (real Postgres, own sandbox per file, SIM-0 primitives): row counts equal
the spec; **the real `assemblePool`, called inside the context for a whole-network 7-day window
starting at `virtual_now + 3 days`, returns every generated venue** (the world is real to the
engine by construction); `walletSpendable(advertiserId).spendable` equals the seeded recharge;
`loadPeriodAudienceInput` over the history window reports `history_days` measured days;
`simulation_actors` rows exist in MAIN and none in the sandbox.

Endpoints: 201 + summary; 409 `WORLD_EXISTS` on a second call; 404 `NO_WORLD` before
generation; the venues list shape and its acceptance rates from main; 503/401/403 inherited.
Web: service pin test (three new calls).

## 9. Delivery

Branch `feat/sim-1-world-generator` stacked on `feat/sim-0-sandbox-foundation`; PR after #212
merges (rebase then). Migration 0072. Five commits, each green on the four named gates:

1. `feat(api): SIM-1 — simulation_actors + simulations.world (migration 0072)`
2. `feat(api): SIM-1 — pure world spec generator + tests`
3. `feat(api): SIM-1 — world writer + sandbox integration tests`
4. `feat(api): SIM-1 — world endpoints (generate, summary, venues) + tests`
5. `feat(web): SIM-1 — generate-world panel, world card, venues table`
