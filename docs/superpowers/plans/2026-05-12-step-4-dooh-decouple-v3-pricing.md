# Step 4 — DOOH engine decouple + v3.0 pricing IP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the DOOH calculation engine's pure math reachable without Supabase (fixing the failing test) and add the v3.0 pricing model as a new, tested, *unwired* pure module that can move to `apps/api/` verbatim in Phase 1.

**Architecture:** Two phases. **4a — decouple:** move the genuinely-pure config + date primitives and the pure budget-fitting function out of Supabase-coupled service files into `apps/web/src/lib/dooh/`; the service files keep only the thin Supabase wrappers and re-export the moved symbols for back-compat. **4b — v3.0 IP:** write `apps/web/src/lib/dooh/v3-model.ts` implementing the v3.0 model (R with credibility/frequency ceilings, SPS, per-screenhost campaign math, cascade, 50/44/3/3 split, events, mixed cart), driven by tests that reproduce the simulator's numeric examples, plus `apps/web/src/lib/dooh/README.md` documenting the model and the function↔simulator mapping. Then a docs commit (audit rescope + issue #12) and a handoff-docs commit (v3 data requirements + Supabase RPC inventory). **4c (wiring + schema + UI) is explicitly Phase 1 — not in this plan.**

**Tech stack:** TypeScript 5.7 strict, Vite, Vitest, pnpm 9 monorepo, ESLint 9 flat config + Husky/lint-staged. Node v20.20.2 (`.nvmrc`).

---

## Conventions for every task in this plan

- **Node:** all commands assume `nvm use` has been run in the shell (reads `.nvmrc` → v20.20.2). If `node --version` is not `v20.20.2`, run `nvm use` first.
- **Commands** (from repo root `~/Desktop/toodooh-platform/`): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @toodooh/web build`.
- **Baseline** (this is the "green" target — these numbers should be *unchanged* by 4a.1 and by every 4b commit; 4a.2 changes only the test result):
  - `pnpm typecheck` → exit 2, **179** `error TS…` lines.
  - `pnpm lint` → exit 1, **1618 problems (1591 errors, 27 warnings)**.
  - `pnpm test` → currently exit 1; **Test Files 3 passed | 1 failed (4)**; **22 tests pass**; the failing file is `campaign-hourly-location-plan.service.test.ts` (`Error: supabaseUrl is required` from `createClient()` at `src/lib/supabase.ts:8`).
  - `pnpm --filter @toodooh/web build` → exit 0, **113** chunks; main `index-*.js` ≈ **442 kB** (gzip ≈ 129 kB); largest chunk `Dashboard-*.js` ≈ 623 kB.
- **Pre-commit hook:** Husky runs lint-staged: `*.{ts,tsx,mts,cts}` → `eslint --fix` + `prettier --write`; `*.{js,cjs,mjs,json,md,yml,yaml,css}` → `prettier --write`. A commit touching a file with non-autofixable lint errors (e.g. pre-existing `console.*`) makes lint-staged exit non-zero → use `git commit --no-verify` for those commits. Each task below states whether `--no-verify` is expected. New files we author must be lint-clean (strict TS, no `any`, no `console.*` — these are pure math files, no logging) so commits touching *only* new files do **not** need `--no-verify`.
- **`.prettierignore`** covers `docs/handoff/` and `docs/superpowers/` (so this plan file and the handoff docs bypass prettier) — but **not** `apps/web/src/lib/dooh/README.md` and **not** `docs/audit.md`; those get `prettier --write` on commit (it auto-formats them, so just write reasonable markdown).
- **Repo for `gh` commands:** `Ben-aoun-1/toodooh-refactored`.

---

## Post-approval clarifications (authoritative — these win over any stale code block below)

1. **`DoohConfigV3` is fully defined in 4b.1** — all v3.0 keys + defaults, even though 4b.1's
   functions only consume a subset. 4b.2/4b.3/4b.4 *consume* the existing config; they do not expand
   the type or add defaults. The authoritative key names (used throughout 4b's code):
   `cpmTnd` (15), `cpmEventCoefficient` (2 → CPM_evt 30), `frequencyCapSecondsPerHour` (F, 300),
   `credibilityThresholds { shortMaxSeconds: 10, shortValue: 0.50, mediumMaxSeconds: 20,
   mediumValue: 0.65, longValue: 0.80 }`, `spsWeights { txAccept: 0.25, txRespectEvt: 0.30,
   txActivite: 0.20, qualiteCapteur: 0.10, anciennete: 0.05, txRemplissage: 0.10 }`,
   `spsColorBands { greenMinScore: 75, yellowMinScore: 50 }`,
   `revenueSplit { screenhost: 0.50, toodooh: 0.44, agentSh: 0.03, agentSc: 0.03 }`,
   `eventWindowPaddingHours` (1, applied each side). `spsColorBand()` returns `'green' | 'yellow' | 'red'`.
   4b.1 adds two cheap invariant tests: `revenueSplit` sums to 1.0, `spsWeights` sums to 1.0.
2. **Bundle-comparison gate (the "unwired" check for every 4b commit) — precise metric:**
   - **Vite build chunk count: exact match** to the post-4a value (which is the baseline value, **113**).
     If it diverges → **halt and investigate** (something imported `v3-model.ts`).
   - **Main-entry chunk gzipped size** (the headline `dist/assets/index-*.js … gzip: NN kB` line):
     **within ±100 bytes** of the post-4a value (baseline ≈ **128.63 kB gzip**). ±100 bytes covers
     sourcemap/formatter noise; a real accidental import moves it by several kB. If it drifts more →
     **halt and verify** no accidental import was introduced before committing.
   (For the 4a commits the bundle *may* move slightly — code is relocated between modules — so for 4a
   the gate is "chunk count exact (113); gzip size moved by < a few kB"; the strict ±100 B gate is
   for 4b only.)

## File structure (what gets created / modified across the whole plan)

**Created:**
- `apps/web/src/lib/dooh/config.ts` — the legacy DOOH config type + defaults (`DoohConfigNumbers`, `DEFAULT_DOOH_CONFIG_NUMBERS`), moved here from `dooh-calculation.service.ts`.
- `apps/web/src/lib/dooh/dates.ts` — pure calendar/date helpers (`MS_PER_DAY`, `parseLocalCampaignCalendarDay`, `computeCampaignDayCount`, `jsGetDayToDbDayOfWeek`, `dateToDayOfWeek`, `formatLocalCalendarDate`, `localSlotRange`), moved here from `dooh-location-affluence-engine.ts`.
- `apps/web/src/lib/dooh/hourly-plan.ts` — the pure budget-fitting function `buildHybridAdjustedHourlyPlan` + its types + private helpers, moved here from `campaign-hourly-location-plan.service.ts`.
- `apps/web/src/lib/dooh/hourly-plan.test.ts` — moved from `apps/web/src/services/campaign-hourly-location-plan.service.test.ts` (import path updated).
- `apps/web/src/lib/dooh/v3-model.ts` — the v3.0 pricing model (pure). New.
- `apps/web/src/lib/dooh/v3-model.test.ts` — simulator-fixture tests for the above. New.
- `apps/web/src/lib/dooh/README.md` — model docs + function↔simulator mapping + assumptions + test-fixture description.
- `docs/handoff/v3-data-requirements.md` — per-screenhost fields v3.0 needs that the current schema lacks.
- `docs/handoff/supabase-rpc-inventory.md` — `supabase.rpc(...)` calls found, SQL-to-extract-before-Phase-1 note.

**Modified:**
- `apps/web/src/services/dooh-calculation.service.ts` — re-export config from `../lib/dooh/config` instead of defining it.
- `apps/web/src/services/dooh-location-affluence-engine.ts` — import the date helpers from `../lib/dooh/dates` and re-export them; remove their local definitions.
- `apps/web/src/services/campaign-hourly-location-plan.service.ts` — remove the pure code; import `HourlyPlanSlotOutput` type from `../lib/dooh/hourly-plan`; keep only `replaceCampaignHourlyLocationPlan` + `getOccupiedRepetitionsByLocationFromHourlyPlan` + the private `toDateStr`.
- `apps/web/src/services/campaign.service.ts` — change the `buildHybridAdjustedHourlyPlan` import to `../lib/dooh/hourly-plan`.
- `docs/audit.md` — §3 DOOH subsection rescope + two new flag-notes + handoff cross-ref; §5 roadmap row 4 wording; §2 snapshot test-row note.

**Unchanged** (verify, but no edits needed — they import the moved symbols transitively via the re-exports): `apps/web/src/services/dooh-hourly-grid.ts`, `apps/web/src/services/dooh-new-campaign-estimate.service.ts`, `apps/web/src/services/dooh-calculation.service.test.ts`, `apps/web/src/services/dooh-hourly-grid.test.ts`, `apps/web/src/services/global-configuration.service.ts`, `apps/web/src/hooks/useAdvertiserGlobalConfig.ts`, `apps/web/src/pages/OwnerCampaigns.tsx`, `apps/web/src/pages/NewCampaign.tsx`.

---

# PHASE 4a — decouple

## Task 4a.1: Extract config + date primitives into `lib/dooh/`

**Goal:** move the genuinely-pure config type/defaults and the pure date helpers into `apps/web/src/lib/dooh/`; the two legacy files re-export them so every existing importer keeps working. **No behavior change. No test change.**

**Files:**
- Create: `apps/web/src/lib/dooh/config.ts`
- Create: `apps/web/src/lib/dooh/dates.ts`
- Modify: `apps/web/src/services/dooh-calculation.service.ts`
- Modify: `apps/web/src/services/dooh-location-affluence-engine.ts`

- [ ] **Step 1: Create `apps/web/src/lib/dooh/config.ts`** with exactly:

```ts
/**
 * DOOH calculation config (legacy model). Numbers are TND for amounts, seconds for durations.
 *
 * Pure: no imports, no side effects. Lives in `lib/dooh/` (Supabase-free) so calculation
 * code can be reached without constructing the Supabase client. `services/global-configuration.service.ts`
 * loads these values from the `global_configuration` table; the defaults below are the single
 * source of truth otherwise.
 *
 * NOTE: the v3.0 pricing model (`./v3-model.ts`) has its own config type, `DoohConfigV3`.
 * This type is the *current* (pre-v3.0) engine's config — see `docs/handoff/pricing-model-v3.md`
 * and `docs/audit.md` §3 for the relationship.
 */

export type DoohConfigNumbers = {
  video_min_duration_seconds: number;
  video_max_duration_seconds: number;
  video_default_duration_seconds: number;
  max_spots_per_hour: number;
  max_billable_spot_rate_per_hour: number;
  /** Référence RPH pour le taux d’occupation par localité (voir `dooh-location-affluence-engine`). */
  dooh_occupation_reference_rph: number;
  standard_campaign_cpm_tnd: number;
  event_campaign_cpm_tnd: number;
};

export const DEFAULT_DOOH_CONFIG_NUMBERS: DoohConfigNumbers = {
  video_min_duration_seconds: 1,
  video_max_duration_seconds: 30,
  video_default_duration_seconds: 15,
  max_spots_per_hour: 10,
  max_billable_spot_rate_per_hour: 0.3,
  dooh_occupation_reference_rph: 10,
  standard_campaign_cpm_tnd: 2.5,
  event_campaign_cpm_tnd: 2.5,
};
```

- [ ] **Step 2: Create `apps/web/src/lib/dooh/dates.ts`** with exactly (these are the date helpers currently in `dooh-location-affluence-engine.ts` lines ~19-67 + ~190-205, moved verbatim):

```ts
/**
 * Pure calendar/date helpers for the DOOH engine. No imports, no side effects.
 *
 * `location_affluence_schedule.day_of_week` is 1 = Monday … 7 = Sunday. JS `Date.getDay()`
 * is 0 = Sunday … 6 = Saturday. `jsGetDayToDbDayOfWeek` bridges the two. Campaign bounds are
 * interpreted as **local civil days** (not UTC midnight) so `getDay()`/`getDate()` don't shift
 * by timezone.
 */

export const MS_PER_DAY = 86_400_000;

/** `Date.getDay()` (0=dimanche) → `day_of_week` BD (1=lundi … 7=dimanche). */
export function jsGetDayToDbDayOfWeek(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

/** Jour semaine 1 = lundi … 7 = dimanche (aligné `location_affluence_schedule`). */
export function dateToDayOfWeek(d: Date): number {
  return jsGetDayToDbDayOfWeek(d.getDay());
}

/**
 * Interprète une borne de campagne comme **jour civil local** (évite `new Date('YYYY-MM-DD')` = minuit UTC
 * qui décale `getDay()` / `getDate()` selon le fuseau).
 */
export function parseLocalCampaignCalendarDay(d: Date | string): Date {
  if (typeof d === 'string') {
    const part = d.trim().split('T')[0];
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const day = Number(m[3]);
      return new Date(y, mo, day, 0, 0, 0, 0);
    }
    // Compat legacy: accepte aussi "DD/MM/YYYY" ou "DD-MM-YYYY"
    const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(part);
    if (dmy) {
      const day = Number(dmy[1]);
      const mo = Number(dmy[2]) - 1;
      const y = Number(dmy[3]);
      return new Date(y, mo, day, 0, 0, 0, 0);
    }
  }
  const x = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate(), 0, 0, 0, 0);
}

/** Nombre de jours calendaires à parcourir (bornes inclusives), minimum 1. */
export function computeCampaignDayCount(start: Date | string, end: Date | string): number {
  const startDay = parseLocalCampaignCalendarDay(start);
  const endDay = parseLocalCampaignCalendarDay(end);
  const diffDays = Math.floor((endDay.getTime() - startDay.getTime()) / MS_PER_DAY);
  return Math.max(1, diffDays + 1);
}

/** Date calendaire locale `YYYY-MM-DD` (alignée sur la boucle du moteur). */
export function formatLocalCalendarDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Début de la tranche locale [date à hour:00, date à hour+1:00). */
export function localSlotRange(dateCalendar: Date, hour: number): { start: Date; end: Date } {
  const start = new Date(dateCalendar);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(hour + 1, 0, 0, 0);
  return { start, end };
}
```

- [ ] **Step 3: Edit `apps/web/src/services/dooh-calculation.service.ts`** — replace the `DoohConfigNumbers` type definition and the `DEFAULT_DOOH_CONFIG_NUMBERS` const (currently lines ~6-27) with a re-export. The new top of the file reads:

```ts
/**
 * Moteur de calcul DOOH (fonctions pures, testables).
 * Les montants CPM sont en TND ; les durées en secondes.
 *
 * Config type + defaults moved to `../lib/dooh/config`; re-exported here for back-compat.
 */

export { type DoohConfigNumbers, DEFAULT_DOOH_CONFIG_NUMBERS } from '../lib/dooh/config';
import type { DoohConfigNumbers } from '../lib/dooh/config';
```

Leave everything from `export type EffectiveDurationResult = …` onward untouched (those functions already take `DoohConfigNumbers` as a parameter and the `import type` line above keeps them resolving).

- [ ] **Step 4: Edit `apps/web/src/services/dooh-location-affluence-engine.ts`** — remove the local definitions of `MS_PER_DAY`, `jsGetDayToDbDayOfWeek`, `dateToDayOfWeek`, `parseLocalCampaignCalendarDay`, `computeCampaignDayCount`, `formatLocalCalendarDate`, `localSlotRange` (currently roughly lines 23-67 and 190-205), and replace the import/export block at the top of the file. The file currently starts:

```ts
import type { DoohConfigNumbers } from './dooh-calculation.service';
```

Change that to:

```ts
import type { DoohConfigNumbers } from '../lib/dooh/config';
import {
  MS_PER_DAY,
  jsGetDayToDbDayOfWeek,
  dateToDayOfWeek,
  parseLocalCampaignCalendarDay,
  computeCampaignDayCount,
  formatLocalCalendarDate,
  localSlotRange,
} from '../lib/dooh/dates';

export {
  MS_PER_DAY,
  jsGetDayToDbDayOfWeek,
  dateToDayOfWeek,
  parseLocalCampaignCalendarDay,
  computeCampaignDayCount,
  formatLocalCalendarDate,
  localSlotRange,
};
```

(The `export { … }` re-export block keeps `dooh-hourly-grid.ts` — which imports several of these from `./dooh-location-affluence-engine` — working with no change. Keep every other function in the file as-is; they call `parseLocalCampaignCalendarDay` / `computeCampaignDayCount` / etc., now resolved via the import above. The functions `shouldDebugDoohSlotMatching` and `countPositiveAffluenceCellsForDbDay` and the overlap predicates `isUnavailableInSlot`/`isEventOverlapInSlot` stay in this file — they are not "dates primitives".)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: exit 2, **179** `error TS…` lines (unchanged from baseline — the move introduces no new type errors). If the count changed, an import path is wrong; fix and re-run.

- [ ] **Step 6: Test**

Run: `pnpm test`
Expected: exit 1, **Test Files 3 passed | 1 failed (4)**, **22 tests pass** — *identical to baseline*. This proves no behavior change (the still-failing `campaign-hourly-location-plan.service.test.ts` is fixed in 4a.2, not here).

- [ ] **Step 7: Lint + build**

Run: `pnpm lint` → exit 1, **1618 problems (1591 errors, 27 warnings)** (unchanged — the new files are lint-clean; the legacy files we touched still have the same pre-existing `console.*` errors).
Run: `pnpm --filter @toodooh/web build` → exit 0, **113** chunks (exact match to baseline); main-entry chunk gzip ≈ 128.6 kB (may move by < a few kB — code is relocated between modules; no new lazy chunk).

- [ ] **Step 8: Commit** (`--no-verify` expected — this touches `dooh-location-affluence-engine.ts`, which has pre-existing `console.*` calls that make lint-staged's `eslint --fix` exit non-zero; lint count is unchanged so nothing new is introduced):

```bash
git add apps/web/src/lib/dooh/config.ts apps/web/src/lib/dooh/dates.ts apps/web/src/services/dooh-calculation.service.ts apps/web/src/services/dooh-location-affluence-engine.ts
git commit --no-verify -m "refactor(dooh): move config + date primitives into lib/dooh/

Pure DOOH config type/defaults and the calendar helpers leave the
Supabase-coupled service files. The service files re-export them so every
existing importer keeps working; no behavior change. First step toward
making the calculation engine reachable without the Supabase client."
```

**Why a single commit:** it's one self-contained relocation with zero behavior change and zero test change — verifiable purely by "baseline numbers unchanged, two new files exist". It is *not* part of 4a.2 because 4a.2 changes a test result (the previously-failing test starts passing); keeping the no-op move separate makes that one observable change easy to review. It is *not* split further (config vs dates as two commits) because both are tiny verbatim moves with the same verification gate and the same `--no-verify` reason.

---

## Task 4a.2: Extract `buildHybridAdjustedHourlyPlan` into `lib/dooh/` — the failing test now passes

**Goal:** move the pure budget-fitting function out of the Supabase-coupled `campaign-hourly-location-plan.service.ts` into `apps/web/src/lib/dooh/hourly-plan.ts`; move its test alongside; the previously-failing test now passes *because the math is independently reachable* (no `createClient` anywhere in its import graph).

**Files:**
- Create: `apps/web/src/lib/dooh/hourly-plan.ts`
- Move: `apps/web/src/services/campaign-hourly-location-plan.service.test.ts` → `apps/web/src/lib/dooh/hourly-plan.test.ts`
- Modify: `apps/web/src/services/campaign-hourly-location-plan.service.ts`
- Modify: `apps/web/src/services/campaign.service.ts`

- [ ] **Step 1: Create `apps/web/src/lib/dooh/hourly-plan.ts`** with exactly (this is `campaign-hourly-location-plan.service.ts` lines 3-189 — the types, the three private helpers, and `buildHybridAdjustedHourlyPlan` — moved verbatim; the `import { supabase }` line and the two `async` Supabase functions are NOT moved):

```ts
/**
 * Plan horaire par localité — fonction pure de répartition budget→répétitions.
 *
 * No imports, no side effects. Lives in `lib/dooh/` (Supabase-free) so the algorithm — and its
 * test — can run without constructing the Supabase client. The persistence wrappers that
 * read/write `campaign_hourly_location_plan` stay in `../services/campaign-hourly-location-plan.service.ts`.
 */

export type HourlyPlanSlotInput = {
  locationId: string;
  diffusionDate: string; // YYYY-MM-DD (local)
  diffusionHour: number; // 0..23
  maxImpressions: number; // capacité maximale du slot (après règles métier)
  maxRepetitionsPerHour: number; // plafond logique de répétitions sur ce slot
};

export type HourlyPlanSlotOutput = HourlyPlanSlotInput & {
  plannedRepetitionsPerHour: number;
  plannedImpressions: number;
};

function stableSlotKey(s: {
  locationId: string;
  diffusionDate: string;
  diffusionHour: number;
}): string {
  return `${s.locationId}|${s.diffusionDate}|${String(s.diffusionHour).padStart(2, '0')}`;
}

function sortSlots(a: HourlyPlanSlotInput, b: HourlyPlanSlotInput): number {
  const ka = stableSlotKey(a);
  const kb = stableSlotKey(b);
  return ka.localeCompare(kb);
}

/**
 * Ajustement hybride post-curseur:
 * 1) réduction des répétitions en priorité
 * 2) si nécessaire, réduction de couverture de créneaux
 * 3) dernier recours: localités peuvent tomber à 0 si la cible est très basse
 */
export function buildHybridAdjustedHourlyPlan(input: {
  slots: readonly HourlyPlanSlotInput[];
  targetImpressions: number;
  keepLocationsFirst?: boolean;
}): HourlyPlanSlotOutput[] {
  const keepLocationsFirst = input.keepLocationsFirst ?? true;
  const slots = [...input.slots]
    .map((s) => ({
      ...s,
      maxImpressions: Math.max(0, Number(s.maxImpressions) || 0),
      maxRepetitionsPerHour: Math.max(0, Math.trunc(Number(s.maxRepetitionsPerHour) || 0)),
    }))
    .sort(sortSlots);

  const withMeta = slots.map((s) => {
    const maxRep = s.maxRepetitionsPerHour;
    const perRep =
      maxRep > 0 ? s.maxImpressions / maxRep : s.maxImpressions > 0 ? s.maxImpressions : 0;
    return {
      ...s,
      perRep,
      reps: maxRep,
    };
  });

  const totalMax = withMeta.reduce((sum, s) => sum + s.maxImpressions, 0);
  const target = Math.max(0, Number(input.targetImpressions) || 0);
  if (target >= totalMax) {
    return withMeta.map((s) => ({
      locationId: s.locationId,
      diffusionDate: s.diffusionDate,
      diffusionHour: s.diffusionHour,
      maxImpressions: s.maxImpressions,
      maxRepetitionsPerHour: s.maxRepetitionsPerHour,
      plannedRepetitionsPerHour: s.maxRepetitionsPerHour,
      plannedImpressions: Math.round(s.maxImpressions),
    }));
  }

  // Phase 1: réduction proportionnelle des répétitions.
  const ratio = totalMax > 0 ? target / totalMax : 0;
  for (const s of withMeta) {
    s.reps = Math.min(
      s.maxRepetitionsPerHour,
      Math.max(0, Math.floor(s.maxRepetitionsPerHour * ratio)),
    );
  }

  // Localités protégées (au moins 1 répétition quelque part si possible).
  const protectedLocations = new Set<string>();
  if (keepLocationsFirst && target > 0) {
    const byLoc = new Map<string, typeof withMeta>();
    for (const s of withMeta) {
      const list = byLoc.get(s.locationId) ?? [];
      list.push(s);
      byLoc.set(s.locationId, list);
    }
    for (const [locId, locSlots] of byLoc) {
      const hasCapacity = locSlots.some((s) => s.maxRepetitionsPerHour > 0);
      if (!hasCapacity) continue;
      const repsNow = locSlots.reduce((sum, s) => sum + s.reps, 0);
      if (repsNow > 0) {
        protectedLocations.add(locId);
        continue;
      }
      const best = [...locSlots]
        .filter((s) => s.maxRepetitionsPerHour > 0)
        .sort((a, b) => b.perRep - a.perRep || sortSlots(a, b))[0];
      if (best) {
        best.reps = 1;
        protectedLocations.add(locId);
      }
    }
  }

  const totalFromReps = () => withMeta.reduce((sum, s) => sum + s.reps * s.perRep, 0);

  let total = totalFromReps();

  // Garde-fou: si la cible est > 0 mais qu'aucune répétition n'a été allouée
  // (arrondis/planchers), forcer un minimum de répétitions sur les meilleurs créneaux.
  if (target > 0 && total <= 0) {
    const bootstrapCandidates = withMeta
      .filter((s) => s.maxRepetitionsPerHour > 0 && s.perRep > 0)
      .sort((a, b) => b.perRep - a.perRep || sortSlots(a, b));
    for (const s of bootstrapCandidates) {
      if (s.reps >= s.maxRepetitionsPerHour) continue;
      s.reps = Math.max(1, s.reps);
      total = totalFromReps();
      if (total > 0) break;
    }
  }

  // Ajustement fin: si au-dessus cible, retirer des répétitions.
  let protectEnabled = keepLocationsFirst;
  let guard = 0;
  while (total > target && guard < 200_000) {
    guard += 1;
    const repsByLoc = new Map<string, number>();
    for (const s of withMeta) {
      repsByLoc.set(s.locationId, (repsByLoc.get(s.locationId) ?? 0) + s.reps);
    }

    const candidates = withMeta
      .filter((s) => s.reps > 0)
      .filter((s) => {
        if (!protectEnabled) return true;
        if (!protectedLocations.has(s.locationId)) return true;
        return (repsByLoc.get(s.locationId) ?? 0) > 1;
      })
      .sort((a, b) => a.perRep - b.perRep || sortSlots(a, b));

    if (candidates.length === 0) {
      if (protectEnabled) {
        protectEnabled = false; // dernier recours: localités peuvent tomber à 0
        continue;
      }
      break;
    }
    const chosen = candidates[0];
    chosen.reps -= 1;
    total -= chosen.perRep;
  }

  // Ajustement fin: si en dessous, ajouter des répétitions sans dépasser le max du slot.
  guard = 0;
  while (total < target && guard < 200_000) {
    guard += 1;
    const candidates = withMeta
      .filter((s) => s.reps < s.maxRepetitionsPerHour)
      .sort((a, b) => b.perRep - a.perRep || sortSlots(a, b));
    if (candidates.length === 0) break;
    const chosen = candidates[0];
    chosen.reps += 1;
    total += chosen.perRep;
  }

  return withMeta.map((s) => ({
    locationId: s.locationId,
    diffusionDate: s.diffusionDate,
    diffusionHour: s.diffusionHour,
    maxImpressions: s.maxImpressions,
    maxRepetitionsPerHour: s.maxRepetitionsPerHour,
    plannedRepetitionsPerHour: s.reps,
    plannedImpressions: Math.max(0, Math.round(s.reps * s.perRep)),
  }));
}
```

- [ ] **Step 2: Move the test file.** `git mv apps/web/src/services/campaign-hourly-location-plan.service.test.ts apps/web/src/lib/dooh/hourly-plan.test.ts`, then change its import line from:

```ts
import {
  buildHybridAdjustedHourlyPlan,
  type HourlyPlanSlotInput,
} from './campaign-hourly-location-plan.service';
```

to:

```ts
import { buildHybridAdjustedHourlyPlan, type HourlyPlanSlotInput } from './hourly-plan';
```

Leave the rest of the test file (the `sampleSlots()` fixture and the 4 `describe('buildHybridAdjustedHourlyPlan', …)` cases) unchanged.

- [ ] **Step 3: Run the moved test — it must now pass**

Run: `pnpm test src/lib/dooh/hourly-plan.test.ts`
Expected: PASS — all 4 `it()` cases green, **0 failed**. (Previously this file couldn't even be imported. The fix is that `./hourly-plan` has zero imports, so no `createClient`.)

- [ ] **Step 4: Trim `apps/web/src/services/campaign-hourly-location-plan.service.ts`.** Remove lines 3-189 (the types, `stableSlotKey`, `sortSlots`, `buildHybridAdjustedHourlyPlan` — now in `lib/dooh/hourly-plan.ts`). Keep line 1 (`import { supabase } from '../lib/supabase';`), the private `toDateStr` (used by `getOccupiedRepetitionsByLocationFromHourlyPlan`), `replaceCampaignHourlyLocationPlan`, and `getOccupiedRepetitionsByLocationFromHourlyPlan`. Add a type import for `HourlyPlanSlotOutput` (used by `replaceCampaignHourlyLocationPlan`'s signature). The new top of the file:

```ts
import { supabase } from '../lib/supabase';

import type { HourlyPlanSlotOutput } from '../lib/dooh/hourly-plan';

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function replaceCampaignHourlyLocationPlan(
  campaignId: string,
  rows: readonly HourlyPlanSlotOutput[],
```

…then the existing bodies of `replaceCampaignHourlyLocationPlan` and `getOccupiedRepetitionsByLocationFromHourlyPlan` follow unchanged.

- [ ] **Step 5: Repoint `apps/web/src/services/campaign.service.ts`.** It currently imports `buildHybridAdjustedHourlyPlan` and `replaceCampaignHourlyLocationPlan` from `./campaign-hourly-location-plan.service` (around lines 1-8). Split that: keep `replaceCampaignHourlyLocationPlan` (and anything else still exported by that file) imported from `./campaign-hourly-location-plan.service`, and add a new import line:

```ts
import { buildHybridAdjustedHourlyPlan } from '../lib/dooh/hourly-plan';
```

Remove `buildHybridAdjustedHourlyPlan` from the `./campaign-hourly-location-plan.service` import list. Make no other changes to `campaign.service.ts`.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: exit 2, **179** `error TS…` lines (unchanged). If a new error mentions `buildHybridAdjustedHourlyPlan` or `HourlyPlanSlotOutput`, an import is wrong; fix and re-run.

- [ ] **Step 7: Full test run — the previously-failing test is now green**

Run: `pnpm test`
Expected: **exit 0**. **Test Files: 4 passed (4), 0 failed** (was 3 passed | 1 failed). All individual tests pass (26 — the prior 22 plus the 4 `buildHybridAdjustedHourlyPlan` cases that previously never ran). This is the headline check of Phase 4a: `pnpm test` exits 0.

- [ ] **Step 8: Lint + build**

Run: `pnpm lint` → exit 1, **1618 problems (1591 errors, 27 warnings)** (unchanged — `lib/dooh/hourly-plan.ts` and the relocated test are lint-clean; the trimmed `campaign-hourly-location-plan.service.ts` still has its 2 pre-existing `console.warn` in `getOccupiedRepetitionsByLocationFromHourlyPlan`).
Run: `pnpm --filter @toodooh/web build` → exit 0, **113** chunks (exact match to baseline); main-entry chunk gzip ≈ 128.6 kB (may move by < a few kB — code relocated; no new lazy chunk).

- [ ] **Step 9: Commit** (`--no-verify` expected — touches `campaign-hourly-location-plan.service.ts` (pre-existing `console.warn`) and `campaign.service.ts` (pre-existing `console.*`); lint count unchanged):

```bash
git add apps/web/src/lib/dooh/hourly-plan.ts apps/web/src/lib/dooh/hourly-plan.test.ts apps/web/src/services/campaign-hourly-location-plan.service.ts apps/web/src/services/campaign.service.ts
git commit --no-verify -m "refactor(dooh): extract buildHybridAdjustedHourlyPlan into lib/dooh/

The budget→repetitions algorithm leaves the Supabase-coupled service file;
its test moves alongside it. The previously-failing
campaign-hourly-location-plan test now passes because the math is reachable
without constructing the Supabase client. pnpm test exits 0."
```

(Note: `git mv` in Step 2 stages the rename; `git add` of the new path picks up the content edit. The old path `apps/web/src/services/campaign-hourly-location-plan.service.test.ts` no longer exists — confirm with `git status`.)

**Why a single commit:** the extraction, the test relocation, and the two import repointings are one logical change — "make `buildHybridAdjustedHourlyPlan` independently reachable" — and the verification gate (`pnpm test` exits 0) only holds when all four moves are present together. It is *not* part of 4a.1 because 4a.1 is a guaranteed-no-op move; this commit deliberately changes a test result. It is *not* part of 4b because 4b adds the *new* v3.0 module and must leave the bundle untouched (this commit changes which chunk `buildHybridAdjustedHourlyPlan` lands in).

---

# PHASE 4b — v3.0 pricing IP (unwired)

> **Deviation from the sketched factoring:** the original sketch put the 50/44/3/3 split in a separate 4b.4. This plan puts `splitRevenue` + `applyBudget` in **4b.2** (alongside `computeStandardCampaign`) because the simulator's `recalcNormale()` produces the per-screenhost revenue and the split right there — keeping them together makes 4b.2 a complete "standard campaign incl. budget + split" unit and 4b.4 a clean "mixed cart + docs" unit. Still four 4b commits. Each 4b commit touches *only* new files (`lib/dooh/v3-model.ts`, `lib/dooh/v3-model.test.ts`, `lib/dooh/README.md`) — all authored lint-clean — so **no `--no-verify`** is needed for any 4b commit. The new module is **unwired** (nothing in the app imports it), so the build output is unchanged for every 4b commit; if `pnpm build`'s chunk count or main size moves, something accidentally imported `v3-model.ts` — investigate before committing.

## Task 4b.1: `v3-model.ts` foundation — config, spot/rate, SPS

**Files:**
- Create: `apps/web/src/lib/dooh/v3-model.ts`
- Create: `apps/web/src/lib/dooh/v3-model.test.ts`

- [ ] **Step 1: Write the failing tests** — create `apps/web/src/lib/dooh/v3-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_DOOH_CONFIG_V3,
  clampSpotSeconds,
  credibilityThreshold,
  repetitionRate,
  screenhostPerformanceScore,
  spsColorBand,
  type ScreenhostInput,
} from './v3-model';

// The four demo screenhosts from the simulator (script lines ~1128-1137), adapted to the
// model's input shape. See ./README.md for what each represents.
function demoScreenhosts(): ScreenhostInput[] {
  return [
    {
      id: 'sh1', name: 'Café El Bey',
      operatingHoursPerDay: 8, affluencePerHour: 55, historicalMaxAffluence: 90,
      soldSlotsInPeriod: 0, refused: false, eventEligible: true,
      acceptanceRate: 0.95, eventRespectRate: 1.0, activityRate: 0.92,
      sensorQuality: 0.9, seniority: 0.8, fillRate: 0.6,
    },
    {
      id: 'sh2', name: 'Lounge Arts',
      operatingHoursPerDay: 6, affluencePerHour: 40, historicalMaxAffluence: 75,
      soldSlotsInPeriod: 0, refused: false, eventEligible: true,
      acceptanceRate: 0.85, eventRespectRate: 0.9, activityRate: 0.8,
      sensorQuality: 0.85, seniority: 0.5, fillRate: 0.45,
    },
    {
      id: 'sh3', name: 'Salle SportPlus',
      operatingHoursPerDay: 7, affluencePerHour: 35, historicalMaxAffluence: 60,
      soldSlotsInPeriod: 0, refused: false, eventEligible: false,
      acceptanceRate: 0.75, eventRespectRate: 0.7, activityRate: 0.7,
      sensorQuality: 0.75, seniority: 0.3, fillRate: 0.4,
    },
    {
      id: 'sh4', name: 'Bar Le Zinc',
      operatingHoursPerDay: 5, affluencePerHour: 30, historicalMaxAffluence: 80,
      soldSlotsInPeriod: 0, refused: false, eventEligible: true,
      acceptanceRate: 0.6, eventRespectRate: 0.5, activityRate: 0.65,
      sensorQuality: 0.6, seniority: 0.2, fillRate: 0.3,
    },
  ];
}

const CFG = DEFAULT_DOOH_CONFIG_V3;

describe('DEFAULT_DOOH_CONFIG_V3 invariants', () => {
  it('revenue split sums to 1', () => {
    const r = CFG.revenueSplit;
    expect(r.screenhost + r.toodooh + r.agentSh + r.agentSc).toBeCloseTo(1, 9);
  });
  it('SPS weights sum to 1', () => {
    const w = CFG.spsWeights;
    expect(
      w.txAccept + w.txRespectEvt + w.txActivite + w.qualiteCapteur + w.anciennete + w.txRemplissage,
    ).toBeCloseTo(1, 9);
  });
});

describe('clampSpotSeconds', () => {
  it('clamps to [1, 30]', () => {
    expect(clampSpotSeconds(0)).toBe(1);
    expect(clampSpotSeconds(0.5)).toBe(1);
    expect(clampSpotSeconds(36)).toBe(30);
    expect(clampSpotSeconds(15)).toBe(15);
  });
});

describe('credibilityThreshold (simulator getT)', () => {
  it('selects short / medium / long by spot length', () => {
    expect(credibilityThreshold(5, CFG)).toBe(0.5);
    expect(credibilityThreshold(10, CFG)).toBe(0.5);
    expect(credibilityThreshold(11, CFG)).toBe(0.65);
    expect(credibilityThreshold(20, CFG)).toBe(0.65);
    expect(credibilityThreshold(21, CFG)).toBe(0.8);
    expect(credibilityThreshold(30, CFG)).toBe(0.8);
  });
});

describe('repetitionRate (simulator getR)', () => {
  // With default F = 300, the frequency ceiling F/s always wins → R = 300/s.
  it.each([
    [5, 60], [10, 30], [15, 20], [20, 15], [25, 12], [30, 10],
  ])('S=%is → R=%i (frequency-limited at default F)', (s, r) => {
    const out = repetitionRate(s, CFG);
    expect(out.rate).toBeCloseTo(r, 6);
    expect(out.limitedBy).toBe('frequency');
  });

  it('becomes credibility-limited when F is large', () => {
    const cfg = { ...CFG, frequencyCapSecondsPerHour: 3600 };
    // S=10: R_T = (3600/10)·0.5 = 180 ; R_F = 3600/10 = 360 → R = 180.
    const out = repetitionRate(10, cfg);
    expect(out.rate).toBeCloseTo(180, 6);
    expect(out.limitedBy).toBe('credibility');
  });
});

describe('screenhostPerformanceScore (simulator calcSPS)', () => {
  it('matches the simulator for the four demo screenhosts', () => {
    const [sh1, sh2, sh3, sh4] = demoScreenhosts();
    expect(screenhostPerformanceScore(sh1, CFG)).toBeCloseTo(91.15, 6);
    expect(screenhostPerformanceScore(sh2, CFG)).toBeCloseTo(79.75, 6);
    expect(screenhostPerformanceScore(sh3, CFG)).toBeCloseTo(66.75, 6);
    expect(screenhostPerformanceScore(sh4, CFG)).toBeCloseTo(53.0, 6);
  });

  it('SPS = 100 when every criterion is 1 (weights sum to 1)', () => {
    const allOnes: ScreenhostInput = {
      ...demoScreenhosts()[0],
      acceptanceRate: 1, eventRespectRate: 1, activityRate: 1,
      sensorQuality: 1, seniority: 1, fillRate: 1,
    };
    expect(screenhostPerformanceScore(allOnes, CFG)).toBeCloseTo(100, 6);
  });
});

describe('spsColorBand', () => {
  it('maps to green / yellow / red at 75 / 50', () => {
    expect(spsColorBand(91.15, CFG)).toBe('green');
    expect(spsColorBand(75, CFG)).toBe('green');
    expect(spsColorBand(66.75, CFG)).toBe('yellow');
    expect(spsColorBand(50, CFG)).toBe('yellow');
    expect(spsColorBand(49.9, CFG)).toBe('red');
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `pnpm test src/lib/dooh/v3-model.test.ts`
Expected: FAIL — `Cannot find module './v3-model'` (or "is not exported by"), because `v3-model.ts` doesn't exist yet.

- [ ] **Step 3: Create `apps/web/src/lib/dooh/v3-model.ts`** with the foundation:

```ts
/**
 * TOODOOH DOOH pricing — v3.0 model (pure functions).
 *
 * This module is the project's pricing IP. Every function here is pure: deterministic output
 * from inputs, no I/O, no module-level side effects, no Date.now()/Math.random(). It is written
 * to move to `apps/api/` verbatim when Phase 1 starts.
 *
 * Behavioral reference: `docs/handoff/Toodooh_Simulateur_Pricing_v3.html` (the simulator's
 * <script> section). See `./README.md` for the function↔simulator mapping, the model vocabulary,
 * the documented assumptions, and the demo-screenhost test fixtures.
 *
 * This module is currently UNWIRED — nothing in the app imports it. Wiring it into the
 * wizard/cart/screenhost flows (and the schema it needs) is Phase 1 work; see
 * `docs/handoff/v3-data-requirements.md`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Config — every value here is a parameter, never hardcoded in a formula.
// Defaults from `docs/handoff/pricing-model-v3.md`.
// ─────────────────────────────────────────────────────────────────────────────

export type DoohConfigV3 = {
  /** CPM — cost per 1000 impressions, TND. */
  cpmTnd: number;
  /** CPM_evt = cpmTnd × this. */
  cpmEventCoefficient: number;
  /** F — caps spot repetition to one every F seconds (the frequency ceiling on repeats/hour is F/s). */
  frequencyCapSecondsPerHour: number;
  /** Credibility ceilings on impressions/hour by spot length. */
  credibilityThresholds: {
    /** Spots ≤ this many seconds use `shortValue`. */
    shortMaxSeconds: number;
    shortValue: number;
    /** Spots ≤ this many seconds (and > shortMaxSeconds) use `mediumValue`. */
    mediumMaxSeconds: number;
    mediumValue: number;
    /** Spots > mediumMaxSeconds use `longValue`. */
    longValue: number;
  };
  /** SPS criterion weights — must sum to 1. */
  spsWeights: {
    txAccept: number; // w1
    txRespectEvt: number; // w2
    txActivite: number; // w3
    qualiteCapteur: number; // w4
    anciennete: number; // w5
    txRemplissage: number; // w6
  };
  /** SPS → colour band cutoffs (0..100): ≥ greenMinScore → 'green'; ≥ yellowMinScore → 'yellow'; else 'red'. */
  spsColorBands: { greenMinScore: number; yellowMinScore: number };
  /** Revenue split — must sum to 1. */
  revenueSplit: { screenhost: number; toodooh: number; agentSh: number; agentSc: number };
  /** Event window padding, hours, applied on EACH side of the match (window = padding + duration + padding). */
  eventWindowPaddingHours: number;
};

export const DEFAULT_DOOH_CONFIG_V3: DoohConfigV3 = {
  cpmTnd: 15,
  cpmEventCoefficient: 2, // CPM_evt = 30
  frequencyCapSecondsPerHour: 300,
  credibilityThresholds: {
    shortMaxSeconds: 10,
    shortValue: 0.5,
    mediumMaxSeconds: 20,
    mediumValue: 0.65,
    longValue: 0.8,
  },
  spsWeights: {
    txAccept: 0.25,
    txRespectEvt: 0.3,
    txActivite: 0.2,
    qualiteCapteur: 0.1,
    anciennete: 0.05,
    txRemplissage: 0.1,
  },
  spsColorBands: { greenMinScore: 75, yellowMinScore: 50 },
  revenueSplit: { screenhost: 0.5, toodooh: 0.44, agentSh: 0.03, agentSc: 0.03 },
  eventWindowPaddingHours: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Spot length and repetition rate
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_SPOT_SECONDS = 1;
export const MAX_SPOT_SECONDS = 30;

/** Simulator `clampS()`: spot length is constrained to [1, 30] seconds. */
export function clampSpotSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_SPOT_SECONDS;
  return Math.min(MAX_SPOT_SECONDS, Math.max(MIN_SPOT_SECONDS, seconds));
}

/** Simulator `getT(s)`: credibility ceiling for a spot of `seconds`. */
export function credibilityThreshold(seconds: number, config: DoohConfigV3): number {
  const s = clampSpotSeconds(seconds);
  const t = config.credibilityThresholds;
  if (s <= t.shortMaxSeconds) return t.shortValue;
  if (s <= t.mediumMaxSeconds) return t.mediumValue;
  return t.longValue;
}

export type RepetitionRate = {
  /** R — billable spot repetitions per hour. */
  rate: number;
  /** Which ceiling is binding. */
  limitedBy: 'frequency' | 'credibility';
};

/**
 * Simulator `getR(s) = min((3600/s)·T(s), F/s)`.
 * `R_T = (3600/s)·T` is the credibility ceiling; `R_F = F/s` is the frequency ceiling.
 */
export function repetitionRate(seconds: number, config: DoohConfigV3): RepetitionRate {
  const s = clampSpotSeconds(seconds);
  const rCredibility = (3600 / s) * credibilityThreshold(s, config);
  const rFrequency = config.frequencyCapSecondsPerHour / s;
  if (rFrequency <= rCredibility) return { rate: rFrequency, limitedBy: 'frequency' };
  return { rate: rCredibility, limitedBy: 'credibility' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenhost performance score (SPS)
// ─────────────────────────────────────────────────────────────────────────────

export type ScreenhostCriteria = {
  acceptanceRate: number; // txAccept,  0..1
  eventRespectRate: number; // txRespectEvt
  activityRate: number; // txActivite
  sensorQuality: number; // qualiteCapteur
  seniority: number; // anciennete
  fillRate: number; // txRemplissage
};

/** Simulator `calcSPS(sh)`: weighted sum of the six criteria, scaled to 0..100. */
export function screenhostPerformanceScore(c: ScreenhostCriteria, config: DoohConfigV3): number {
  const w = config.spsWeights;
  return (
    (w.txAccept * c.acceptanceRate +
      w.txRespectEvt * c.eventRespectRate +
      w.txActivite * c.activityRate +
      w.qualiteCapteur * c.sensorQuality +
      w.anciennete * c.seniority +
      w.txRemplissage * c.fillRate) *
    100
  );
}

export type SpsColorBand = 'green' | 'yellow' | 'red';

/** Simulator `spsColor(sps)`: ≥ greenMinScore → 'green'; ≥ yellowMinScore → 'yellow'; else 'red'. */
export function spsColorBand(sps: number, config: DoohConfigV3): SpsColorBand {
  if (sps >= config.spsColorBands.greenMinScore) return 'green';
  if (sps >= config.spsColorBands.yellowMinScore) return 'yellow';
  return 'red';
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenhost input for campaign math (used by computeStandardCampaign / computeEventCampaign)
// ─────────────────────────────────────────────────────────────────────────────

export type ScreenhostInput = ScreenhostCriteria & {
  id: string;
  name?: string;
  /** Ei — operating hours per day. */
  operatingHoursPerDay: number;
  /** Ai — regular affluence (people/hour). */
  affluencePerHour: number;
  /** A_max — historical maximum affluence (people/hour); used for event impressions only. */
  historicalMaxAffluence: number;
  /** Oi — already-sold spot slots over the campaign period. */
  soldSlotsInPeriod: number;
  /** Refused this campaign → 0 revenue, excluded from I_max (cascade). */
  refused: boolean;
  /** eligibleEvt — participates in events. */
  eventEligible: boolean;
};
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm test src/lib/dooh/v3-model.test.ts`
Expected: PASS — all cases green (`clampSpotSeconds`, `credibilityThreshold`, `repetitionRate` ×7, `screenhostPerformanceScore` ×2, `spsColorBand`).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck` → 179 errors (unchanged). `pnpm lint` → 1618/1591/27 (unchanged — `v3-model.ts` and its test are lint-clean). `pnpm test` → exit 0, **Test Files 5 passed (5), 0 failed**. `pnpm --filter @toodooh/web build` → exit 0 — **chunk count exact match to post-4a (113); main-entry gzip within ±100 B of the post-4a value (≈ 128.6 kB)**, because nothing imports `v3-model.ts` (tree-shaken). If the chunk count diverges or the gzip drifts > ±100 B → **halt**, find the accidental import, before committing.

- [ ] **Step 6: Commit** (no `--no-verify` — only new lint-clean files):

```bash
git add apps/web/src/lib/dooh/v3-model.ts apps/web/src/lib/dooh/v3-model.test.ts
git commit -m "feat(dooh): add v3.0 pricing model foundation (config, R, SPS)

New pure module lib/dooh/v3-model.ts: the v3.0 config object with defaults,
clampSpotSeconds, credibilityThreshold (getT), repetitionRate (getR),
screenhostPerformanceScore (calcSPS), spsColorBand, and the ScreenhostInput
type. Tested against the simulator's numeric examples. Unwired — nothing in
the app imports it yet (Phase 1 wiring; see docs/handoff/v3-data-requirements.md)."
```

**Why a single commit:** it's the self-contained foundation (config + the leaf functions everything else builds on), verified by simulator-fixture tests. It's separate from 4b.2 because the campaign math depends on these primitives and is large enough to want its own review pass.

---

## Task 4b.2: standard campaign — `computeStandardCampaign`, cascade, `splitRevenue`, `applyBudget`

**Files:**
- Modify: `apps/web/src/lib/dooh/v3-model.ts` (append the new section)
- Modify: `apps/web/src/lib/dooh/v3-model.test.ts` (append the new `describe` blocks)

- [ ] **Step 1: Write the failing tests** — append to `apps/web/src/lib/dooh/v3-model.test.ts`. First update the import block at the top to also pull in the new symbols:

```ts
import {
  DEFAULT_DOOH_CONFIG_V3,
  clampSpotSeconds,
  credibilityThreshold,
  repetitionRate,
  screenhostPerformanceScore,
  spsColorBand,
  computeStandardCampaign,
  splitRevenue,
  applyBudget,
  type ScreenhostInput,
} from './v3-model';
```

Then append these `describe` blocks at the end of the file:

```ts
describe('computeStandardCampaign (simulator recalcNormale)', () => {
  // S=10 → R=30 ; N=25 ; CPM=15 ; no co-selected event.
  it('matches the simulator demo (S=10, N=25)', () => {
    const r = computeStandardCampaign({
      screenhosts: demoScreenhosts(),
      spotSeconds: 10,
      campaignDays: 25,
      eventSlotsBlockedHours: 0,
      config: CFG,
    });
    expect(r.repetitionRate).toBeCloseTo(30, 6);
    const byId = Object.fromEntries(r.accepting.map((a) => [a.id, a]));
    // Hi = Ei·N − 0 − 0 : sh1 200, sh2 150, sh3 175, sh4 125
    expect(byId.sh1.netAvailabilityHours).toBe(200);
    expect(byId.sh2.netAvailabilityHours).toBe(150);
    // Ii = Ai·Hi·R : sh1 330000, sh3 183750
    expect(byId.sh1.impressions).toBeCloseTo(330_000, 6);
    expect(byId.sh3.impressions).toBeCloseTo(183_750, 6);
    expect(r.maxImpressions).toBeCloseTo(806_250, 6);
    expect(r.maxBudgetTnd).toBeCloseTo(12_093.75, 6);
    // SPS-descending ranking
    expect(r.accepting.map((a) => a.id)).toEqual(['sh1', 'sh2', 'sh3', 'sh4']);
    expect(r.accepting.map((a) => a.rank)).toEqual([1, 2, 3, 4]);
    expect(r.refused).toEqual([]);
    expect(r.accepting.reduce((s, a) => s + a.impressionShare, 0)).toBeCloseTo(1, 6);
  });

  it('cascade: a refused screenhost gets 0 revenue and is excluded from I_max', () => {
    const shs = demoScreenhosts();
    shs[3].refused = true; // Bar Le Zinc
    const r = computeStandardCampaign({
      screenhosts: shs, spotSeconds: 10, campaignDays: 25, eventSlotsBlockedHours: 0, config: CFG,
    });
    expect(r.maxImpressions).toBeCloseTo(806_250 - 112_500, 6); // 693750
    expect(r.accepting.map((a) => a.id)).toEqual(['sh1', 'sh2', 'sh3']);
    expect(r.refused.map((x) => x.id)).toEqual(['sh4']);
    expect(r.accepting.reduce((s, a) => s + a.impressionShare, 0)).toBeCloseTo(1, 6);
  });

  it('event slots reduce Hi for every accepting screenhost', () => {
    const r = computeStandardCampaign({
      screenhosts: demoScreenhosts(), spotSeconds: 10, campaignDays: 25, eventSlotsBlockedHours: 4.5, config: CFG,
    });
    const byId = Object.fromEntries(r.accepting.map((a) => [a.id, a]));
    expect(byId.sh1.netAvailabilityHours).toBeCloseTo(200 - 4.5, 6); // 195.5
    expect(byId.sh4.netAvailabilityHours).toBeCloseTo(125 - 4.5, 6); // 120.5
  });

  it('Hi never goes negative', () => {
    const shs = demoScreenhosts();
    shs[0].soldSlotsInPeriod = 999_999;
    const r = computeStandardCampaign({
      screenhosts: shs, spotSeconds: 10, campaignDays: 25, eventSlotsBlockedHours: 0, config: CFG,
    });
    const sh1 = r.accepting.find((a) => a.id === 'sh1')!;
    expect(sh1.netAvailabilityHours).toBe(0);
    expect(sh1.impressions).toBe(0);
  });
});

describe('splitRevenue (simulator rep-amounts, 50/44/3/3)', () => {
  it('splits an amount across the four parties', () => {
    const s = splitRevenue(6000, CFG);
    expect(s.screenhostsTnd).toBeCloseTo(3000, 6);
    expect(s.toodoohTnd).toBeCloseTo(2640, 6);
    expect(s.agentShTnd).toBeCloseTo(180, 6);
    expect(s.agentScTnd).toBeCloseTo(180, 6);
    expect(s.screenhostsTnd + s.toodoohTnd + s.agentShTnd + s.agentScTnd).toBeCloseTo(6000, 6);
  });
  it('clamps negatives to 0', () => {
    expect(splitRevenue(-100, CFG).screenhostsTnd).toBe(0);
  });
});

describe('applyBudget (simulator slider + per-screenhost revenue)', () => {
  const std = () =>
    computeStandardCampaign({
      screenhosts: demoScreenhosts(), spotSeconds: 10, campaignDays: 25, eventSlotsBlockedHours: 0, config: CFG,
    });

  it('clamps to C_max, computes fill rate, I_cible, and per-screenhost revenue', () => {
    const b = applyBudget(std(), 6000, CFG);
    expect(b.targetBudgetTnd).toBeCloseTo(6000, 6);
    expect(b.purchasedImpressions).toBeCloseTo(400_000, 6); // 6000·1000/15
    expect(b.fillRate).toBeCloseTo(6000 / 12_093.75, 6);
    const byId = Object.fromEntries(b.perScreenhost.map((p) => [p.id, p.revenueTnd]));
    // rev_i = (50% of C_cible) · (Ii / I_max)
    expect(byId.sh1).toBeCloseTo(3000 * (330_000 / 806_250), 6);
    expect(byId.sh4).toBeCloseTo(3000 * (112_500 / 806_250), 6);
    expect(b.perScreenhost.reduce((s, p) => s + p.revenueTnd, 0)).toBeCloseTo(3000, 6);
    expect(b.split.screenhostsTnd).toBeCloseTo(3000, 6);
  });

  it('over-budget requests are clamped to C_max (fill rate = 1)', () => {
    const b = applyBudget(std(), 999_999, CFG);
    expect(b.targetBudgetTnd).toBeCloseTo(12_093.75, 6);
    expect(b.fillRate).toBeCloseTo(1, 6);
  });

  it('zero C_max ⇒ zero everything, no division by zero', () => {
    const empty = computeStandardCampaign({
      screenhosts: [], spotSeconds: 10, campaignDays: 25, eventSlotsBlockedHours: 0, config: CFG,
    });
    const b = applyBudget(empty, 1000, CFG);
    expect(b.targetBudgetTnd).toBe(0);
    expect(b.fillRate).toBe(0);
    expect(b.perScreenhost).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm test src/lib/dooh/v3-model.test.ts`
Expected: FAIL — `computeStandardCampaign`/`splitRevenue`/`applyBudget` are not exported.

- [ ] **Step 3: Append to `apps/web/src/lib/dooh/v3-model.ts`** (after the `ScreenhostInput` type):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Standard campaign — simulator `recalcNormale()`
// ─────────────────────────────────────────────────────────────────────────────

export type StandardCampaignParams = {
  screenhosts: readonly ScreenhostInput[];
  /** S — spot length, seconds. */
  spotSeconds: number;
  /** N — campaign duration, days. */
  campaignDays: number;
  /** evtSlots — hours per establishment blocked by a co-selected event (0 if none). */
  eventSlotsBlockedHours: number;
  config: DoohConfigV3;
};

export type ScreenhostAllocation = {
  id: string;
  name?: string;
  sps: number;
  /** 1-based rank by SPS descending (cascade priority order). */
  rank: number;
  /** Hi = max(0, Ei·N − Oi − evtSlots). */
  netAvailabilityHours: number;
  /** Ii = Ai·Hi·R. */
  impressions: number;
  /** Ii / I_max (0 when I_max = 0). */
  impressionShare: number;
};

export type StandardCampaignResult = {
  /** R — repetitions per hour for this spot length. */
  repetitionRate: number;
  /** Accepting screenhosts, sorted by SPS descending. */
  accepting: readonly ScreenhostAllocation[];
  /** Refused screenhosts (0 revenue, excluded from I_max). */
  refused: readonly { id: string; name?: string; sps: number }[];
  /** I_max = Σ Ii over accepting screenhosts. */
  maxImpressions: number;
  /** C_max = CPM·I_max/1000. */
  maxBudgetTnd: number;
};

export function computeStandardCampaign(p: StandardCampaignParams): StandardCampaignResult {
  const { config } = p;
  const R = repetitionRate(p.spotSeconds, config).rate;
  const N = Math.max(0, p.campaignDays);
  const evtSlots = Math.max(0, p.eventSlotsBlockedHours);

  const refused = p.screenhosts
    .filter((s) => s.refused)
    .map((s) => ({ id: s.id, name: s.name, sps: screenhostPerformanceScore(s, config) }));

  const acceptingRaw = p.screenhosts
    .filter((s) => !s.refused)
    .map((s) => {
      const sps = screenhostPerformanceScore(s, config);
      const Hi = Math.max(0, s.operatingHoursPerDay * N - s.soldSlotsInPeriod - evtSlots);
      const Ii = Math.max(0, s.affluencePerHour) * Hi * R;
      return { id: s.id, name: s.name, sps, netAvailabilityHours: Hi, impressions: Ii };
    })
    .sort((a, b) => b.sps - a.sps || a.id.localeCompare(b.id));

  const maxImpressions = acceptingRaw.reduce((acc, s) => acc + s.impressions, 0);
  const accepting: ScreenhostAllocation[] = acceptingRaw.map((s, i) => ({
    ...s,
    rank: i + 1,
    impressionShare: maxImpressions > 0 ? s.impressions / maxImpressions : 0,
  }));

  return {
    repetitionRate: R,
    accepting,
    refused,
    maxImpressions,
    maxBudgetTnd: (config.cpmTnd * maxImpressions) / 1000,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue split — 50/44/3/3 — simulator `rep-amounts-*`
// ─────────────────────────────────────────────────────────────────────────────

export type RevenueSplit = {
  screenhostsTnd: number;
  toodoohTnd: number;
  agentShTnd: number;
  agentScTnd: number;
};

export function splitRevenue(amountTnd: number, config: DoohConfigV3): RevenueSplit {
  const a = Math.max(0, amountTnd);
  const r = config.revenueSplit;
  return {
    screenhostsTnd: a * r.screenhost,
    toodoohTnd: a * r.toodooh,
    agentShTnd: a * r.agentSh,
    agentScTnd: a * r.agentSc,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget application — simulator slider + per-screenhost revenue
// ─────────────────────────────────────────────────────────────────────────────

export type BudgetAllocation = {
  /** C_cible — requested budget clamped to ≤ C_max. */
  targetBudgetTnd: number;
  /** I_cible = C_cible·1000/CPM. */
  purchasedImpressions: number;
  /** taux_fill = C_cible / C_max (0 when C_max = 0). */
  fillRate: number;
  /** Split of C_cible. */
  split: RevenueSplit;
  /** Per accepting/eligible screenhost: (screenhost share of C_cible) · impressionShare. */
  perScreenhost: readonly { id: string; name?: string; revenueTnd: number }[];
};

/**
 * Given a standard-campaign result and a requested budget, clamp to C_max and distribute the
 * screenhost portion of the budget proportionally to each screenhost's impression share.
 */
export function applyBudget(
  result: StandardCampaignResult,
  requestedBudgetTnd: number,
  config: DoohConfigV3,
): BudgetAllocation {
  const cMax = result.maxBudgetTnd;
  const cCible = Math.min(Math.max(0, requestedBudgetTnd), cMax);
  const split = splitRevenue(cCible, config);
  return {
    targetBudgetTnd: cCible,
    purchasedImpressions: config.cpmTnd > 0 ? (cCible * 1000) / config.cpmTnd : 0,
    fillRate: cMax > 0 ? cCible / cMax : 0,
    split,
    perScreenhost: result.accepting.map((s) => ({
      id: s.id,
      name: s.name,
      revenueTnd: split.screenhostsTnd * s.impressionShare,
    })),
  };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm test src/lib/dooh/v3-model.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Full gate**

`pnpm typecheck` → 179 (unchanged). `pnpm lint` → 1618/1591/27 (unchanged). `pnpm test` → exit 0, **Test Files 5 passed (5)**. `pnpm --filter @toodooh/web build` → exit 0 — chunk count exact (113); main-entry gzip within ±100 B of post-4a (≈ 128.6 kB); still unwired — halt if either diverges.

- [ ] **Step 6: Commit** (no `--no-verify`):

```bash
git add apps/web/src/lib/dooh/v3-model.ts apps/web/src/lib/dooh/v3-model.test.ts
git commit -m "feat(dooh): v3.0 standard campaign — Hi/Ii/I_max/C_max, cascade, budget, 50/44/3/3 split

computeStandardCampaign (recalcNormale): per-screenhost net availability,
impressions, I_max, C_max, SPS-ranked accepting list, refused list (cascade).
splitRevenue (50/44/3/3) and applyBudget (C_cible clamp, fill rate, I_cible,
per-screenhost revenue). Tested against the simulator's S=10/N=25 demo,
cascade, and edge cases. Still unwired."
```

**Why a single commit:** `computeStandardCampaign`, `splitRevenue`, and `applyBudget` together are the complete "standard campaign" path the simulator's `recalcNormale()` implements (the per-screenhost revenue *is* the split applied to `C_cible`); splitting them would leave half-tested intermediate states. Separate from 4b.1 (which is the leaf primitives) and 4b.3 (the event path is independent and large).

---

## Task 4b.3: event campaign — `computeEventCampaign`, `applyEventBudget`

**Files:**
- Modify: `apps/web/src/lib/dooh/v3-model.ts` (append)
- Modify: `apps/web/src/lib/dooh/v3-model.test.ts` (append + import update)

- [ ] **Step 1: Write the failing tests** — update the test import block to add `computeEventCampaign, applyEventBudget`, then append:

```ts
describe('computeEventCampaign (simulator recalcEvenement)', () => {
  // Event: matchDuration 2.5h, default coeff 2 ; S=10 → R=30 ; CPM=15 → CPM_evt=30.
  it('matches the simulator demo (Champions League finale, 2.5h)', () => {
    const r = computeEventCampaign({
      screenhosts: demoScreenhosts(),
      event: { id: 'e1', name: 'Champions League — Finale', matchDurationHours: 2.5 },
      spotSeconds: 10,
      config: CFG,
    });
    expect(r.repetitionRate).toBeCloseTo(30, 6);
    expect(r.windowHours).toBeCloseTo(4.5, 6); // 1 + 2.5 + 1
    expect(r.eventCpmTnd).toBeCloseTo(30, 6); // 15 × 2
    expect(r.slotsBlockedHours).toBeCloseTo(4.5, 6);
    // Eligible: sh1, sh2, sh4 (sh3 is not eventEligible), SPS-ordered.
    expect(r.eligible.map((e) => e.id)).toEqual(['sh1', 'sh2', 'sh4']);
    const byId = Object.fromEntries(r.eligible.map((e) => [e.id, e]));
    // Ii_evt = A_max·windowHours·R
    expect(byId.sh1.impressions).toBeCloseTo(90 * 4.5 * 30, 6); // 12150
    expect(byId.sh2.impressions).toBeCloseTo(75 * 4.5 * 30, 6); // 10125
    expect(byId.sh4.impressions).toBeCloseTo(80 * 4.5 * 30, 6); // 10800
    expect(r.maxImpressions).toBeCloseTo(12_150 + 10_125 + 10_800, 6); // 33075
    expect(r.maxBudgetTnd).toBeCloseTo((30 * 33_075) / 1000, 6); // 992.25
    expect(r.eligible.reduce((s, e) => s + e.impressionShare, 0)).toBeCloseTo(1, 6);
  });

  it('honours a per-event CPM coefficient override', () => {
    const r = computeEventCampaign({
      screenhosts: demoScreenhosts(),
      event: { id: 'e9', matchDurationHours: 2, cpmCoefficient: 3 },
      spotSeconds: 10, config: CFG,
    });
    expect(r.eventCpmTnd).toBeCloseTo(45, 6); // 15 × 3
  });

  it('a refused screenhost is excluded even if event-eligible', () => {
    const shs = demoScreenhosts();
    shs[0].refused = true; // Café El Bey
    const r = computeEventCampaign({
      screenhosts: shs, event: { id: 'e1', matchDurationHours: 2.5 }, spotSeconds: 10, config: CFG,
    });
    expect(r.eligible.map((e) => e.id)).toEqual(['sh2', 'sh4']);
  });
});

describe('applyEventBudget', () => {
  const evt = () =>
    computeEventCampaign({
      screenhosts: demoScreenhosts(), event: { id: 'e1', matchDurationHours: 2.5 }, spotSeconds: 10, config: CFG,
    });
  it('uses CPM_evt for purchased impressions and 50% for the screenhost pool', () => {
    const b = applyEventBudget(evt(), 500, CFG);
    expect(b.targetBudgetTnd).toBeCloseTo(500, 6);
    expect(b.purchasedImpressions).toBeCloseTo((500 * 1000) / 30, 6);
    expect(b.fillRate).toBeCloseTo(500 / 992.25, 6);
    expect(b.perScreenhost.reduce((s, p) => s + p.revenueTnd, 0)).toBeCloseTo(250, 6);
  });
  it('over-budget clamps to C_evt_max', () => {
    const b = applyEventBudget(evt(), 999_999, CFG);
    expect(b.targetBudgetTnd).toBeCloseTo(992.25, 6);
    expect(b.fillRate).toBeCloseTo(1, 6);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm test src/lib/dooh/v3-model.test.ts`
Expected: FAIL — `computeEventCampaign`/`applyEventBudget` not exported.

- [ ] **Step 3: Append to `apps/web/src/lib/dooh/v3-model.ts`** (after `applyBudget`):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Event campaign — simulator `recalcEvenement()`
// ─────────────────────────────────────────────────────────────────────────────

export type EventInput = {
  id: string;
  name?: string;
  /** Match duration, hours. */
  matchDurationHours: number;
  /** Override the config's event CPM coefficient for this event (defaults to config.cpmEventCoefficient). */
  cpmCoefficient?: number;
};

export type EventScreenhostAllocation = {
  id: string;
  name?: string;
  sps: number;
  rank: number;
  /** Hi_evt — total event window in hours. */
  windowHours: number;
  /** Ii_evt = A_max·Hi_evt·R. */
  impressions: number;
  impressionShare: number;
};

export type EventCampaignResult = {
  repetitionRate: number;
  /** Hi_evt = padding + matchDuration + padding (padding = config.eventWindowPaddingHours, each side). */
  windowHours: number;
  /** CPM_evt = CPM × coefficient. */
  eventCpmTnd: number;
  /** Eligible screenhosts (eventEligible && !refused), sorted by SPS descending. */
  eligible: readonly EventScreenhostAllocation[];
  /** I_evt_max = Σ Ii_evt. */
  maxImpressions: number;
  /** C_evt_max = CPM_evt·I_evt_max/1000. */
  maxBudgetTnd: number;
  /** Hours this event blocks from a co-selected standard campaign (= windowHours). Feed into `StandardCampaignParams.eventSlotsBlockedHours`. */
  slotsBlockedHours: number;
};

export function computeEventCampaign(p: {
  screenhosts: readonly ScreenhostInput[];
  event: EventInput;
  spotSeconds: number;
  config: DoohConfigV3;
}): EventCampaignResult {
  const { config } = p;
  const R = repetitionRate(p.spotSeconds, config).rate;
  const windowHours =
    config.eventWindowPaddingHours +
    Math.max(0, p.event.matchDurationHours) +
    config.eventWindowPaddingHours;
  const coeff = p.event.cpmCoefficient ?? config.cpmEventCoefficient;
  const eventCpmTnd = config.cpmTnd * coeff;

  const eligibleRaw = p.screenhosts
    .filter((s) => !s.refused && s.eventEligible)
    .map((s) => {
      const sps = screenhostPerformanceScore(s, config);
      const Ii = Math.max(0, s.historicalMaxAffluence) * windowHours * R;
      return { id: s.id, name: s.name, sps, windowHours, impressions: Ii };
    })
    .sort((a, b) => b.sps - a.sps || a.id.localeCompare(b.id));

  const maxImpressions = eligibleRaw.reduce((acc, s) => acc + s.impressions, 0);
  const eligible: EventScreenhostAllocation[] = eligibleRaw.map((s, i) => ({
    ...s,
    rank: i + 1,
    impressionShare: maxImpressions > 0 ? s.impressions / maxImpressions : 0,
  }));

  return {
    repetitionRate: R,
    windowHours,
    eventCpmTnd,
    eligible,
    maxImpressions,
    maxBudgetTnd: (eventCpmTnd * maxImpressions) / 1000,
    slotsBlockedHours: windowHours,
  };
}

export function applyEventBudget(
  result: EventCampaignResult,
  requestedBudgetTnd: number,
  config: DoohConfigV3,
): BudgetAllocation {
  const cMax = result.maxBudgetTnd;
  const cCible = Math.min(Math.max(0, requestedBudgetTnd), cMax);
  const split = splitRevenue(cCible, config);
  return {
    targetBudgetTnd: cCible,
    purchasedImpressions: result.eventCpmTnd > 0 ? (cCible * 1000) / result.eventCpmTnd : 0,
    fillRate: cMax > 0 ? cCible / cMax : 0,
    split,
    perScreenhost: result.eligible.map((s) => ({
      id: s.id,
      name: s.name,
      revenueTnd: split.screenhostsTnd * s.impressionShare,
    })),
  };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm test src/lib/dooh/v3-model.test.ts` → PASS.

- [ ] **Step 5: Full gate** — `pnpm typecheck` 179, `pnpm lint` 1618/1591/27, `pnpm test` exit 0 / 5 files, `pnpm --filter @toodooh/web build` chunk count exact (113) + main-entry gzip within ±100 B of post-4a (still unwired — halt if not).

- [ ] **Step 6: Commit** (no `--no-verify`):

```bash
git add apps/web/src/lib/dooh/v3-model.ts apps/web/src/lib/dooh/v3-model.test.ts
git commit -m "feat(dooh): v3.0 event campaign — amax·window·R, eligibility, CPM_evt, budget

computeEventCampaign (recalcEvenement): event window = before + duration +
after, CPM_evt = CPM × coeff (default ×2), eligible = eventEligible && !refused
ranked by SPS, Ii_evt = A_max·window·R, I_evt_max / C_evt_max, slotsBlocked
(hours to subtract from a co-selected standard campaign's Hi). applyEventBudget
mirrors applyBudget over the event CPM. Tested against the simulator's
Champions-League-finale demo. Still unwired."
```

**Why a single commit:** the event path (`computeEventCampaign` + `applyEventBudget`) is structurally independent of the standard path and self-tested by the simulator's event demo. It builds on 4b.1's `repetitionRate`/`screenhostPerformanceScore` and reuses 4b.2's `splitRevenue`/`BudgetAllocation`, so it must come after them; it's separate because it's large enough to want its own review and the standard path is already complete and green without it.

---

## Task 4b.4: mixed cart + `lib/dooh/README.md` + final test self-review

**Files:**
- Modify: `apps/web/src/lib/dooh/v3-model.ts` (append `combineCart`)
- Modify: `apps/web/src/lib/dooh/v3-model.test.ts` (append + import update; self-review pass)
- Create: `apps/web/src/lib/dooh/README.md`

- [ ] **Step 1: Write the failing tests** — add `combineCart, type CartLine` to the test import block, then append:

```ts
describe('combineCart (simulator recalcPanier)', () => {
  it('sums a standard line + an event line per screenhost; per-line and total splits agree', () => {
    const std = computeStandardCampaign({
      screenhosts: demoScreenhosts(),
      spotSeconds: 10,
      campaignDays: 25,
      // a co-selected 2.5h event blocks 1+2.5+1 = 4.5h from the standard campaign
      eventSlotsBlockedHours: 4.5,
      config: CFG,
    });
    const evt = computeEventCampaign({
      screenhosts: demoScreenhosts(), event: { id: 'e1', matchDurationHours: 2.5 }, spotSeconds: 10, config: CFG,
    });
    const lines: CartLine[] = [
      { kind: 'standard', label: 'Campagne normale', budget: applyBudget(std, 4000, CFG) },
      { kind: 'event', label: 'Champions League — Finale', budget: applyEventBudget(evt, 500, CFG) },
    ];
    const cart = combineCart(lines, CFG);

    expect(cart.totalTnd).toBeCloseTo(4500, 6);
    expect(cart.totalSplit.screenhostsTnd).toBeCloseTo(2250, 6); // 50% of 4500
    // per-line splits sum to the total split
    const lineShSum = cart.perLineSplit.reduce((s, l) => s + l.split.screenhostsTnd, 0);
    expect(lineShSum).toBeCloseTo(cart.totalSplit.screenhostsTnd, 6);
    // a screenhost in both lines: its total is standard + event
    const sh1 = cart.perScreenhost.find((p) => p.id === 'sh1')!;
    expect(sh1.totalTnd).toBeCloseTo(sh1.standardTnd + sh1.eventTnd, 6);
    expect(sh1.eventTnd).toBeGreaterThan(0);
    // sh3 is not event-eligible → appears with eventTnd === 0
    const sh3 = cart.perScreenhost.find((p) => p.id === 'sh3')!;
    expect(sh3.eventTnd).toBe(0);
    expect(sh3.standardTnd).toBeGreaterThan(0);
    // every screenhost's revenue together = 50% of C_total
    expect(cart.perScreenhost.reduce((s, p) => s + p.totalTnd, 0)).toBeCloseTo(2250, 6);
    // sorted by total desc
    const totals = cart.perScreenhost.map((p) => p.totalTnd);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it('an empty cart yields zeros', () => {
    const cart = combineCart([], CFG);
    expect(cart.totalTnd).toBe(0);
    expect(cart.perScreenhost).toEqual([]);
    expect(cart.totalSplit.screenhostsTnd).toBe(0);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm test src/lib/dooh/v3-model.test.ts`
Expected: FAIL — `combineCart`/`CartLine` not exported.

- [ ] **Step 3: Append to `apps/web/src/lib/dooh/v3-model.ts`** (after `applyEventBudget`):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Mixed cart — simulator `recalcPanier()`
// ─────────────────────────────────────────────────────────────────────────────

export type CartLine = {
  kind: 'standard' | 'event';
  label: string;
  budget: BudgetAllocation;
};

export type CartSummary = {
  /** C_total = Σ line target budgets. */
  totalTnd: number;
  /** Split of each line's budget, in input order. */
  perLineSplit: readonly { label: string; split: RevenueSplit }[];
  /** Split of C_total (equals the sum of the per-line splits). */
  totalSplit: RevenueSplit;
  /** Per screenhost, summed across lines, bucketed by line kind, sorted by total desc. */
  perScreenhost: readonly {
    id: string;
    name?: string;
    standardTnd: number;
    eventTnd: number;
    totalTnd: number;
  }[];
};

export function combineCart(lines: readonly CartLine[], config: DoohConfigV3): CartSummary {
  const totalTnd = lines.reduce((acc, l) => acc + l.budget.targetBudgetTnd, 0);

  const byScreenhost = new Map<string, { name?: string; standardTnd: number; eventTnd: number }>();
  for (const line of lines) {
    for (const s of line.budget.perScreenhost) {
      const cur = byScreenhost.get(s.id) ?? { name: s.name, standardTnd: 0, eventTnd: 0 };
      if (line.kind === 'event') cur.eventTnd += s.revenueTnd;
      else cur.standardTnd += s.revenueTnd;
      cur.name = cur.name ?? s.name;
      byScreenhost.set(s.id, cur);
    }
  }
  const perScreenhost = [...byScreenhost.entries()]
    .map(([id, v]) => ({
      id,
      name: v.name,
      standardTnd: v.standardTnd,
      eventTnd: v.eventTnd,
      totalTnd: v.standardTnd + v.eventTnd,
    }))
    .sort((a, b) => b.totalTnd - a.totalTnd || a.id.localeCompare(b.id));

  return {
    totalTnd,
    perLineSplit: lines.map((l) => ({
      label: l.label,
      split: splitRevenue(l.budget.targetBudgetTnd, config),
    })),
    totalSplit: splitRevenue(totalTnd, config),
    perScreenhost,
  };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm test src/lib/dooh/v3-model.test.ts` → PASS.

- [ ] **Step 5: Create `apps/web/src/lib/dooh/README.md`** with exactly:

```markdown
# `lib/dooh/` — DOOH calculation primitives

Pure, Supabase-free building blocks for the DOOH (digital out-of-home) pricing engine. Nothing
here imports `../../lib/supabase`, so these modules — and their tests — run without constructing
the Supabase client. Persistence wrappers that read/write Supabase live in `../../services/` and
call into here.

## Files

- `config.ts` — `DoohConfigNumbers` + `DEFAULT_DOOH_CONFIG_NUMBERS`: the **legacy** (pre-v3.0)
  engine's config. `services/global-configuration.service.ts` loads these from the
  `global_configuration` table.
- `dates.ts` — calendar/date helpers shared by the legacy engine (`computeCampaignDayCount`,
  `parseLocalCampaignCalendarDay`, `jsGetDayToDbDayOfWeek`, `dateToDayOfWeek`,
  `formatLocalCalendarDate`, `localSlotRange`, `MS_PER_DAY`).
- `hourly-plan.ts` — `buildHybridAdjustedHourlyPlan`: the legacy budget→repetitions allocator
  over `(locality, date, hour)` slots. Tested in `hourly-plan.test.ts`.
- `v3-model.ts` — **the v3.0 pricing model** (see below). Tested in `v3-model.test.ts`.

> `v3-model.ts` is currently **unwired** — nothing in the app imports it. Wiring it into the
> wizard/cart/screenhost flows, and the schema it needs, is Phase 1 work. See
> `docs/handoff/v3-data-requirements.md` (the per-screenhost fields it needs that the current
> schema lacks) and `docs/handoff/pricing-model-v3.md` (the parameter reference). The simulator
> `docs/handoff/Toodooh_Simulateur_Pricing_v3.html` is the authoritative behavioral reference.

## v3.0 model — vocabulary

| Symbol (simulator) | This module | Meaning |
|---|---|---|
| `S` | `spotSeconds` | spot length in seconds; clamped to [1, 30] (`clampSpotSeconds`) |
| `T(s)` | `credibilityThreshold(s, cfg)` | credibility ceiling on impressions/hour by spot length: ≤`cfg.credibilityThresholds.shortMaxSeconds` (10s) → `shortValue` (0.50), ≤`mediumMaxSeconds` (20s) → `mediumValue` (0.65), else → `longValue` (0.80) |
| `F` | `cfg.frequencyCapSecondsPerHour` (300) | min seconds between two billable repeats of the same spot |
| `R` | `repetitionRate(s, cfg).rate` | billable repeats/hour = `min((3600/s)·T(s), F/s)`; `.limitedBy` says which ceiling binds. At the default `F = 300` the frequency ceiling always binds (`R = 300/s`); a larger `F` lets the credibility ceiling bind. |
| `Ei` (`opens`) | `operatingHoursPerDay` | a screenhost's operating hours per day |
| `Ai` (`affluence`) | `affluencePerHour` | regular audience per hour |
| `A_max` (`amax`) | `historicalMaxAffluence` | historical maximum audience per hour — used **only** for event impressions |
| `Oi` (`occupied`) | `soldSlotsInPeriod` | spot slots already sold over the campaign period |
| `N` | `campaignDays` | campaign duration in days (caller supplies this; `dates.ts` `computeCampaignDayCount` can produce it from start/end) |
| `evtSlots` | `eventSlotsBlockedHours` | hours per establishment a co-selected event blocks from the standard campaign (= the event window) |
| `Hi` | `netAvailabilityHours` | `max(0, Ei·N − Oi − evtSlots)` |
| `Ii` | `impressions` | `Ai·Hi·R` (standard) / `A_max·Hi_evt·R` (event) |
| `I_max` | `maxImpressions` | `Σ Ii` over accepting (or event-eligible) screenhosts |
| `CPM` | `cfg.cpmTnd` (15) | cost per 1000 impressions, TND |
| `C_max` | `maxBudgetTnd` | `CPM·I_max/1000` |
| `C_cible` | `targetBudgetTnd` | advertiser's requested budget, clamped to ≤ `C_max` |
| `taux_fill` | `fillRate` | `C_cible / C_max` |
| `I_cible` | `purchasedImpressions` | `C_cible·1000/CPM` |
| `SPS` | `screenhostPerformanceScore(c, cfg)` | weighted sum of 6 criteria ×100 (weights `cfg.spsWeights.{txAccept,txRespectEvt,txActivite,qualiteCapteur,anciennete,txRemplissage}`); colour bands (`cfg.spsColorBands`: ≥`greenMinScore` 75 → 'green', ≥`yellowMinScore` 50 → 'yellow', else 'red') are `spsColorBand` |
| `Hi_evt` | `windowHours` | `padding + matchDuration + padding` where `padding = cfg.eventWindowPaddingHours` (default 1 each side, so `1 + d + 1`) |
| `CPM_evt` | `eventCpmTnd` | `CPM × cfg.cpmEventCoefficient` (default ×2 → 30), overridable per event via `EventInput.cpmCoefficient` |
| split 50/44/3/3 | `splitRevenue` | `cfg.revenueSplit.{screenhost,toodooh,agentSh,agentSc}` fractions of an amount (output `RevenueSplit`: `screenhostsTnd`/`toodoohTnd`/`agentShTnd`/`agentScTnd`) |
| cascade | the `refused` list + share renormalisation | refused screenhosts get 0 revenue and are excluded from `I_max`; the remaining accepting screenhosts' `impressionShare` already sum to 1, so revenue auto-redistributes in SPS-rank order |

## Function ↔ simulator mapping

The simulator's `<script>` section (`Toodooh_Simulateur_Pricing_v3.html`, roughly lines 1123–1643):

| This module | Simulator |
|---|---|
| `clampSpotSeconds` | `clampS()` (≈ line 1168) |
| `credibilityThreshold` | `getT(s)` (≈ line 1156) |
| `repetitionRate` | `getR(s)` (≈ line 1164); `updateSpotInfo()`/`updateRTable()` show the limiting ceiling |
| `screenhostPerformanceScore` | `calcSPS(sh)` (≈ line 1176) with `getWeights()` (≈ line 1181) |
| `spsColorBand` | `spsColor(sps)` (≈ line 1191) |
| `computeStandardCampaign` | `recalcNormale()` (≈ line 1348) — `Hi`/`Ii`/`I_max`/`C_max`, SPS sort, `refused` |
| `applyBudget` | the budget slider + `metrics-result-normale` + `sh-results-normale` (`rev = C_cible·(pct_sh/100)·part`) |
| `splitRevenue` | `rep-amounts-normale` / `rep-amounts-evt` / `panier-repartition` (`pct_sh`/`pct_td`/`pct_ash`/`pct_asc`) |
| `computeEventCampaign` | `recalcEvenement()` (≈ line 1439) — `Hi_evt`, `CPM_evt`, eligible filter, `Ii_evt = amax·Hi_evt·R`, `I_evt_max`/`C_evt_max` |
| `applyEventBudget` | the event budget slider + `metrics-result-evt` + `sh-results-evt` |
| `combineCart` | `recalcPanier()` (≈ line 1528) — `C_total`, per-line + total `repartition`, `panier-sh-detail` cumulative-by-screenhost |

## Documented assumptions (where the simulator is ambiguous)

1. **"Screenhost" = an opaque unit with the listed fields.** The simulator's screenhosts are
   establishments ("Café El Bey", …) with `opens` hours/day. Whether that unit maps to a
   `business_profiles` row, a `location`, or a screen in the production schema is **not decided
   here** — the math doesn't care. See `docs/handoff/v3-data-requirements.md`.
2. **Cascade is implicit, not iterative.** The simulator filters refused screenhosts out of
   `items`, so `I_max` already excludes them and the `Ii/I_max` shares over the remaining
   accepting set sum to 1 — revenue redistributes automatically. We do the same: `refused` is a
   separate list (0 revenue), `accepting` is SPS-sorted, `impressionShare` is over `accepting`
   only. "SPS-rank order" is therefore the order of the `accepting` array; we expose it as `rank`.
3. **The screenhost portion of the budget is `cfg.revenueSplit.screenhost × C_cible`**, then
   split among screenhosts by `impressionShare`. (Simulator: `C_cible·(pct_sh/100)·part`.)
4. **Negative inputs are clamped to 0** (budgets, durations, affluence) so the functions are
   total — the simulator relies on HTML number inputs with `min` attributes for the same effect.
5. **Per-event CPM coefficient override.** The simulator stores `coeff` per event in its `EVENTS`
   array; we accept `EventInput.cpmCoefficient` and fall back to `cfg.cpmEventCoefficient`.
6. **Tie-breaking.** When two screenhosts have equal SPS, we order by `id` ascending so results
   are deterministic (the simulator's `sort` is not stable across engines).
7. **`campaignDays` is supplied by the caller**, not derived inside the model — Phase-1 wiring
   computes it from the campaign's start/end (`dates.ts` `computeCampaignDayCount`).

## Test fixtures — the four demo screenhosts

`v3-model.test.ts` uses the simulator's four demo screenhosts (its `screenhosts` array, ≈ lines
1128–1137), adapted to `ScreenhostInput`. They are deliberately spread across the SPS bands:

| id | name | Ei | Ai | A_max | eventEligible | SPS (default weights) | band |
|---|---|---|---|---|---|---|---|
| `sh1` | Café El Bey | 8 | 55 | 90 | yes | 91.15 | green |
| `sh2` | Lounge Arts | 6 | 40 | 75 | yes | 79.75 | green |
| `sh3` | Salle SportPlus | 7 | 35 | 60 | **no** | 66.75 | yellow |
| `sh4` | Bar Le Zinc | 5 | 30 | 80 | yes | 53.00 | yellow |

With `S = 10` (→ `R = 30`), `N = 25`, `CPM = 15`, no co-selected event:
`Hi` = {200, 150, 175, 125}; `Ii` = {330 000, 180 000, 183 750, 112 500}; `I_max = 806 250`;
`C_max = 12 093.75 TND`. With the Champions-League-finale event (2.5 h match, ×2 coeff →
`CPM_evt = 30`, window 4.5 h): eligible = {sh1, sh2, sh4}; `Ii_evt` = {12 150, 10 125, 10 800};
`I_evt_max = 33 075`; `C_evt_max = 992.25 TND`. These are the numbers the tests assert.
```

- [ ] **Step 6: Self-review the test file.** Open `apps/web/src/lib/dooh/v3-model.test.ts` and confirm: (a) the import list at the top matches every symbol used in the file (`DEFAULT_DOOH_CONFIG_V3`, `clampSpotSeconds`, `credibilityThreshold`, `repetitionRate`, `screenhostPerformanceScore`, `spsColorBand`, `computeStandardCampaign`, `splitRevenue`, `applyBudget`, `computeEventCampaign`, `applyEventBudget`, `combineCart`, and the `ScreenhostInput` + `CartLine` types); (b) no `it.skip`/`describe.skip`; (c) `demoScreenhosts()` is defined once. Fix anything off.

- [ ] **Step 7: Full gate**

`pnpm typecheck` → 179 (unchanged). `pnpm lint` → 1618/1591/27 (unchanged — `README.md` isn't eslinted; `prettier --write` reformats it on commit). `pnpm test` → exit 0, **Test Files 5 passed (5), 0 failed**. `pnpm --filter @toodooh/web build` → exit 0 — chunk count exact (113); main-entry gzip within ±100 B of post-4a; still unwired — halt if either diverges.

- [ ] **Step 8: Commit** (no `--no-verify` — `v3-model.ts`/`.test.ts` are lint-clean; `README.md` is `.md`, formatted by `prettier --write` via lint-staged):

```bash
git add apps/web/src/lib/dooh/v3-model.ts apps/web/src/lib/dooh/v3-model.test.ts apps/web/src/lib/dooh/README.md
git commit -m "feat(dooh): v3.0 mixed cart + lib/dooh README

combineCart (recalcPanier): C_total, per-line and total revenue splits,
per-screenhost cumulative across standard + event lines. lib/dooh/README.md:
model vocabulary, function↔simulator mapping, documented assumptions, and the
four demo-screenhost test fixtures. The v3.0 IP is now complete, tested, and
documented — ready to move to apps/api/ in Phase 1. Still unwired."
```

**Why a single commit:** `combineCart` is the last piece of the v3.0 model (the simulator's `recalcPanier`), and the README documents the *whole* finished module — they belong together as "the v3.0 IP is complete". Separate from 4b.3 because the cart sits on top of both `applyBudget` and `applyEventBudget` and needs both present.

---

# POST-4 — docs

## Task post-4.1: rescope `docs/audit.md` + update issue #12

**Files:**
- Modify: `docs/audit.md`

- [ ] **Step 1: Update `docs/audit.md` §3 — the "DOOH calculation engine coupled to Supabase" subsection** (currently around line 123-136). Replace its body so it reads (keep the existing heading; this is the new body text):

```markdown
The DOOH calculation services (`services/dooh-calculation.service.ts`, `services/dooh-hourly-grid.ts`,
`services/campaign-hourly-location-plan.service.ts`, `services/dooh-location-affluence-engine.ts`,
`services/dooh-new-campaign-estimate.service.ts`) carry the engine. `lib/supabase.ts` calls
`createClient()` at module load, so any file importing it (even transitively) constructs the client at
import time — which broke `campaign-hourly-location-plan.service.test.ts`.

**Step 4 (this phase) — done in two parts.** *(4a)* The genuinely-pure pieces moved into a new
Supabase-free folder `apps/web/src/lib/dooh/`: the config type/defaults (`config.ts`), the calendar
helpers (`dates.ts`), and the budget→repetitions allocator `buildHybridAdjustedHourlyPlan`
(`hourly-plan.ts`). The service files re-export the moved symbols and keep only the thin Supabase
wrappers; the failing test now passes because the math is reachable without the client. *(4b)* The
**v3.0 pricing model** was written as a new, fully-tested, **unwired** pure module
`lib/dooh/v3-model.ts` (R with credibility/frequency ceilings, SPS, per-screenhost campaign math,
cascade, 50/44/3/3 revenue split, events, mixed cart), with `lib/dooh/README.md` documenting the
model and the function↔simulator mapping. The v3.0 spec lives in `docs/handoff/pricing-model-v3.md`
and the simulator `docs/handoff/Toodooh_Simulateur_Pricing_v3.html`.

**Step 4c — Phase 1, not this phase.** Wiring v3.0 into the wizard/cart/screenhost flows, deleting
the legacy locality engine, and the **schema changes v3.0 needs** (per-screenhost operating hours,
regular/historical affluence, sold-slot counts, event eligibility, and the six SPS criteria — none of
which exist today; see `docs/handoff/v3-data-requirements.md`) belong to the backend phase. The
current `dooh-*.ts` math implements an older model and stays live until then.

Two latent issues in the *legacy* engine, surfaced during Step 4 and left for Phase 1:
- **Two competing impression models coexist** — the "slot model" (`computeDoohSlotMetrics`:
  `reps × affluence`, capped at `max_spots_per_hour × rate`) and the "affluence-only model"
  (`computeDoohLocationAffluenceCampaign`: `affluence × max_billable_spot_rate_per_hour`).
  `dooh-new-campaign-estimate.service.ts` and `campaign.service.ts` layer one on the other, so the
  wizard's impressions ceiling and the published `campaign_hourly_location_plan` can disagree.
- **`NewCampaign.tsx` carries a parallel, fictional pricing path** (`reach × 0.7`, `engagement ×
  0.15`, `efficiency = reach/cost` — `NewCampaign.tsx:410-427`) separate from the DOOH engine.
  Phase 1 / Step 5 cleanup — it should not survive.

→ **Step 4 · #12** (4a + 4b done this phase; 4c = Phase 1)
```

- [ ] **Step 2: Update `docs/audit.md` §5 roadmap, row 4.** Change row 4's "What" / "Done-when" / "Status" cells to reflect the rescope and tick the box:

  - **What:** `Decouple DOOH engine's pure math from Supabase (4a) + write the v3.0 pricing model as a tested, unwired pure module (4b). Wiring + schema + UI = Phase 1 (4c).`
  - **Key files:** `apps/web/src/lib/dooh/{config,dates,hourly-plan,v3-model}.ts` + `README.md`; `docs/handoff/pricing-model-v3.md`, `Toodooh_Simulateur_Pricing_v3.html`, `v3-data-requirements.md`
  - **Done-when:** `pnpm test` exits 0 (previously-failing `campaign-hourly-location-plan` test passes from `lib/dooh/hourly-plan.test.ts`); `lib/dooh/v3-model.ts` implements the v3.0 model and its tests match the simulator's numeric examples; `lib/dooh/README.md` documents the model + function↔simulator mapping; v3.0 is unwired (build output unchanged); 4c (wiring/schema/UI) tracked for Phase 1.
  - **Status:** `☑`

- [ ] **Step 3: Update `docs/audit.md` §2 Snapshot, the `pnpm test` row.** It currently mentions the pre-existing failure "fixed by Step 4". Change it to reflect that it's now fixed:

```markdown
| `pnpm test`                        | 4 suites pass (`lib/dooh/hourly-plan`, `lib/dooh/v3-model`, `dooh-calculation.service`, `dooh-hourly-grid`, `global-configuration.service`); 0 failures (the import-time failure was fixed in Step 4a by moving `buildHybridAdjustedHourlyPlan` into the Supabase-free `lib/dooh/`) |
```

(Wait — that's 5 suite names; adjust the count to "5 suites pass" if `v3-model.test.ts` exists by the time this commit lands, which it does. Use "5 suites pass" and list all five.)

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm typecheck` → 179, `pnpm lint` → 1618/1591/27, `pnpm test` → exit 0 / 5 files, `pnpm --filter @toodooh/web build` → 113 chunks (all unchanged — docs-only).

- [ ] **Step 5: Commit** (no `--no-verify` — `docs/audit.md` is `.md`, `prettier --write` formats it via lint-staged):

```bash
git add docs/audit.md
git commit -m "docs(audit): rescope Step 4 — 4a/4b done this phase, 4c (wiring/schema/UI) is Phase 1

Step 4 §3 reflects the decouple-then-write-v3.0-IP factoring; adds notes on
the two competing legacy impression models and NewCampaign's parallel
fictional pricing path; cross-references the new v3 data-requirements handoff.
§5 row 4 ticked; §2 snapshot updated (pnpm test now exits 0)."
```

- [ ] **Step 6: Update issue #12 body.** Run:

```bash
gh issue edit 12 --repo Ben-aoun-1/toodooh-refactored --body "$(cat <<'EOF'
Cleanup Step 4 — DOOH engine: decouple the pure math from Supabase, and write the v3.0 pricing model as the project's portable IP.

**Done this phase (4a + 4b):**
- **4a — decouple.** Pure config + date primitives and the budget→repetitions allocator (`buildHybridAdjustedHourlyPlan`) moved into a new Supabase-free folder `apps/web/src/lib/dooh/` (`config.ts`, `dates.ts`, `hourly-plan.ts`). The service files re-export the moved symbols and keep only the thin Supabase wrappers. The previously-failing `campaign-hourly-location-plan` test passes from `lib/dooh/hourly-plan.test.ts` because the math is reachable without constructing the Supabase client. `pnpm test` exits 0.
- **4b — v3.0 IP, unwired.** `lib/dooh/v3-model.ts` implements the v3.0 model (`docs/handoff/pricing-model-v3.md` + `Toodooh_Simulateur_Pricing_v3.html`): `R = min((3600/s)·T(s), F/s)`, SPS (6-criteria weighted score), per-screenhost standard-campaign math (`Hi`, `Ii`, `I_max`, `C_max`), cascade, 50/44/3/3 revenue split, event campaigns (`A_max`-based, `CPM×2`), mixed cart. Tested against the simulator's numeric examples. `lib/dooh/README.md` documents the model + function↔simulator mapping + assumptions + fixtures. Nothing in the app imports it — the bundle is unchanged.

**Explicitly Phase 1, not this phase (4c):**
- Wiring v3.0 into the wizard / cart / screenhost flows; deleting the legacy locality engine.
- The schema changes v3.0 needs — per-screenhost operating hours, regular/historical affluence, sold-slot counts, event eligibility, and the six SPS criteria — none of which exist today. See `docs/handoff/v3-data-requirements.md`.
- Extracting the SQL of `update_expired_campaigns` (and any other `supabase.rpc(...)`) from the live DB — see `docs/handoff/supabase-rpc-inventory.md`.

Surfaced for Phase 1 / Step 5: two competing impression models coexist in the legacy engine (slot vs affluence-only — wizard ceiling and published plan can disagree); `NewCampaign.tsx` carries a parallel fictional pricing path (`reach·0.7`, `engagement·0.15` — lines 410-427).
EOF
)"
```

(Do **not** close the issue — 4c remains open against it. Confirm with `gh issue view 12 --repo Ben-aoun-1/toodooh-refactored` that the body updated and the issue is still open.)

**Why a single commit (+ the issue edit as a non-commit step):** docs-only, one logical change ("record the Step 4 rescope"). It comes after all 4a/4b commits because it describes work that must already be on `main`. The issue edit is bundled here because it carries the same content.

---

## Task post-4.2: handoff docs — v3 data requirements + Supabase RPC inventory

**Files:**
- Create: `docs/handoff/v3-data-requirements.md`
- Create: `docs/handoff/supabase-rpc-inventory.md`

- [ ] **Step 1: Create `docs/handoff/v3-data-requirements.md`** with exactly:

```markdown
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
```

- [ ] **Step 2: Create `docs/handoff/supabase-rpc-inventory.md`** with exactly:

```markdown
# Supabase RPC inventory (extract the SQL before Phase 1)

`supabase.rpc('<name>')` calls invoke a Postgres function that lives **only in the Supabase
project's database**, not in this repo. Before the Phase 1 backend migration (off Supabase onto
self-hosted Postgres), the SQL definition of each must be exported from the live DB (`pg_dump`
the function, or copy it from the Supabase dashboard's SQL editor) and committed somewhere under
`infra/` so the logic isn't lost when the project leaves Supabase.

This started as the Step-4 DOOH discovery; extend it whenever a new `supabase.rpc(...)` surfaces
(`grep -rn "\.rpc(" apps/web/src` to refresh).

## Known RPCs

| Function | Called from | What it appears to do | SQL extracted? |
|---|---|---|---|
| `update_expired_campaigns` | `apps/web/src/services/campaign.service.ts` (≈ line 1116) | bulk-transitions campaigns whose end date has passed to a terminal status (`completed`?) — server-side housekeeping, not part of the pricing path | ☐ — needs export from the live DB |

## Notes

- This is the only `supabase.rpc(...)` found during the Step-4 DOOH work. A repo-wide sweep for
  other RPCs (and for Postgres functions referenced by RLS policies / triggers, which are even
  less visible from the frontend) should be part of Phase 1's "what does the DB do that the
  frontend can't see" inventory — see also `docs/handoff/02-migration-notes.md`.
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm --filter @toodooh/web build` → all unchanged from the post-4.1 state (docs-only; both new files are under `docs/handoff/`, which is in `.prettierignore`).

- [ ] **Step 4: Commit** (no `--no-verify` — new `.md` files under `docs/handoff/`; `prettier --write` is a no-op there because the path is prettier-ignored, and eslint doesn't lint `.md`):

```bash
git add docs/handoff/v3-data-requirements.md docs/handoff/supabase-rpc-inventory.md
git commit -m "docs(handoff): v3.0 data requirements + Supabase RPC inventory

Phase-1 prep: v3-data-requirements.md lists the per-screenhost fields the v3.0
pricing model needs that the current schema lacks (operating hours, regular/
historical affluence, sold-slot counts, event eligibility, the six SPS
criteria) with current-schema analogues and what new schema would add;
supabase-rpc-inventory.md logs update_expired_campaigns (SQL to extract from
the live DB before the backend migration)."
```

**Why a single commit:** one logical change — "write down what Phase 1 needs to know about the DOOH engine's data and DB dependencies". The two docs are split *files* (different topics) but one *change*; combining them keeps the post-4 docs to two commits (the audit rescope, and the handoff prep). It comes last because it references the rescoped audit doc and the finished `lib/dooh/v3-model.ts`/`README.md`.

---

## Plan-wide verification (after the last commit)

- `node --version` → `v20.20.2`.
- `pnpm typecheck` → exit 2, **179** errors (unchanged from baseline — the engine still type-checks the same; the new code is type-clean).
- `pnpm lint` → exit 1, **1618 problems (1591 errors, 27 warnings)** (unchanged — every new file is lint-clean; the legacy files we touched still carry their pre-existing errors, none added).
- `pnpm test` → **exit 0**. **Test Files: 5 passed (5), 0 failed** (was 3 passed | 1 failed). The previously-failing `campaign-hourly-location-plan` suite runs from `apps/web/src/lib/dooh/hourly-plan.test.ts`; the new `apps/web/src/lib/dooh/v3-model.test.ts` suite passes against the simulator's numbers.
- `pnpm --filter @toodooh/web build` → exit 0, **113** chunks (exact match to baseline); main `index-*.js` ≈ **442 kB / 128.6 kB gzip** (within ±100 B of the post-4a value — `lib/dooh/v3-model.ts` is unwired and tree-shaken; if the bundle grew, an accidental import slipped in).
- `git log --oneline` shows 8 new commits: `refactor(dooh): move config + date primitives…` → `refactor(dooh): extract buildHybridAdjustedHourlyPlan…` → `feat(dooh): add v3.0 pricing model foundation…` → `feat(dooh): v3.0 standard campaign…` → `feat(dooh): v3.0 event campaign…` → `feat(dooh): v3.0 mixed cart + lib/dooh README` → `docs(audit): rescope Step 4…` → `docs(handoff): v3.0 data requirements + Supabase RPC inventory`.
- Issue #12: body updated, **still open** (4c remains).
- New files on disk: `apps/web/src/lib/dooh/{config,dates,hourly-plan,hourly-plan.test,v3-model,v3-model.test}.ts`, `apps/web/src/lib/dooh/README.md`, `docs/handoff/{v3-data-requirements,supabase-rpc-inventory}.md`. Deleted: `apps/web/src/services/campaign-hourly-location-plan.service.test.ts` (moved).

---

## Self-review notes (run by the plan author)

- **Spec coverage:** 4a + 4b ✔ (Tasks 4a.1, 4a.2, 4b.1–4b.4); v3 module documentation in `lib/dooh/README.md` ✔ (4b.4 Step 5 — vocabulary, function↔simulator mapping, documented assumptions, the four demo fixtures); audit-doc updates ✔ (post-4.1 — §3 rescope + the two flag-notes + handoff cross-ref, §5 row 4, §2 snapshot); `v3-data-requirements.md` ✔ (post-4.2 Step 1); Supabase RPC inventory ✔ (post-4.2 Step 2, standalone file with a cross-ref to `02-migration-notes.md`, not folded in); the "nice-to-have" dead `effectiveVideoDurationSeconds` param on `computeHourlyDoohGridByLocation` — **deliberately not in this plan** (the user said don't fight for it; removing it cleanly is fiddly because `dooh-hourly-grid.ts`'s callers pass it; deferred to Step 8 as the user offered). Issue #12 update ✔ (post-4.1 Step 6, no close).
- **Placeholder scan:** every code step shows the full file or the full edit; every command has an exact expected result; no "TBD"/"add error handling"/"similar to Task N".
- **Type consistency:** `DoohConfigV3`, `ScreenhostInput`, `ScreenhostCriteria`, `RepetitionRate`, `SpsColorBand`, `StandardCampaignParams`, `ScreenhostAllocation`, `StandardCampaignResult`, `RevenueSplit`, `BudgetAllocation`, `EventInput`, `EventScreenhostAllocation`, `EventCampaignResult`, `CartLine`, `CartSummary` are each defined once in `v3-model.ts` and referenced consistently in the test file and the README; `HourlyPlanSlotInput`/`HourlyPlanSlotOutput` move intact from the service file to `hourly-plan.ts`; `DoohConfigNumbers` keeps its name when it moves to `config.ts`; the legacy date helpers keep their names (`computeCampaignDayCount`, etc.) when they move to `dates.ts` so existing importers (`dooh-hourly-grid.ts`, `dooh-new-campaign-estimate.service.ts`) resolve via the re-export.
- **Numbers:** SPS fixtures (91.15 / 79.75 / 66.75 / 53.00), `R = 300/s` at default `F` (60/30/20/15/12/10), `I_max = 806 250`, `C_max = 12 093.75`, event `I_evt_max = 33 075`, `C_evt_max = 992.25` were computed by hand from the simulator's formulas; the tests use `toBeCloseTo(_, 6)` for divisions and exact `toBe`/`toEqual` for integers/ordering.
