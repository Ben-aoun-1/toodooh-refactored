# Landing L2 — feature scaffold + `/` route + Hero / AudienceSplit (the load-bearing commit)

**Commit:** `feat(web)` · **Date:** 2026-05-28 · **Track A · commit L2** · **Companion:**
`docs/handoff/landing-track-a-scoping.md` (ratified) · **Depends on:** L1 (assets in place).

**Goal.** Stand up the `features/landing/` feature, wire the **general public landing at `/`**
via the existing `PublicRoute`, and rebuild the **above-the-fold** (Hero + AudienceSplit) from
the served snapshot spec — token-based, Poppins, Tailwind, framer-motion. This is the commit that
makes `/` a real landing for logged-out visitors and bounces logged-in users to their dashboard.
L3 fills the remaining sections.

---

## §0 — Execution prerequisites (BUILD-time gates, ratified by the architect)

L2 **planning** is done now; L2 **execution** is gated on two MABA actions:

1. **Q2 legal-PDF confirm** — are the 5 PDFs in `~/Desktop/code hebergement 090526/www/`
   (`Mentions légales`, `Modalités tarifaires`, `Politique de remboursement`, `annonceur.pdf`,
   `plateforme.pdf`) **current/acceptable** to serve as-is?
   - **Yes** → the footer's legal links point to the PDFs (copied into `apps/web/public/legal/`,
     in-app `/legal/*.pdf`); legal content is live now, the React rebuild becomes a later item.
   - **No** → the footer legal links are **hidden** (no dead links) until rebuilt.
   - This decides the **footer** in L3 (and whether L4 exists); it does **not** block Hero/
     AudienceSplit, so L2 can start before this lands as long as the footer is L3.
2. **Served snapshot** — MABA runs `npx serve "~/Desktop/code hebergement 090526/www"` (or
   equivalent) so the executor + visual-QA have the **live visual+copy spec**. The rebuild is
   fidelity-to-the-served-render; building blind from extracted strings is not the bar.

**Plus:** read `/mnt/skills/public/frontend-design/SKILL.md` before building (the frontend-design
implementation skill — §7 test bar).

---

## §1 — Locked constraints

- **Routing (scoping C3):** `App.tsx:208` `<Route path="/" element={<Navigate to="/login" />}>`
  → `<Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />`. `Landing` is a
  `React.lazy` import (CLAUDE.md code-splitting rule). PublicRoute is **reused unchanged** —
  logged-out → `<Landing/>`, logged-in → role-dashboard `Navigate` (owner→`/owner-dashboard`,
  else→`/dashboard`), pre-init → spinner. No new guard.
- **CTAs:** in-app `react-router` `<Link to="/signup">` (primary) + `<Link to="/login">`
  (secondary). **Replace** the snapshot's absolute `https://app.too-dooh.com/{login,signup}`.
  `/signup` owns role-choice (verified: `SignUpForm` ProfileType + role-dependent steps) — the
  CTA carries **no role hint** (scoping Q4).
- **Brand (Q3):** `brand.primary #76E6AB` / `brand.deep` / `brand.accent` **tokens only**. No
  hardcoded hex anywhere (CLAUDE.md styling rule). The landing ships **zero** `#76E6AB` debt.
- **Type (Q1):** Poppins (inherited from `index.html`) — no Clash Grotesk, no per-page font.
- **Styling:** Tailwind only, no inline `style={{}}`. Animations via `framer-motion` (already a
  dep).
- **File size:** one section per component file, <400 lines (CLAUDE.md rule 5).

## §2 — Feature scaffold (scoping C2)

```
apps/web/src/features/landing/
  pages/Landing.tsx            # composes the sections; lazy entry for the / route
  components/Hero.tsx          # above-the-fold — headline, sub, primary/secondary CTA, hero visual
  components/AudienceSplit.tsx # "Choisissez votre point de départ" — annonceur / propriétaire cards,
                               #   both CTAs → /signup
```

L3 adds `Avantages.tsx`, `Revenus.tsx`, `HowItWorks.tsx`, `SmartTargeting.tsx`, `Footer.tsx`
into the same `components/`, composed by `Landing.tsx`. L2 ships `Landing.tsx` rendering **Hero
+ AudienceSplit only** (the page is coherent above-the-fold; L3 extends downward).

## §3 — Build approach (REBUILD per scoping §4)

1. Observe the **served snapshot** (Hero + the audience split) — layout, copy, imagery, spacing,
   responsive behavior, any scroll/entrance animation.
2. Rebuild Hero in Tailwind + tokens + Poppins; hero visual from `src/assets` (`banner.png` /
   carousel per L1 — **prune unused L1 assets here** if the served Hero uses neither).
3. Rebuild AudienceSplit (two cards: annonceur / propriétaire d'écran, each with its value-prop
   copy + a CTA → `/signup`).
4. framer-motion for entrance/scroll animation matching the reference (kept tasteful; respect
   `prefers-reduced-motion`).
5. Extract copy **verbatim** from the served render (French marketing text).

## §4 — Verification gates

| Gate | Baseline | Expected |
|---|---|---|
| typecheck | 36 | **36 flat** (new strictly-typed components add 0 errors) |
| lint | 1 | **1 flat** |
| test | 217 | **217 flat** (presentational — no unit tests, §7) |
| build | 135.82 kB | **marginal up, lazy-isolated** — Landing is a separate lazy chunk; the main bundle should stay ~flat; watch the landing chunk size (images already in-tree) |
| apps/api | 146 | untouched |

**MABA visual QA (the gate, §7):**
1. Navigate to `/` logged-out → Landing renders (Hero + AudienceSplit), Poppins, brand tokens,
   responsive (mobile + desktop).
2. Primary CTA → `/signup` (wizard, role-choice step first); secondary → `/login`.
3. Sign in as a screenhost, hit `/` → bounces to `/owner-dashboard` (now renders — the
   dashboard-fix). Sign in as advertiser → `/dashboard`.
4. No console errors; the landing chunk loads lazily.

## §5 — Hard-halt conditions

- §4 typecheck moves up / lint off 1 / tests change count.
- The served-snapshot spec reveals Hero structure materially different from the extracted-copy
  assumptions → surface, don't guess the copy.
- `/` route change surfaces a hardcoded `/`→`/login` deep-link dependency elsewhere (grep first).

## §6 — Files touched

```
A  apps/web/src/features/landing/pages/Landing.tsx
A  apps/web/src/features/landing/components/Hero.tsx
A  apps/web/src/features/landing/components/AudienceSplit.tsx
M  apps/web/src/App.tsx                  # lazy import + the / route (PublicRoute<Landing/>)
(M apps/web/src/assets/...               # prune any L1 asset the served Hero doesn't use)
```

## §7 — Test bar + skill

- **No unit tests** — the landing is presentational; the one logic piece (the `/` bounce) is
  **existing** `PublicRoute` (already covered by its current behavior). MABA visual QA is the gate
  (scoping §7 / the phase's RTL-never-stood-up §7.6).
- **frontend-design skill** — read `/mnt/skills/public/frontend-design/SKILL.md` before building;
  it drives layout/spacing/responsive fidelity to the served reference.

## §8 — Carry-forward / cross-refs

- CF-7 gate-sweep code-push. CF-9 pause-summary. Node 20.20.2 PATH.
- [[design-source-of-truth-consultation]] — the served snapshot is the design source-of-truth
  (Figma stand-in while Track B is deferred).
- Catch-all `*` (App.tsx:581) currently → `/login`; once `/` is a landing, consider `*` → `/`
  (minor — flag at the gate-sweep, not necessarily this commit).

## §9 — Status

Drafted. **Execution gated** on the two §0 prerequisites (Q2 PDF confirm — only blocks the L3
footer, not L2 above-the-fold; and the served snapshot — blocks the L2 build itself). L1
(assets) should land first.
