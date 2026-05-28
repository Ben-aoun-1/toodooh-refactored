# Landing — stage-now (preserve byte-exact + integrate) plan

**Date:** 2026-05-28 · **Supersedes:** the L2 rebuild (killed — MABA rejected the re-creation) ·
**Companion:** `docs/handoff/landing-track-a-scoping.md` (§4 REBUILD **reversed** → preserve-and-
integrate) + the re-scope ruling.

**Strategic frame.** Under preserve-and-integrate the *real* integration (routing `/`→landing,
app routes→React app at one origin) **is nginx config = the ~1h deployment work**. So this commit
**STAGES** a byte-exact, complete, in-app-linked landing in the repo; the **COMPLETION** (nginx
routing + live-button verification) folds into the 1h nginx phase. The landing is *stage-now,
wire-at-1h* — not standalone-completable before admin.

---

## §0 — Rulings consumed (R1–R5)

- **R1 Option B** (nginx co-serve), not D (Vite dev-middleware). No merged local-dev until nginx;
  preview via `npx serve`.
- **R2 source the missing assets** (exact look is blocked without them): 5× Clash Grotesk woff2
  from **Fontshare** (reachable — executor fetches), `screenhosts-hero.jpg` from the original
  (**MABA input — see §6**).
- **R3 `infra/landing/`** (not `src/`) — deployment-served static artifact, not editable app
  source; co-locates with the nginx infra.
- **R4 revert L1** (`21e1711`); keep + annotate L0.
- **R5 CTA edit** — re-point 8 href literals + strip the paired `target:"_blank"`.

---

## §1 — Byte-exact copy-set → `infra/landing/`

Copy **verbatim** from `~/Desktop/code hebergement 090526/www/`:

```
infra/landing/
  index.html              # the Vite shell (absolute /assets,/images,/fonts refs — root-served)
  assets/                 # index-DViMguIB.js (293 KB) + index-DMAahlQx.css (28 KB) — the bundle
  images/                 # all marketing PNGs + images/caroussel/ (ORIGINAL spaced filenames — the bundle references them)
  fonts/                  # README placeholder → FILLED with the 5 sourced woff2 (§2)
  robots.txt
```

**Excluded** (not the landing): `app/` (the deployed React app), `iqos/` (unrelated microsite),
`apk/`, `OLD*` backups, the 5 PDFs (the bundle references **zero** `.pdf` — the legal pages are
client-rendered routes, so the PDFs are not needed for byte-exact serving).

**Byte-exact has exactly ONE documented exception:** the CTA find-replace (§3). Everything else is
copied unmodified (no reformat, no re-minify, no path rewrite — the absolute `/assets`,`/images`,
`/fonts` paths are preserved because nginx serves the landing at the origin root).

## §2 — Source the missing assets (so the staged landing is COMPLETE / exact)

CSS `@font-face` references these **exact** filenames at `/fonts/` (all currently absent):
```
ClashGrotesk-Regular.woff2  ClashGrotesk-Medium.woff2  ClashGrotesk-SemiBold.woff2
ClashGrotesk-Bold.woff2     ClashGrotesk-ExtraBold.woff2
```
- **Fonts:** fetch Clash Grotesk (Indian Type Foundry, free) from **Fontshare** (API reachable,
  200) → place as the **exact** filenames above in `infra/landing/fonts/`. Verify each weight maps
  (Regular=400, Medium=500, SemiBold=600, Bold=700, ExtraBold=800) and the woff2 filenames match
  the CSS byte-for-byte (else the @font-face 404s and headings fall back to system-ui).
- **`screenhosts-hero.jpg`:** referenced at `/images/screenhosts-hero.jpg`, **absent from the
  snapshot** (content asset). Source from MABA / the live `too-dooh.com` (§6) → place in
  `infra/landing/images/`.

**Acceptance:** after §1+§2, serving `infra/landing/` shows the **exact** built look — Clash
Grotesk headings (not system-ui), the screen-owner hero image present.

## §3 — The CTA find-replace (the one surgical edit) — `infra/landing/assets/index-*.js`

The CTAs are static anchors as string literals: `s.jsx("a",{href:"https://app.too-dooh.com/login",target:"_blank",rel:"noopener noreferrer"…})`.

```
# re-point (2× login, 6× signup):
https://app.too-dooh.com/login   → /login
https://app.too-dooh.com/signup  → /signup
# strip the paired new-tab (same-origin in-app nav now), ONLY for the re-pointed anchors:
href:"/login",target:"_blank"    → href:"/login"
href:"/signup",target:"_blank"   → href:"/signup"
```
**Verification:** post-edit grep must show `app.too-dooh.com` count = **0**; `/login` literal
count = 2, `/signup` = 6; **other** `target:"_blank"` links (if any — e.g. social) **unchanged**
(count them before/after to prove no over-strip). `rel="noopener noreferrer"` left in place
(harmless on same-origin). No other byte of the bundle changes.

## §4 — L1 revert + L0 annotation

- **Revert L1** (`git revert 21e1711` — the 8 renamed `carousel-*.png` in `src/assets/`): orphans
  under preserve-and-integrate (the landing serves its own `www/images/caroussel/` with the
  ORIGINAL spaced filenames; the renamed copies are never referenced).
- **Annotate L0** (`docs/handoff/landing-track-a-scoping.md`): a header note that **§4 REBUILD is
  reversed → preserve-and-integrate** (this plan is the authority); the rebuild sub-factoring
  (L2/L3) is dead.

## §5 — Verification (no app-tooling impact)

`infra/landing/` is **outside** the `apps/web` tsconfig/eslint/vitest/build globs (those scope to
`apps/web/src`), so:
- typecheck **36** / lint **1** / test **217** / build **135.81 kB** — **flat** (apps/web
  untouched except the L1 revert, which only removes unused binary assets → still flat).
- **The gate is MABA's `npx serve` preview** of `infra/landing/`: the **exact** look (Clash
  Grotesk headings, hero image present) + the CTAs navigate to same-origin `/login` `/signup` in
  the **same tab**. (Full `/`→landing routing is the nginx 1h deliverable, not verifiable here.)

## §6 — NEED FROM MABA before execute

- **`screenhosts-hero.jpg`** — do you have the file, or is the landing live at `too-dooh.com` to
  pull it from? (Fonts = Fontshare, executor-handled; this hero image is yours.) Without it the
  screen-owner hero is a broken image and the staged landing isn't "complete/exact."

## §7 — Commit factoring

| # | Commit | Scope |
|---|---|---|
| A | `docs` | this plan + the L0 §4-reversed annotation |
| B | `revert` | `git revert 21e1711` (the moot L1 assets) |
| C | `chore(infra)` | `infra/landing/` byte-exact (§1) + sourced fonts + hero (§2) + CTA find-replace (§3) |

**C is binary-heavy + the built bundle.** It is NOT app source — it's the deployment artifact.
Commit subject: `chore(infra): stage byte-exact marketing landing + re-point CTAs to same-origin /login,/signup`.

## §8 — What completes at the 1h nginx phase (NOT this commit)

- nginx route map: `/` + `/mentions-legales` + `/modalites-tarifaires` + `/politique-remboursement`
  → `infra/landing/index.html`; everything else → React app `index.html`; `/assets/` merged
  (content-hashed, no collision); `/images/`,`/fonts/` → landing.
- Live-button verification at the merged origin (CTAs land on the real app `/login`,`/signup`).

## §9 — Risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Fontshare Clash Grotesk woff2 differs subtly from the original ITF cut | Med | Low | Fontshare is the legit ITF distributor; visual-QA the headings; the alternative (no font) is worse |
| CTA find-replace over-strips a non-CTA `target:"_blank"` | Low | Med | Strip only the `href:"/login\|/signup",target:"_blank"` paired pattern; before/after count of total `_blank` |
| Editing the minified JS corrupts the bundle | Low | High | Exact string replacement only (no reformat); re-serve + smoke after edit; the strings are unique literals |
| `screenhosts-hero.jpg` unavailable | Med | Med | §6 — source from live site; if truly gone, MABA supplies a replacement (the only non-exact fallback) |
| `infra/landing/` accidentally linted/built | Low | Low | Confirm infra/ is outside apps/web globs (it is — packages scope to their own dirs) |

## §10 — Execution addendum (2026-05-28)

**Premise correction — the live site is NOT a more-complete source.** `too-dooh.com` is
**byte-identical** to the snapshot (same bundle hash `index-DViMguIB.js`; css/js/images match
sizes exactly). The 6 "missing" assets (`screenhosts-hero.jpg` + 5 woff2) **404 on live too** —
they were never deployed. So the live landing itself currently renders **system-ui headings**
(Clash Grotesk 404s; body text is Inter via Google CDN, which loads) + a **broken hero image**.
"Pull the missing assets from live" is impossible. Rulings applied:

- **Fonts → Fontshare** (ratified): the `@font-face` intends Clash Grotesk; the live 404 is a
  deployment bug. Fetched the 5 woff2 from the Fontshare `clash-grotesk` download zip → named
  `ClashGrotesk-{Regular,Medium,SemiBold,Bold,ExtraBold}.woff2` to match the CSS refs. The staged
  landing thus renders the **intended** typography (an improvement over live's system-ui).
- **Hero → interim fallback** (ratified): `screenhosts-hero.jpg` is genuinely lost (404 live +
  snapshot; a content photo MABA doesn't have). The section is a full-screen backdrop **90%
  covered by a `bg-figma-blue-dark/90` overlay + `blur(2px)`** — the backdrop is almost entirely
  obscured. **Interim = `professionnel.png`** (an existing on-brand decorative graphic — green
  steps on white, wide aspect, content-neutral) copied to `images/screenhosts-hero.jpg`. Chosen
  over a generated placeholder (no image tooling available; reusing an existing landing asset
  keeps it in-family and is Option-1-preferred). Under the 90% overlay the exact backdrop is
  near-invisible, so the substitution is cosmetically negligible. **Note:** the file is PNG bytes
  with a `.jpg` name (browsers content-sniff and render it); a proper JPG/real photo lands when
  the gap is resolved.

### Content gap (carry-forward — NOT a code blocker)

**`screenhosts-hero.jpg` — original lost** (404 on live + snapshot). Interim `professionnel.png`
staged. A **proper screen-owner hero image** is needed. Resolve when: **Track B / Figma** (if the
design specifies the image), OR whenever MABA can source/create one. A **content task**, tracked
here + flagged for the 1h nginx/landing-finalization phase.

## §11 — Status

Executed (commits A/B/C). nginx routing folds into the 1h phase. Track B (Figma) parked. Hero is
the one tracked content gap (interim staged, not broken).
