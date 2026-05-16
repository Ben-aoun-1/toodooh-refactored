/**
 * codemod-add-path-aliases.ts — TBD-C (issue #24)
 *
 * One-time codemod: rewrites cross-directory relative imports to the `@/*` alias.
 *
 * Rule (refined during TBD-C discovery):
 *   - ALIAS   — import whose resolved target is in a DIFFERENT directory from the
 *               importing file. Written form (`./` vs `../`) is irrelevant; what
 *               matters is the resolved target directory.
 *   - RELATIVE — import whose resolved target is in the SAME directory (true
 *               intra-directory sibling). Left untouched.
 *   - SKIP    — external package imports (do not start with `.`).
 *
 * Covers static `import`/`export … from`, and dynamic `import('…')` including the
 * `React.lazy(() => import('…'))` nesting (a descendant CallExpression walk catches
 * the inner import call regardless of wrapper).
 *
 * Usage (run from apps/web/):
 *   tsx scripts/codemod-add-path-aliases.ts [glob]
 *   default glob: src/<asterisks>/*.{ts,tsx}
 *
 * Committed as the audit record of the TBD-C import sweep. ts-morph is a temporary
 * devDependency installed only for the sweep and removed afterward.
 */
import * as path from 'node:path';

import { Project, QuoteKind, SyntaxKind } from 'ts-morph';

const SRC_ROOT = path.resolve('src');
const targetGlob = process.argv[2] ?? 'src/**/*.{ts,tsx}';

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  manipulationSettings: { quoteKind: QuoteKind.Single },
});
project.addSourceFilesAtPaths(targetGlob);

/** Returns the `@/…` alias form, or null when the spec should stay relative. */
function toAlias(spec: string, fileDir: string): string | null {
  if (!spec.startsWith('.')) return null; // external package
  const resolved = path.resolve(fileDir, spec); // absolute, no extension
  if (resolved !== SRC_ROOT && !resolved.startsWith(SRC_ROOT + path.sep)) return null;
  if (path.dirname(resolved) === fileDir) return null; // same directory → keep relative
  const rel = path.relative(SRC_ROOT, resolved).split(path.sep).join('/');
  return `@/${rel}`;
}

let staticCount = 0;
let exportCount = 0;
let dynamicCount = 0;
const touched = new Set<string>();

for (const sf of project.getSourceFiles()) {
  const fileDir = path.dirname(sf.getFilePath());
  let changed = false;

  for (const imp of sf.getImportDeclarations()) {
    const next = toAlias(imp.getModuleSpecifierValue(), fileDir);
    if (next && next !== imp.getModuleSpecifierValue()) {
      imp.setModuleSpecifier(next);
      staticCount++;
      changed = true;
    }
  }

  for (const exp of sf.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue();
    if (!spec) continue;
    const next = toAlias(spec, fileDir);
    if (next && next !== spec) {
      exp.setModuleSpecifier(next);
      exportCount++;
      changed = true;
    }
  }

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const arg = call.getArguments()[0];
    if (!arg || arg.getKind() !== SyntaxKind.StringLiteral) continue;
    const lit = arg.asKindOrThrow(SyntaxKind.StringLiteral);
    const next = toAlias(lit.getLiteralValue(), fileDir);
    if (next && next !== lit.getLiteralValue()) {
      lit.setLiteralValue(next);
      dynamicCount++;
      changed = true;
    }
  }

  if (changed) touched.add(path.relative(SRC_ROOT, sf.getFilePath()));
}

project.saveSync();

console.log(`glob:                      ${targetGlob}`);
console.log(`static imports rewritten:  ${staticCount}`);
console.log(`export-from rewritten:     ${exportCount}`);
console.log(`dynamic imports rewritten: ${dynamicCount}`);
console.log(`files touched:             ${touched.size}`);
