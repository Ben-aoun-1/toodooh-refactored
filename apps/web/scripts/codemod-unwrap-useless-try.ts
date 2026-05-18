/**
 * One-shot codemod — Step 11 · Commit 5b.
 *
 * Unwraps `try { BODY } catch (e) { throw e; }` blocks: the exact bare-rethrow
 * shape ESLint's `no-useless-catch` fires on. The TryStatement is replaced
 * in place by the statements of its try-block.
 *
 * Targets a TryStatement when ALL hold:
 *   - the catch clause body is exactly one ThrowStatement
 *   - that throw rethrows the caught binding identifier (not `new Error(...)`,
 *     not a transformed value)
 *   - there is no `finally` block
 *
 * Skip-and-report (no auto-fix) when EITHER:
 *   (1) the try-block has 0 statements (degenerate — would leave an empty block)
 *   (2) the try-block declares a const/let AND statements follow the
 *       TryStatement in the enclosing block (scope-promotion collision risk)
 *
 * Run from `apps/web/`:  pnpm exec tsx scripts/codemod-unwrap-useless-try.ts
 * Transient: ts-morph is installed for this run and uninstalled afterwards
 * (TBD-C codemod precedent). The script is preserved as an audit record.
 */
// eslint-disable-next-line import-x/no-unresolved
import { Project, Node, SyntaxKind, type TryStatement } from 'ts-morph';

// Optional CLI arg narrows the target glob (used for the single-file self-test
// before the full sweep). Defaults to the whole source tree.
const targetGlob = process.argv[2] ?? 'src/**/*.{ts,tsx}';
const project = new Project({ skipAddingFilesFromTsConfig: true });
project.addSourceFilesAtPaths(targetGlob);

let evaluated = 0;
let unwrapped = 0;
const skipped: string[] = [];
const perFile = new Map<string, number>();

/** True when the TryStatement is a bare-rethrow with no finally. */
function isBareRethrow(tryStmt: TryStatement): boolean {
  if (tryStmt.getFinallyBlock()) return false;
  const cc = tryStmt.getCatchClause();
  if (!cc) return false;
  const stmts = cc.getBlock().getStatements();
  if (stmts.length !== 1) return false;
  const only = stmts[0];
  if (!Node.isThrowStatement(only)) return false;
  const thrown = only.getExpression();
  if (!thrown || !Node.isIdentifier(thrown)) return false;
  const decl = cc.getVariableDeclaration();
  if (!decl) return false;
  const nameNode = decl.getNameNode();
  if (!Node.isIdentifier(nameNode)) return false;
  return thrown.getText() === nameNode.getText();
}

/** Skip reason, or null when the unwrap is safe. */
function skipReason(tryStmt: TryStatement): string | null {
  const bodyStmts = tryStmt.getTryBlock().getStatements();
  if (bodyStmts.length === 0) return 'degenerate: try-block has 0 statements';

  const declaresBinding = bodyStmts.some(
    (s) =>
      Node.isVariableStatement(s) &&
      ['const', 'let'].includes(s.getDeclarationList().getDeclarationKind().toString()),
  );
  if (!declaresBinding) return null;

  const parent = tryStmt.getParent();
  if (parent && Node.isBlock(parent)) {
    const siblings = parent.getStatements();
    const idx = siblings.findIndex((s) => s === tryStmt);
    if (idx >= 0 && idx < siblings.length - 1) {
      return 'scope-promotion risk: const/let in try-block + statements follow the try';
    }
  }
  return null;
}

for (const sf of project.getSourceFiles()) {
  const rel = sf.getFilePath().replace(`${process.cwd()}/`, '');

  // Pass A — count bare-rethrow tries and record skips (no mutation).
  for (const t of sf.getDescendantsOfKind(SyntaxKind.TryStatement)) {
    if (!isBareRethrow(t)) continue;
    evaluated += 1;
    const reason = skipReason(t);
    if (reason) skipped.push(`${rel}:${t.getStartLineNumber()} — ${reason}`);
  }

  // Pass B — transform every safe bare-rethrow try. Re-query each iteration:
  // replaceWithText forgets transformed subtrees (and nested try statements).
  for (;;) {
    const next = sf
      .getDescendantsOfKind(SyntaxKind.TryStatement)
      .find((t) => isBareRethrow(t) && skipReason(t) === null);
    if (!next) break;
    // Slice the try-block's text between its outer braces — verbatim, so all
    // leading-comment trivia (e.g. `// eslint-disable-next-line` directives
    // sitting on inner statements) is preserved. AST `Statement.getText()`
    // would silently drop those comments. prettier --write re-indents after.
    const blockText = next.getTryBlock().getText();
    const inner = blockText.slice(blockText.indexOf('{') + 1, blockText.lastIndexOf('}'));
    next.replaceWithText(inner);
    unwrapped += 1;
    perFile.set(rel, (perFile.get(rel) ?? 0) + 1);
  }
}

project.saveSync();

// console is permitted under **/scripts/** per CLAUDE.md — no disable needed.
console.log(
  `[unwrap-useless-try] evaluated=${evaluated} unwrapped=${unwrapped} skipped=${skipped.length}`,
);
for (const [file, n] of [...perFile.entries()].sort()) {
  console.log(`  ${n}\t${file}`);
}
for (const s of skipped) {
  console.log(`  SKIP ${s}`);
}
