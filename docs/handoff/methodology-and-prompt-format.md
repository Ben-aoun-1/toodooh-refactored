# How we work on Toodooh

This document captures the operating pattern that produced the cleanup phase (14 steps, ~50 commits, 3 halt-and-resolve cycles, 0 broken pushes). It's intended to bootstrap future chat sessions so the same pattern carries forward.

Two parts:

- **Methodology** — the disciplines that produce the work
- **Prompt format** — how the architect-side messages get structured

Both apply to any structurally similar work (cleanup, refactor, migration, infrastructure). Phase 1's feature-building work may need adjustments; surface them deliberately when they arise rather than letting the pattern drift.

---

## Part 1 — Methodology

### The two-assistant pattern

The cleanup phase ran with three roles:

- **Architect** (chat-side Claude) — strategic decisions, methodology growth, cross-step pattern recognition, prompt-writing for the executor
- **Executor** (Claude Code or equivalent) — per-commit verification, mechanical execution, halt-and-surface on findings, CF-9 pause summaries
- **Human** (the project owner) — visual QA, final approval before push, timeline ownership, scope decisions

The two-assistant separation is the load-bearing structure. Each role has its own discipline; mixing roles dilutes both. The architect doesn't execute (no direct code edits); the executor doesn't strategize (no scope expansion without architect approval); the human doesn't perform verification work the assistants can do (visual QA stays with the human because it's the gate the assistants can't simulate).

### Plan-writing first per step

Every cleanup step started with a plan document committed under `docs/superpowers/plans/`. The plan is not optional. Plan-writing is the discipline that produces good work even when the work itself looks simple.

Plan structure (refined across 14 steps):

- §0 Pre-flight verification — baseline state, gate counts, working tree clean
- §1 Locked constraints — what's already decided, what's not in scope
- §2 Inventory phase — what exists, classified by category (mechanical vs judgment, by sub-pattern, by file)
- §3 Commit factoring — how the step breaks into commits, what each contains
- §4 Per-commit verification gates — typecheck/lint/test/build expectations
- §5 Standing operating procedure — discipline references (CF-7 push flow, truncation safeguards)
- §6 Hard-halt conditions — what triggers a stop
- §7 Risk register — what could go wrong and how it surfaces
- §8 Cross-references — audit.md row, GitHub issue, related notes
- §9 Carry-forward methodology — what CFs apply, what new ones might surface

The inventory phase (§2) is where halts happen. Done well, it surfaces gaps before code edits. Done poorly, gaps surface during execution and require backtracking.

### Inventory-first, halt-on-finding

When inventory reveals something unexpected — a coupling layer the initial grep missed, an axis the classification didn't cover, a value already at the target state — the executor halts and surfaces rather than improvising scope. The architect then decides:

- Adjust the plan and proceed
- Re-scope the commit
- File a separate concern for later

This produced three halt-and-resolve cycles in Step 12 alone. Each halt caught a real issue before it shipped. The discipline is: a halt during inventory is cheap; a halt during execution is expensive; a halt after push is the worst.

### Mechanical vs judgment classification

Every commit gets classified before execution:

- **Mechanical** — deterministic transformation (regex swap, type fix, file rename). Per-commit verification is "did the transformation produce the predicted result?"
- **Judgment** — per-site decisions needed (does this site need brand-deep or brand-primary? is this dep duplicate-or-deliberate-pin?). Per-commit verification is "did each site get the right treatment?"

Mixing mechanical and judgment work in one commit is the bisect-surface anti-pattern. Split them.

### Per-commit verification gates

Standard four-gate set (verified before every commit ships):

- `pnpm typecheck` (baseline 51 at Phase-1 entry; ratchet down as Phase 1 progresses)
- `pnpm lint` (baseline 1 at Phase-1 entry; same)
- `pnpm test` (160 passing; should stay flat or grow)
- `pnpm build` (~140 kB gzip main bundle; track per-chunk too)

Plus Step-13 added **CI green** as a fifth gate — automated four-gate verification on every push to main.

Gate behavior to expect:

- Mechanical refactor commits: gates flat or improve (count drops mean ratchet-down opportunity)
- Judgment-density commits: gates flat; any movement is a finding worth surfacing
- New-feature commits (Phase 1+): gates may grow; baseline ratchets up deliberately, with reasoning in commit body

### CF-9 pause summaries

Before every code push, the executor pauses and surfaces a structured summary:

- What landed (diff scope, files touched, count)
- Verification results per gate
- Any decisions made during execution
- Any findings worth flagging (deprecations, transient faults, methodology candidates)
- Push plan with CI verification approach

The pause-before-push is the architect's review window. The architect reads the summary, confirms it matches expectations, approves push (or surfaces concerns).

The CF-9 summary is the executor's accountability surface. A glossed summary masks issues; a thorough summary catches them.

### Visual QA pauses where rendering matters

When a commit produces user-visible changes (color swap, layout shift, brand refresh), the workflow inserts a visual QA pause between gate-sweep and push:

- Executor reports gates green, commit local
- Human runs `pnpm dev`, walks the affected surfaces with project knowledge screenshots open
- Human confirms visual correctness or surfaces issues
- On approval, executor pushes

Visual QA is the gate the assistants cannot perform. Rendering correctness can't be verified by typecheck or lint; only by looking at the running app.

### The CF system (carry-forward methodology)

CFs are accumulated methodology notes that apply across steps. They're not rules invented up-front; they're patterns that emerged from worked examples and proved transferable.

CFs from cleanup phase:

- **CF-1..CF-9** — inventory/pause/halt/commit discipline foundations (Steps 4-8)
- **CF-10** — drift verification at session boundaries (counts you reported last session may have moved; re-baseline)
- **CF-11..CF-16** — per-step methodology growth (varies by step)
- **CF-17** — strategy/verification-capability coupling (Step 11: the verification approach must match the strategy's grain)
- **CF-18** — three-axis/two-phase token inventory rule (Step 12, extended at Step 14)
  - Axis 1: Neighborhood (perceptually-near or structurally-related values)
  - Axis 2: Representation (alternate encodings of the same value)
  - Axis 3: Source/Target (during migration, both from-value and to-value)
  - Phases: Inventory + Fix (both share the same axes)

CFs are referenced in plan docs (§9) and CF-9 summaries when relevant. Phase 1 will likely surface new CF candidates; promote them at audit refreshes with worked-example evidence.

### Honest reporting

Several disciplines fall under this:

- **CF-10 drift reporting** — when re-inventory finds different counts than prior, report the delta with reasoning. Don't pretend prior counts were correct.
- **Transient faults** — segfaults, spurious parse errors, network flakes get flagged in CF-9 summaries even when they don't affect outcomes. Future debugging benefits from the audit trail.
- **Predicted vs actual** — when a forecast differs from reality (token tally predicted 602, actual 633), surface the gap and the reason. Don't silently absorb.
- **Architect-side errors** — when the architect misdiagnoses (e.g., the Step-13 headSha mis-diagnosis), the executor pushes back rather than silently working around. The discipline is bidirectional.

### Deferred-corrections lists

Each step accumulates methodology notes that aren't blocking but are worth capturing. These get folded into the audit refresh commit at step close. Notes range from minor sub-rules to CF candidates worth promoting.

The list lives in CF-9 summaries during the step; the closing audit refresh either folds them into existing CFs as sub-notes/worked examples or promotes new CF numbers.

### Cleanup-phase contract

Two contracts that held across all 14 steps:

- **No UI/UX change** (held in 13 of 14 steps; Step 12's brand refresh was the documented exception, applied uniformly per locked guidelines)
- **No regression in gate counts** (held throughout; gates moved monotonically toward the floor)

For Phase 1, these may shift. Phase 1 is feature-building work; UI changes and feature additions are expected. The discipline becomes: changes are deliberate, documented in commit bodies, and verified against the change's stated goal.

---

## Part 2 — Prompt format

The architect-side prompts have a consistent structure. The format is the methodology's surface — keeping the format keeps the methodology intact.

### Standard prompt sections

```
[Opening — what's locked, what's next]

═══════════════════════════════════════════════════════════════

[Reasoning section — why the decisions were made,
 if non-obvious]

═══════════════════════════════════════════════════════════════

[Scope section — what's in/out of this commit]

═══════════════════════════════════════════════════════════════

[Verification gates — what passes mean]

═══════════════════════════════════════════════════════════════

[CF-9 expectations — what the summary must include]

═══════════════════════════════════════════════════════════════

[Push policy + sequencing]

═══════════════════════════════════════════════════════════════

[Fire instruction]
```

The ═══ separator divides logical sections. Each section has a focused purpose; mixing concerns within a section dilutes both.

### Opening

States what's being approved or locked, with reference to the decision being acted on. Example openings:

- "Confirm: fire Commit 4. The inventory is sharp."
- "Push approved. Commit 3 ships clean."
- "Confirm split. Commit 3 = Pattern A only; Commit 3b = co-occurrence contrast pass."

The opening is action-oriented. The reader should know within the first sentence what's being decided and what comes next.

### Reasoning section (when needed)

For non-mechanical decisions, the reasoning section explains the lock. Two-three short paragraphs. Each paragraph covers one consideration:

- Why the decision is right
- What alternative was considered and rejected
- Any caveats or follow-on concerns

Skip the reasoning section for mechanical decisions where the locking is obvious from context.

### Scope section

Bulleted or tabled. Concrete file:line or count references where possible. The executor should be able to begin work from the scope alone without re-deriving intent.

Example shape:

```
COMMIT 4 SCOPE — LOCKED

Edit apps/web/package.json:
  - Remove 6 HOIST duplicates from devDependencies:
    [enumerated list]
  - Remove 1 dead dep:
    eslint-plugin-react-refresh
  - Total: 7 lines removed; apps/web devDeps 18 → 11

Regenerate pnpm-lock.yaml:
  - Run pnpm install after package.json edit
  - Commit both files atomically
```

### Verification gates

Always include the four-gate set plus any step-specific gates. State expected values, not just "verify gates pass." When a count is allowed to move, state the tolerance (139.80 ± 0.5 kB).

### CF-9 expectations

What the executor's pause summary must surface. List specifically:

- Per-site enumeration if applicable
- Reconciliation math (count predictions vs actuals)
- Residue checks (grep results that should be zero)
- Build/lockfile diff shape
- Any decisions made during execution

Specificity here prevents glossed summaries. Don't say "report what happened"; say "report each of the 7 sites with file:line and before/after."

### Push policy + sequencing

State explicitly:

- Code commits push in gate-sweep flow (CF-7 amendment)
- Doc commits push immediately (CF-6)
- Visual QA pause inserted between commit and push for rendered changes
- CI verification approach (headSha verification per Step-13 methodology)

### Fire instruction

Single-line closing. "Fire Commit X." or "Push and watch." or "Send the email." The reader knows the prompt is complete.

### Watch items (after the prompt)

After the prompt itself, list 2-4 specific things to look for in the executor's next response. These are accountability hooks:

```
Three watch items when Commit 4b's pause summary lands:

1. [specific check]
2. [specific check]
3. [specific check]
```

Watch items are the architect's bridge between sending the prompt and reading the response. They focus the architect's review on the load-bearing facts rather than skimming the whole summary.

### Tone and style

- **Direct, not deferential.** "Fire Commit X" not "Could you please fire Commit X if you don't mind?"
- **Specific, not abstract.** "Grep for `text-white` adjacent to `bg-brand-primary`" not "Look for contrast issues."
- **Numbers where they exist.** Counts, line numbers, hex values, version pins.
- **Caveats where they matter.** "Lean: Option A, but B is defensible if [reason]" rather than overselling certainty.
- **Honest about uncertainty.** When the architect doesn't know, the prompt says so and asks the executor to surface during execution.
- **Treats the executor as a competent peer.** No over-explaining; assumes shared context from prior turns.

### What the prompts deliberately don't do

- Don't dictate implementation details unnecessarily. "Apply the swap" is enough; the executor picks regex vs ts-morph vs hand-edit based on context.
- Don't repeat what's already locked. Reference prior decisions ("per D-A semantic naming") rather than re-explaining them.
- Don't pad with affirmations. "Great work on the inventory!" wastes attention. The work being right speaks for itself.
- Don't bury the action. Fire instruction goes near the end, but the prompt's purpose is clear from the opening.

---

## Part 3 — Operational notes for future chats

### Starting a new chat in this project

When opening a new chat:

- Reference this document ("we work per the methodology in project knowledge")
- State the current phase and step (e.g., "We just closed cleanup phase; starting Phase 1 architecture conversation")
- Surface any open TBDs that are relevant to the new work
- Establish the new chat's specific scope before diving into work

The first few turns of a new chat establish the working pattern. If the pattern starts drifting (overlong prompts, missing watch items, mechanical/judgment work bundled), correct it early.

### When to adjust the pattern

The cleanup-phase pattern was disciplined by:

- Small, well-defined commits
- Per-commit verification
- Halt-on-finding
- Visual QA pauses for rendered changes

Phase 1's larger commits (backend stand-up, schema migration, auth replacement) may need adjustments:

- Larger commit scopes (a full backend module rather than a per-file refactor)
- Different verification (integration tests, staging environment checks, not just typecheck/lint)
- Different cadence (slower, more thinking per commit)

When the pattern needs to adjust, surface it deliberately. Discuss the adjustment with the human before silently changing how work happens.

### What to keep stable

Regardless of phase:

- Plan-first
- Inventory-first
- Honest reporting
- Halt-on-finding
- Pause-before-push for review
- CF-9-style summaries
- Architect/executor/human role separation
- The prompt-format structure above

### What evolves

- The specific CFs (new ones emerge from new work)
- The gate set (Phase 1 may add integration tests, staging checks)
- The commit shapes (larger scopes for backend work)
- The visual-QA flow (Phase 1 will need staging environment, not just local dev)

---

## Part 4 — Operational notes from P0a + P0b

The Supabase prerequisite work (P0a extraction + P0b schema inventory, 8 commits) ran on this same methodology and produced a set of operational refinements. They are grouped thematically below. The dominant rule it surfaced — CF-18, the source/target axis — earned its own document: `docs/handoff/cf-18-source-target-axis.md`. The two CF-18-specific items from this work (the Leviosa→Toodooh rebrand instance, and the enumeration-discipline refinement) live there, not here.

### Inventory discipline

- **Canonical source is not complete source.** The "official" `supabase/migrations/` folder was not the whole schema — money-adjacent tables, the admin cluster, and several core tables lived only in ~167 ad-hoc root SQL scripts. When inventorying inherited state, grep across *every* artifact set, not just the formally-organised one. (This is CF-18 instance 3; the operational takeaway is the grep-everything habit.)
- **Negative-claim verification — the two-step check.** To claim "X does not exist", verify *both* (a) references to X exist (proving the concept is real and known — e.g. the frontend uses it), and (b) no `CREATE`/DDL for X exists in any artifact set (proving it is genuinely undeclared, not just hard to find). Used to establish that `factures`, `external_api_keys`, the `notifications` table, and the `media` bucket are live-DB-only.
- **Close absent items as findings, not perpetual gaps.** When inventory proves an expected concept is genuinely absent from all artifacts, document it explicitly with reasoning ("not in legacy schema — Phase 1 greenfield, or live-DB-only") and move it *out* of the open gap list. A `[GAP]` marker should mean "unread", never "read and confirmed absent". Leaving confirmed-absent items as gaps makes the gap list lie.
- **Migrations win over assumed names.** Frontend code and handoff docs referred to `event_campaign_links`; the actual table is `event_campaigns`. The inventory documents the schema *as it exists*, not as upstream documents assumed it. When naming diverges, the migration/DDL is authoritative.

### External resources

- **Non-destructive read for external git state.** When reading a repository you are not authoring in, use `git ls-tree -r`, `git show <commit>:<path>`, `git cat-file` — never `git checkout`. A checkout moves HEAD and the working tree of a repo that may serve other purposes. The P0a source mirror at `~/Desktop/toodooh-web/` was read this way and left untouched (HEAD `1aa76cd`) across the entire P0a+P0b arc. This served the "do not touch the source repo" instruction better than the literal `git checkout` the prompt had specified — the right move was a deviation, surfaced as a finding.

### Honest reporting — bidirectional

- **Verification catches architect-side errors too.** At a P0b Session 1 CF-9 boundary, the executor's column count (41) disagreed with the architect's stated expectation (44). Surfaced as a predicted-vs-actual delta; the architect's figure was the miscount. Honest reporting runs in both directions — the executor pushing back on an architect figure is the discipline working, not insubordination. Same shape as the Step-13 `headSha` mis-diagnosis correction.
- **Estimate drift is a finding, not an embarrassment.** The root-script triage estimated 30–60 in-scope; the real count was 73. Surfaced with the reason (the previous developer's RLS-fix-script accumulation), *not* hidden by quietly tightening the triage criteria to fit the original estimate. When an estimate derived from a heuristic (filename patterns, declared counts) misses, report the gap and the cause.

### Security findings

- **Surface security-class findings explicitly — every time.** The `itstrategix.tn` domain in the Supabase `[auth]` config was already a known issue (handoff §8 predicted it). The CLAUDE.md "halt and tell" discipline still fired and surfaced it explicitly in the CF-9. Security findings get surfaced regardless of whether they are new — "already known" is not a reason to bury one.

### Process

- **Bootstrap-reads enforcement transfers to fresh sessions.** The "confirm required reads complete before starting work" instruction produced correct halt behaviour in context-free fresh sessions throughout P0a/P0b — including a halt when two required documents were missing. The discipline is a working bootstrap artifact, not aspirational text.
- **Operational environment — Node version.** This machine's default `node` is v24; the repo pins `engines.node >=20 <21`. `pnpm` and the husky/lint-staged commit hooks reject v24. Prepend `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"` before any gate command or `git commit`. (Also recorded in project memory.)
- **Split large scopes at clean break points.** P0b Session 4 was scoped as 8 areas plus a closeout — too large for one quality session. It was halted mid-session at a clean break point and split into Commit 1a / Commit 1b / Commit 2, each a coherent slice. Honest reporting of context-window pressure, acted on before quality degraded, beats pushing through.

---

## Quick reference

- **The discipline:** Plan, inventory, classify, execute, verify, pause, approve, push, watch.
- **The structure:** Architect strategizes, executor verifies, human approves.
- **The signal:** Halts during inventory are cheap. Push without review is expensive.
- **The contract:** Honest reporting always. Even when the news is unflattering. Especially when the news is unflattering.
