# Track A — Landing-page integration · scoping read

**Type:** read-only scoping (no source edits) · **Date:** 2026-05-28 · **Phase:** the
landing/Figma phase (audit §17.2 — precedes Phase 1g admin) · **Track A** = the existing
marketing landing; **Track B** (Figma) is DEFERRED (file-access blocked, parked).

**Goal.** Bring the existing TOODOOH marketing landing into `apps/web` as the **general public
landing at `/`** for all unauthenticated visitors, adapted to apps/web's conventions (not
transplanted verbatim). This doc scopes the read of both sides and proposes the integration
shape; it ends at a ratification halt before any code lands.

---

## §0 — Headline finding (the one that shapes everything)

**The landing snapshot is BUILT OUTPUT, not source.** `~/Desktop/code hebergement 090526/www/`
is the OVH apex-domain deploy: `index.html` mounts `<div id="root">` from a **293 KB minified**
`assets/index-DViMguIB.js` + **28 KB minified** `assets/index-DMAahlQx.css`. There is **no JSX /
component source** in the snapshot — it's the compiled Vite bundle of a *separate* landing app
(distinct from `www/app/`, which is the deployed app itself with its own bundle).

**Consequence:** integration is a **REBUILD (adapt)**, not a source copy. The snapshot is the
*design + content source-of-truth* — the role Figma would have played — not integrable code. We
reconstruct the page as a React component in apps/web's stack, using the built artifact (served
locally), the 28 marketing images, and the extractable French copy as the spec. See §4.

---

## §1 — Source inventory (`~/Desktop/code hebergement 090526/www/`)

| Item | State | Integration relevance |
|---|---|---|
| `index.html` | 14-line Vite shell, `<div id="root">`, French `lang`, title "TOODOOH - Simplifiez votre quotidien" | Confirms React+Vite SPA; built |
| `assets/index-*.js` (293 KB) | **minified bundle** — no source | Text literals + links extractable; **not** transplantable |
| `assets/index-*.css` (28 KB) | minified; `@import` Inter + `@font-face` **Clash Grotesk** | Font reconciliation (see §3) |
| `images/*.png` (28) | banner, banner2, howto1-4, avantage1-4, revenu1-4, smart1-2, ecrans, campagnes, impression, diffusion, professionnel, outil, arrow, logo, logocampany(+variants/typos) | **Mostly already in apps/web** (§3) |
| `images/caroussel/` (7) | "ChatGPT Image …" hero/carousel renders | **Snapshot-only** — not yet in apps/web |
| `fonts/` | **README.md only** — the Clash Grotesk `.woff2` files are **absent** | Fonts must be re-sourced or substituted (§3) |
| 5 PDFs + 3 routes | `mentions-legales`, `modalites-tarifaires`, `politique-remboursement` (copy embedded in bundle + standalone PDFs) | The landing app is **multi-route** (home + 3 legal) — see §6 open-Q |
| CTAs / links | **`https://app.too-dooh.com/login`** + **`/signup`** (absolute, cross-subdomain) | Must become in-app router links (§2-C3) |
| `www/app/`, `www/iqos/`, `www/apk/` | the deployed app; an unrelated IQOS microsite; the TV APK | **Out of scope** — not the landing |

**Landing structure (inferred from images + extracted copy):** dual-audience marketing
(annonceurs *and* propriétaires d'écrans). Sections evidenced — hero/banner ("Avec Toodooh, la
publicité sort du virtuel pour entrer dans la vie réelle"), "Ce qui fait la différence",
"Choisissez votre point de départ" (the two-audience split), avantages (×4), revenus (×4),
how-it-works (×4), smart-targeting features, footer. Exact section order/copy is captured at
build time by serving the snapshot locally.

---

## §2 — Target inventory (`apps/web`) + the 3 clarifications addressed

**Stack:** React 18 + Vite, `react-router-dom` v6 (lazy per-route), Tailwind 3, `framer-motion`
**already a dependency**, vitest (node env). Feature-folders under `src/features/<domain>/`.
Brand tokens: `brand.primary #76E6AB` (Algae Green), `brand.deep #204B43`, `brand.accent
#9195F8`. Font: **Poppins** (Google, in `index.html`).

### C1 — Read-then-copy: the copy-in is the first integration *step* (a commit), not a blocker
Read done in place. The "copy-in" is far smaller than expected because **the marketing images
are already in `apps/web/src/assets/`** — arrow, avantage1-4, banner2, campagnes, diffusion,
ecrans, footer, howto1-4, impression, logo*, outil, professionnel, revenu1-4, smart1-2 are all
present (plus app-only assets). **Snapshot-unique deltas to bring in:** `banner.png` (src has
only `banner2.png`), the 7 `caroussel/` hero images, and a logo-variant reconciliation. So
integration-step-1 (a commit) = copy the ~8 missing assets into `src/assets/` (or
`src/features/landing/assets/`) — *not* a folder transplant.

### C2 — Coherent absorption (rename/restructure, not a verbatim folder)
"code hebergement 090526" does **not** carry over. The landing is absorbed into apps/web's
feature structure as a new feature:

```
apps/web/src/features/landing/
  pages/Landing.tsx                 # the / route page (lazy)
  components/                       # Hero, AudienceSplit, Avantages, Revenus, HowItWorks,
                                    #   SmartTargeting, Footer — one section per file (<400 ln rule)
  (assets reuse src/assets/*; caroussel/ + banner.png added there)
```
Legal pages (if rebuilt — see §6): `features/legal/pages/{MentionsLegales,Modalites,Remboursement}.tsx`.
This mirrors every existing feature folder (`auth`, `advertiser`, …) — pages + components,
Tailwind classes, brand tokens, lazy-loaded. No new root-level anything (CLAUDE.md rule 6).

### C3 — General landing at `/` (the routing mechanism)
**It's the single public entry for ALL unauthenticated visitors** (role-agnostic). Current
state: `App.tsx:208` is `<Route path="/" element={<Navigate to="/login" replace />} />` — a bare
redirect, no landing. **The mechanism already exists:** `PublicRoute` (App.tsx:135-159) *already*
does exactly the bounce C3 wants — if `user` → `Navigate` to the role dashboard (owner →
`/owner-dashboard`, else → `/dashboard`); if logged-out → render children; pre-init → spinner.

**Proposed change (minimal, one line of routing intent):**
```diff
- <Route path="/" element={<Navigate to="/login" replace />} />
+ <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
```
- Logged-out visitor (any future role) → **Landing** at `/`.
- Logged-in user hitting `/` → **role-dashboard redirect** (PublicRoute, unchanged logic).
- Landing CTAs → `<Link to="/signup">` + `<Link to="/login">` (in-app router; **replace** the
  absolute `app.too-dooh.com/...` links — single-origin now, no subdomain split).
- `/login` + `/signup` keep their own `PublicRoute` wrap (already bounce logged-in users), so
  the role-choice-on-signup flow is unchanged.

No new guard needed — PublicRoute is reused as-is. (Watch-item: the `*` catch-all at App.tsx:581
currently redirects unknown→`/login`; consider unknown→`/` once a landing exists — minor, flag
only.)

---

## §3 — Reconciliation table (what must be adapted, not copied)

| Axis | Snapshot landing | apps/web | Reconciliation |
|---|---|---|---|
| **Routing** | absolute cross-subdomain `app.too-dooh.com/login` | single-origin router | Rewrite CTAs as `<Link>`; `/` via PublicRoute (C3) |
| **Brand color** | (in minified CSS — unknown hex, likely old teal/green) | `brand.primary #76E6AB` token | Rebuild with the **token**, never hardcode (CLAUDE.md styling rule + the inline-#76E6AB pass) |
| **Fonts** | Inter + **Clash Grotesk** (woff2 **missing** from snapshot) | **Poppins** | **Decision needed** (§6 open-Q1): adopt Poppins for the landing (coherence) vs re-source Clash Grotesk (brand-faithful). Lean: Poppins for coherence unless brand guidelines mandate Clash. |
| **Assets** | 28 images + 7 caroussel | ~24 already in `src/assets/` | Copy the ~8 missing (`banner.png`, `caroussel/*`) — integration step 1 |
| **Animation** | (bundle likely uses an anim lib) | `framer-motion` present | Rebuild animations with framer-motion (already available) |
| **Styling** | minified utility/custom CSS | Tailwind only, no inline `style` | Rebuild in Tailwind (CLAUDE.md) |
| **Legal copy** | embedded in bundle + 5 PDFs | none | §6 open-Q2 |

---

## §4 — Adapt-vs-rebuild ruling

> **⚠️ REVERSED (2026-05-28).** This §4 REBUILD ruling is **dead**. The React rebuild was
> executed (Hero/AudienceSplit, tokens, Poppins) and **rejected by MABA** — it didn't preserve
> the built UI/UX. The directive changed to **PRESERVE-AND-INTEGRATE**: keep the built output
> EXACTLY (byte-exact static files in `infra/landing/`), only re-point the CTAs + co-serve at one
> origin (nginx, 1h). The authority is
> `docs/superpowers/plans/2026-05-28-landing-stage-now-preserve-integrate.md`. The rebuild
> sub-factoring (L2/L3 below) and the §7 `frontend-design` build path are superseded. The text
> below is retained for history only.

**REBUILD.** Forced by §0 (no source). The build path:
1. **Serve the snapshot locally** (`npx serve ~/Desktop/code\ hebergement\ 090526/www` or
   similar) → render the real landing in a browser = the visual + copy spec (the Figma stand-in).
2. **Rebuild section-by-section** as React components in `features/landing/`, Tailwind +
   brand tokens + framer-motion + the existing `src/assets` images, using the
   **`frontend-design` skill** (§7) for fidelity.
3. **Extract copy** verbatim from the rendered page (French marketing text already partially
   pulled from the bundle in this read — full copy captured at build time).

This is **adaptation, not transplant** — exactly the directive. The snapshot anchors *what it
looks like and says*; apps/web's stack dictates *how it's built*.

---

## §5 — Proposed sub-factoring (commits)

| # | Commit | Scope |
|---|---|---|
| L0 | `docs` | this scoping read (CF-6) |
| L1 | `feat(web)` | **copy-in**: add the ~8 missing assets to `src/assets/` (+ `caroussel/`); no wiring yet (C1 — the integration's first step) |
| L2 | `feat(web)` | `features/landing/` scaffold + the `/` route via `PublicRoute` + CTAs to `/login`,`/signup`; Hero + AudienceSplit sections (above-the-fold first, renders + bounces correctly) |
| L3 | `feat(web)` | remaining sections (Avantages, Revenus, HowItWorks, SmartTargeting, Footer) |
| L4 | (optional) | legal pages — only if §6 open-Q2 says rebuild |

Each commit ends green (typecheck/lint/test/build) + MABA visual QA. L2 is the load-bearing one
(route + bounce); L3 is pure presentational fill.

---

## §6 — Open questions for the architect (halt watch-items)

1. **Fonts** — landing was Inter + Clash Grotesk (woff2 missing); apps/web is Poppins. Adopt
   **Poppins** (coherence, my lean) or re-source **Clash Grotesk** (brand-faithful)? If the
   latter, the `.woff2` files must come from outside this snapshot.
2. **Legal pages** — the landing app had `/mentions-legales`, `/modalites-tarifaires`,
   `/politique-remboursement` (copy in-bundle + as PDFs). For this integration: (a) rebuild as
   React routes, (b) link the existing PDFs, or (c) defer entirely (footer links dead/hidden
   until a later commit)? They're secondary to the landing itself.
3. **Brand-color fidelity** — confirm the landing rebuilds on `brand.primary #76E6AB` (the
   current rebrand token), i.e. the landing adopts the *new* brand, not whatever hex the old
   bundle shipped.
4. **Scope of "general landing"** — confirm the dual-audience split ("Choisissez votre point de
   départ" → annonceur / propriétaire) stays as marketing content on one page (both CTAs land on
   the same `/signup` where role-choice happens), vs. routing each audience somewhere distinct.

---

## §7 — Test bar + frontend-design skill

- **Test bar:** the landing is **presentational** — consistent with the phase's node-only test
  bar + RTL-never-stood-up (§7.6), **no unit tests**; the gate is **MABA visual QA** (renders at
  `/`, logged-in bounce works, CTAs navigate, responsive). Typecheck/lint/build stay green +
  flat against the post-1f baseline (36/1/217/135.82).
- **`frontend-design` skill:** invoked at **build time** (L2/L3) — it's the implementation skill
  for fidelity-driven UI rebuild. Not invoked for this read (read-only). The rebuild leans on it
  for layout/spacing/responsive fidelity to the served reference.

---

## §8 — Risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Copy/section drift from the original (rebuild, not transplant) | Med | Low | Serve the snapshot as the live spec; extract copy verbatim; MABA visual diff |
| Clash Grotesk unobtainable | Med | Low | Fall back to Poppins (open-Q1) — coherent anyway |
| `<div id="root">`-only build hides JS behaviors (carousels, scroll anims) not visible statically | Med | Low | Run the served build in a browser to observe interactions before rebuilding |
| Landing bundle size regresses apps/web build | Low | Low | Lazy-route (per CLAUDE.md); images already in-tree; framer-motion already bundled |
| `/` route change breaks an assumed `/`→`/login` deep link somewhere | Low | Low | grep for hardcoded `/` redirects; PublicRoute preserves logged-in behavior |

---

## Document status

**Drafted — read-only, no code touched.** Awaiting architect ratification of: the REBUILD ruling
(§4), the `features/landing/` absorption (§2-C2), the `/`-via-PublicRoute mechanism (§2-C3), the
sub-factoring (§5), and the four open questions (§6). Held uncommitted (offer: commit as L0 on
ratification, CF-6). Track B (Figma) remains deferred.
