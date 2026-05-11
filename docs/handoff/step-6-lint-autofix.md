# Step 6 — Mechanical lint autofix pass

**Roadmap step:** 4 (Mechanical lint autofix pass) — see `03-cleanup-roadmap.md`
**Prompt order:** 6 (the 6th prompt written overall in this project)
**Status:** Ready to execute. Has not been run yet.

## How to use this prompt

Paste the block below into Claude Code (running in `~/Desktop/toodooh-platform`). Wait for the plan and pre-flight inventory before approving execution.

---

```
Apply a one-time mechanical cleanup pass to `apps/web/`: Prettier formatting across all files, then ESLint --fix for the safe auto-fixable rules. After this pass, the pre-commit hooks should pass on every subsequent commit without needing `--no-verify`.

This is the only commit in the project that will be permitted to touch every file in `apps/web/src/`. After this, surgical-commit discipline resumes.

## Plan (produce first, wait for approval)

1. **Pre-flight inventory.** Capture baseline numbers:
   - `pnpm typecheck` error count (expect 310)
   - `pnpm lint` error/warning counts (expect 2174 errors, 27 warnings)
   - `pnpm test` results
   - `pnpm --filter @toodooh/web build` main chunk size and total chunk count
   - `git rev-parse HEAD` — record the pre-pass commit for rollback reference

2. **Three sequential commits**, each verified before the next:

   **Commit A — Prettier formatting (zero semantic change).**
   - Run `pnpm exec prettier --write 'apps/web/src/**/*.{ts,tsx,css,json,md}'`
   - Do NOT touch anything outside `apps/web/src/` (no root configs, no other workspaces — there's only `apps/web` right now, but explicit scope is good practice)
   - Verify: typecheck count unchanged (310), test results unchanged, build succeeds, lint count drops by some amount (Prettier resolves many trivial errors)
   - Commit as: `style: apply Prettier formatting to apps/web`
   - Commit body should mention this is the one-time formatting pass and reference `.git-blame-ignore-revs`

   **Commit B — ESLint --fix for safe rules (import-x/order, prefer-const, and any other auto-fixable rules EXCEPT no-unused-vars).**
   - Run `pnpm exec eslint --fix 'apps/web/src/**/*.{ts,tsx}' --rule '@typescript-eslint/no-unused-vars: off'`
   - This auto-fixes import ordering, `prefer-const`, and any other safe auto-fixable rules, but leaves `no-unused-vars` for the next commit (where it gets manual review)
   - Verify: typecheck unchanged (310), test unchanged, build succeeds, lint count drops by ~486 (import-x/order=482 + prefer-const=4)
   - Commit as: `refactor: apply ESLint auto-fix for import ordering and const preference`

   **Commit C — Remove unused variables (no-unused-vars).**
   - Before running, produce an audit: a list of every unused variable that will be deleted, with file:line and category (see "Special handling" below)
   - **Show me that list.** Wait for my go-ahead before running --fix on this rule. Unused-variable removal can be aggressive — deleting a destructured field, a function parameter, or a variable reserved for future use. I want eyes on the list before it goes through.
   - If I approve: run `pnpm exec eslint --fix 'apps/web/src/**/*.{ts,tsx}' --rule '@typescript-eslint/no-unused-vars: error'`
   - Verify: typecheck count drops (some unused-var removals will also clear TS6133 errors), test unchanged, build succeeds, lint count drops by ~239
   - Commit as: `refactor: remove unused variables flagged by ESLint`

3. **After all three commits, create `.git-blame-ignore-revs`** at repo root containing the three commit hashes, one per line, each with a brief comment:
   ```
   # Mechanical Prettier formatting of imported frontend
   <hash A>
   # Mechanical ESLint --fix (import order, prefer-const)
   <hash B>
   # Mechanical ESLint --fix (no-unused-vars removal)
   <hash C>
   ```
   This file makes `git blame --ignore-revs-file .git-blame-ignore-revs` skip these commits, so blame shows the original author of each line, not the mechanical cleanup. Commit as `chore: ignore mechanical cleanup commits in git blame`.

4. **Final verification:**
   - `pnpm typecheck` — should be ≤310 (probably lower)
   - `pnpm lint` — should be ~1450 problems remaining
   - `pnpm test` — 3 suites pass, 1 pre-existing failure
   - `pnpm --filter @toodooh/web build` — passes
   - `react-hooks/rules-of-hooks: 0` — still 0
   - `pnpm exec prettier --check 'apps/web/src/**/*.{ts,tsx,css,json,md}'` — passes (zero formatting diffs remaining)

5. **Test the pre-commit hook.** Make a trivial change to a file (add and remove a blank line, or touch a comment), `git add` it, and run `git commit` *without* `--no-verify`. Confirm the hook passes. Then revert that commit. This proves the hook will pass on future surgical commits.

## Constraints

- **Only `apps/web/src/` is in scope.** No root-level files touched (except `.git-blame-ignore-revs` in its own commit). No other workspaces. The skill we're building: scoped, reversible mechanical passes.
- **No semantic changes in commits A and B.** Prettier and the safe ESLint rules produce zero behavioral diff. If something changes behavior, stop and report.
- **Commit C gets human review.** The unused-var list is presented to me before --fix runs. I'll approve or flag specific files.
- **No introducing new dependencies.** No pino, no logger, no anything. This is a fix-up pass, not a feature pass.
- **`--no-verify` not used.** All four commits go through the pre-commit hook. If the hook fails on any commit, the formatting wasn't complete — stop and report.
- **No changes to ESLint config or Prettier config.** The configs were set during bootstrap; we're applying them, not modifying them.
- **No changes to TypeScript config.** The deferred `verbatimModuleSyntax` etc. stay deferred per the in-file comment in `apps/web/tsconfig.app.json`.

## Special handling for unused-var review (commit C)

For each unused variable, classify into:

- **Trivially safe to delete**: locally-declared variable that's truly unreferenced. Auto-delete.
- **Function parameter**: prefix with `_` instead of deleting (preserves call signature for future use, satisfies linter). Show the count.
- **Destructured field**: prefix with `_` instead of deleting (preserves destructuring shape).
- **Imported symbol**: delete the import.
- **Suspicious — appears to be intentional**: a variable named with a verb (`unused_handler`, `deferredX`), or anything where deletion might change behavior unexpectedly. List these for manual review and DO NOT auto-delete.

The auto-fix with `--rule '@typescript-eslint/no-unused-vars: error'` may not have all these distinctions out of the box. If ESLint's auto-fix is too aggressive, switch to listing the violations and applying them manually in a single commit. Use your judgment.

## What to report at the end

- Three commit hashes
- Final lint count (target ~1450 problems remaining)
- Final typecheck count
- Build status, test status
- Pre-commit hook test result (a trivial commit went through without `--no-verify`)
- For commit C: the unused-var audit and how each category was handled
- `.git-blame-ignore-revs` content

## Definition of done

- Three formatting/cleanup commits + one `.git-blame-ignore-revs` commit
- Lint drops by approximately 725 errors (plus Prettier resolutions)
- Typecheck does not regress
- Build, test pass
- A subsequent trivial commit passes the pre-commit hook without `--no-verify`
- Working tree clean

Produce the pre-flight inventory (step 1) and the plan first. Wait for approval before commit A.
```

---

## Notes on the prompt design

A few specific choices in this prompt worth understanding before paraphrasing or revising it for future steps:

- **Three commits, not one.** Tempting to do "one mechanical cleanup commit" — single mega-diff, single revert if anything goes wrong. The three rules have different risk profiles: Prettier is bulletproof, import-ordering is bulletproof, but `no-unused-vars` removal can be subtly wrong. Separating means we can revert one without losing the other two, and the audit checkpoint on commit C catches real problems before they land.

- **`.git-blame-ignore-revs` is not optional.** Without it, `git blame` on any reformatted line shows "Claude Code, 5 minutes ago" instead of the original author. That makes future debugging much harder.

- **The hook test at the end is the proof of correctness.** The whole point of this pass is that future commits don't need `--no-verify`. If a trivial test commit can't pass the hook, the pass didn't work.

- **`no-unused-vars` with manual review classification.** ESLint's default `--fix` for this rule is to delete the variable. That's right ~95% of the time but catastrophic when wrong (deleting a destructured side-effect, deleting a function parameter that breaks a contract). The classification gates ensure we don't blindly delete. The `_`-prefix convention is the standard escape hatch.

- **Why not include `no-console` in this pass.** `no-console` is technically auto-fixable (ESLint can delete `console.log` lines), but deleting 917 console calls without thought is the wrong move — many are error reporters whose deletion silently loses error visibility. That's its own pass (step 5 of the roadmap) where pino is introduced and `console.error` calls become `logger.error`, not deletions.

When Claude Code produces the pre-flight inventory and the unused-var audit (commit C step), the unused-var audit is the one that needs explicit human eyes.
