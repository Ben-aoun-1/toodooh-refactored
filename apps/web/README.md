# apps/web

The TOODOOH platform frontend — a Tunisian DOOH advertising marketplace.

## Stack

React 18 · Vite 7 · TypeScript (strict) · Tailwind CSS 3 · Zustand (client state)
· TanStack Query v5 (server state) · React Router v6 · Supabase JS client ·
Vitest. Components are hand-built on Tailwind — there is no component-library
dependency.

## Folder structure

Source is feature-organised under `src/features/<feature>/` (Step 8 restructure):
six domain features (`auth`, `campaigns`, `events`, `performances`, `screens`,
`wallet`) and three role features (`advertiser`, `screenhost`, `admin`). Each
feature owns its pages, components, services, hooks, and stores. Truly shared
code lives in `src/components/`, `src/hooks/`, `src/lib/`, `src/services/`,
`src/contexts/`.

## Commands

Run from the repo root (they fan out across the workspace) or here:

```bash
pnpm dev          # Vite dev server
pnpm build        # production build
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest run
```

## Local dev — environment

The dev server needs Supabase credentials in `apps/web/.env.local`:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Both are `VITE_`-prefixed → inlined into the client bundle → **public** by
design (the anon key is RLS-gated). `VITE_PUBLIC_APP_URL` is optional (falls
back to `window.location.origin`). See `.env.example`.

## Brand tokens

Brand colours are Tailwind theme tokens with **semantic** names (Step 12,
Decision A) — never hardcoded hex:

| Token           | Colour      | Hex       |
| --------------- | ----------- | --------- |
| `brand-primary` | Algae Green | `#76E6AB` |
| `brand-deep`    | Plantation  | `#204B43` |
| `brand-accent`  | Portage     | `#9195F8` |

## CI

The root `.github/workflows/ci.yml` runs four gates (typecheck, lint, test,
build) on every push and PR; typecheck/lint are baseline-gated. `main` is green.

## History

The current structure is the result of a 14-step disciplined cleanup phase —
see `docs/audit.md` §10 for the closing summary and §4 for the per-step record.
The methodology is documented in `docs/superpowers/plans/`.
