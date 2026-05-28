# Landing L1 — asset copy-in

**Commit:** `feat(web)` · **Date:** 2026-05-28 · **Track A · commit L1** (the integration's first
step per scoping C1) · **Companion:** `docs/handoff/landing-track-a-scoping.md` (ratified).

**Goal.** Bring the **snapshot-only** marketing assets into `apps/web/src/assets/` so L2/L3 can
reference them. No wiring, no route, no component — pure asset addition. The bulk of the landing
imagery is **already** in `src/assets/`; this commit closes the small delta.

---

## §1 — The delta (snapshot-only assets)

Diff of `~/Desktop/code hebergement 090526/www/images/` vs `apps/web/src/assets/`:

| Asset | In src/assets? | Action |
|---|---|---|
| `banner.png` | ✗ (only `banner2.png` present) | **copy in** |
| `caroussel/` (7 × "ChatGPT Image …png") | ✗ (whole subfolder absent) | **copy in** → `src/assets/caroussel/` (renamed, ASCII-safe filenames — see §2) |
| `logocampany2.png`, `logocampagny2.png.png` | ✗ (logo variants/typo dup) | **skip** — `src/assets/` already has `logo.png`, `logo2.png`, `logocampany.png`; the typo-dup (`.png.png`) is not brought in. Reconcile the actual hero logo against the served spec at L2 |
| everything else (arrow, avantage1-4, banner2, campagnes, diffusion, ecrans, footer, howto1-4, impression, logo, logocampany, outil, professionnel, revenu1-4, smart1-2) | ✓ already present | no-op |

**Net: `banner.png` + 7 carousel images = 8 files.**

## §2 — Filename hygiene (coherent absorption, scoping C2)

The carousel files are named `ChatGPT Image Jan 25, 2026, 11_43_18 AM.png` — spaces, commas,
date-stamps. These do **not** carry into the monorepo as-is (same principle as dropping the
"code hebergement 090526" folder name). Rename to coherent, import-safe slugs:

```
src/assets/caroussel/carousel-1.png … carousel-7.png   (ordered as they appear in the snapshot)
```

(Vite imports break on spaces/commas in paths; ASCII slugs are mandatory for `import x from
'@/assets/caroussel/carousel-1.png'`.)

## §3 — Verification

- **Usage is confirmed at L2, not L1.** L1 adds the files; L2 (building Hero against the served
  snapshot) confirms which are actually used and **prunes any unused** in the same L2 commit. So
  L1 deliberately copies the *plausibly-needed* hero set (`banner.png` + carousel); if the served
  spec shows the hero uses neither, L2 removes them (no orphan assets shipped).
- Gates: typecheck/lint/test **flat** (no code imports these yet); **build** may tick up by the
  image bytes only if they're imported — at L1 they're not, so build is flat too. Confirm
  36/1/217/135.82 unchanged.

## §4 — Files touched

```
A  apps/web/src/assets/banner.png
A  apps/web/src/assets/caroussel/carousel-1.png … carousel-7.png
```

Binary-only commit. No `.ts/.tsx`, no route, no test.

## §5 — Commit

`feat(web): Landing L1 — add snapshot-only marketing assets (hero banner + carousel)`

CF-6 N/A (code commit). CF-7 gate-sweep. Node 20.20.2 PATH prefix. No `Co-Authored-By`.

## §6 — Status

Drafted. Trivial. Can execute immediately on ratification (no MABA confirm needed for L1 — the
asset copy is independent of the Q2 legal-PDF question and the served-snapshot spec). L2 is the
one gated on those.
