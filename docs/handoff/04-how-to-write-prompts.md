# How to write prompts for this project

This is a two-assistant project. Knowing the split is the most important thing to internalize before writing any prompt.

## The two assistants

**Claude (you, the prompt-writer)** — runs in this Claude project. Sees: the handoff folder, the user's messages, Claude Code's reports. Does NOT see the actual codebase. Cannot grep, cannot read files, cannot run commands.

**Claude Code (the executor)** — runs locally on the user's machine in `~/Desktop/toodooh-platform/`. Sees: every file in the monorepo, the full git history, the live build/test/lint output. Reads `CLAUDE.md` on every session. Executes the prompts the user pastes from you.

The user is the courier. They paste your prompts into Claude Code, they paste Claude Code's reports back to you. The whole workflow runs on this round trip.

## The implication: every prompt that depends on code shape must ask Claude Code to look first

You cannot guess what's in a file. You cannot assume what `grep` would return. You cannot pre-decide "fix all X violations" without knowing how many X exist, where they cluster, or whether they share a root cause.

Every prompt that touches code must follow this pattern:

```
1. Discovery — ask Claude Code to inventory what it finds (file count, error count, pattern breakdown, etc.)
2. Reporting — Claude Code reports back, the user pastes the report to you
3. Decision — you read the report, you decide the strategy, you write the execution prompt (or refine the original plan)
4. Execution — Claude Code executes; user reports the outcome
5. Verification — explicit definition-of-done checks
```

In practice, this means most prompts have a `## Plan (produce first, wait for approval)` section as their *first* action. The plan is Claude Code's discovery output. The user pastes it back; you respond with approval or revision; then Claude Code executes.

## What this looks like in real prompts

**Bad (assumes shape):**
```
Fix all 20 react-hooks/rules-of-hooks violations across the codebase.
For each one, replace the conditional hook with an unconditional version
that handles the condition inside the hook body.
```

This assumes 20 violations, assumes they're conditional-hook patterns, assumes they're spread across multiple files, prescribes a fix without seeing the code. When Claude Code looked, all 20 were in one file, single root cause, single fix. The "correct" prompt assumed a pattern that wasn't there.

**Good (asks first):**
```
Fix all react-hooks/rules-of-hooks violations in apps/web/.

## Plan (produce first, wait for approval)

1. Inventory. Run pnpm lint filtered to react-hooks/rules-of-hooks and
   produce a numbered table: file path + line, hook name, violation
   category (conditional, in loop, after early return, etc.), 1-line
   description of what the surrounding code is trying to do.

2. Categorize by fix difficulty: Trivial / Mechanical / Genuine.

3. Show me the inventory and categorization. Wait for my go-ahead.

4. Fix Trivial and Mechanical in one pass. For Genuine cases, stop
   and ask — show me the original code and propose two redesigns.

...
```

This prompt lets the executor see the code and tell the prompt-writer what's actually there. The strategy is decided after the discovery, not before.

## Why this matters specifically for this project

The previous developer's code is full of surprises. The audit (`01-initial-audit.md`) called many things accurately but was wrong about at least two: there is no dual auth store (only one Zustand store + a god-service), and `App.tsx` is not a god-component router (`Dashboard.tsx` is, one level deeper). Both corrections came from Claude Code actually reading the files.

If you write prompts that assume the audit is correct, the prompts will sometimes ask for the wrong thing. Always have Claude Code verify shape before prescribing structure.

## How to ask Claude Code to look

The actions Claude Code can perform during discovery:

- **List files**: `find apps/web/src -name '*.tsx' -type f | wc -l`, `ls apps/web/src/services/`, etc.
- **Count things**: `pnpm lint 2>&1 | grep -c 'error'`, `grep -rc 'console.log' apps/web/src`, etc.
- **Read specific files**: `cat apps/web/src/App.tsx`, `head -100 apps/web/src/services/auth.service.ts`
- **Run tooling**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @toodooh/web build`
- **Inspect git state**: `git log --oneline -20`, `git diff HEAD`, `git -C path/to/source status`
- **Search patterns**: `grep -rn 'useLocation' apps/web/src/`, `rg 'export (function|const)' apps/web/src/pages/`

Frame discovery requests as concrete commands or as questions Claude Code can answer with concrete commands. "Tell me what's in App.tsx" works because Claude Code knows how to read a file. "Tell me if the auth flow is OK" doesn't work — it's not a discoverable property.

## Verification gates: capture baselines live

Most plans end with a "verification gate" block — the exact tooling numbers a successful execution must hit (typecheck error count, lint problem count, test files passing, build chunk count, main-bundle gzip size). When you write that block, capture the *current* baseline numbers at plan-writing time by having Claude Code run the gate commands fresh:

```
pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @toodooh/web build
```

Do not reuse numbers from a prior plan. The baseline drifts: chunk count moves when a route is added or a dependency is swapped, lint problem count moves whenever someone touches anti-pattern code, the bundle's gzipped size shifts on any non-tree-shaken import.

Step 4's plan said the build emitted **113 chunks**; the actual baseline at execution time was **110**. Stale baselines like that create false alarms — the executor sees the verification fail, halts, asks the user, and the user has to confirm the plan was wrong rather than the work. Each false alarm erodes trust in the gate signal. A gate that the executor stops trusting stops protecting them.

The fix is small and cheap: re-run the four commands at the moment you write the verification block and paste the live numbers in. If the plan sits for a few days before execution, the executor will compare against the original commit's numbers anyway — those are what the plan recorded, and a small drift is still informative.

## When NOT to require discovery

Some prompts genuinely don't need it. Examples:

- **Documentation/docs files**: "create a README.md at the monorepo root" — no discovery needed.
- **Trivial config edits the user already specified**: "add `noUncheckedIndexedAccess: true` to tsconfig.base.json" — user told you the change.
- **Pure refactors where Claude Code has already done discovery in a prior turn**: if the user just pasted "App.tsx has 41 imports, 1 named export (RechargeManagement), here are the lines," you don't need to ask again.

The rule of thumb: if your prompt prescribes a specific code change to a specific file, either the user already gave you the shape or your prompt needs to start with a discovery step.

## The "ask Claude Code for context" pattern in practice

When the user asks a question you can't answer from the handoff alone, your job is to write a short prompt that asks Claude Code for the context, not to guess. Example:

User: "Should we use React Query or SWR for the data layer when we restructure?"

Wrong answer: long opinion piece about React Query vs SWR.

Right answer: "Before I have a real opinion, I need to know what the current frontend uses for data fetching. Paste the output of this into Claude Code:

```
List every data-fetching pattern currently used in apps/web/. For each one,
give me: the location (file or service), the pattern (raw Supabase call,
useState+useEffect, custom hook, etc.), and how many call sites use it.
```

Run that, paste me the report, and I'll give you a real answer."

This is the right discipline. You are not the source of truth about the code. Claude Code is.

## Iterate sequential pattern-match-and-delete to convergence

Sequential pattern-match-and-delete scripts must iterate to convergence — line shifts can create new adjacencies that weren't visible to the original grep. Commit 3 of Step 5 (Cat 2a + 2b purge: `console.error` followed on the next line by `throw` or `toast.*`) found 5 extras on a second pass after the first wave's deletions brought new pairings into adjacency (two consecutive `console.error+throw` blocks where the first deletion exposed the second pattern). Single-pass deletion is incomplete. The fix is small: re-run the grep on the modified tree and apply the second wave; iterate until the grep returns zero matches.

## Compact summary

- You see the handoff. Claude Code sees the code.
- Every code-touching prompt starts with discovery (the "Plan" section).
- The user is the courier between you and Claude Code.
- When in doubt about code shape, write a discovery prompt before writing a fix prompt.
- The audit document is a starting point, not ground truth — Claude Code's reads can and have overridden it.
