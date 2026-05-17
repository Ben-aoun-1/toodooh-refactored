/**
 * Step 11 Commit 2 — one-shot codemod: associate `<label>` elements with their
 * form control to clear `jsx-a11y/label-has-associated-control`.
 *
 * Adopted at Commit 2 per the TBD-C precedent (a `scripts/` ts-morph codemod
 * for a large mechanical sweep, preserved as an audit record). The Step 11
 * plan §4 originally assumed hand-applied fixes; the Commit 2 inventory
 * surfaced byte-identical `<label>`+control blocks across mutually-exclusive
 * `isOwner` branches in `SignUpForm.tsx`, which a unique-match string replace
 * cannot disambiguate — a deterministic AST transform eliminates that risk.
 *
 * For each flagged `<label>` (no `htmlFor`, no nested control) the codemod
 * finds the single form control in its wrapping element, derives a stable
 * per-file id, and injects `htmlFor` + `id`. Labels that already have
 * `htmlFor` are skipped (so the 8 hand-applied `SignUpForm` fixes are left
 * byte-identical). Ambiguous cases (no control, multiple controls, no
 * id source) are REPORTED for manual handling, never auto-fixed.
 *
 * ts-morph + tsx are installed transiently and uninstalled after the run
 * (TBD-C pattern); this file's `ts-morph` import is intentionally left
 * unresolvable post-uninstall, with an `eslint-disable` annotation.
 *
 * Run (from `apps/web/`): `pnpm exec tsx scripts/codemod-label-htmlfor.ts`
 */
// eslint-disable-next-line import-x/no-unresolved
import { Project, SyntaxKind, Node, type JsxElement, type JsxSelfClosingElement } from 'ts-morph';

const CONTROL_TAGS = new Set(['input', 'select', 'textarea']);
/** Component controls that forward an `id` prop to their internal native input. */
const CONTROL_COMPONENT_TAGS = new Set(['DatePicker']);

function isControlTag(tag: string): boolean {
  return CONTROL_TAGS.has(tag) || CONTROL_COMPONENT_TAGS.has(tag);
}

function kebab(name: string): string {
  return name
    .replace(/[_\s]+/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/-+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');
}

type ControlEl = JsxElement | JsxSelfClosingElement;

function tagNameOf(node: Node): string {
  if (Node.isJsxElement(node)) return node.getOpeningElement().getTagNameNode().getText();
  if (Node.isJsxSelfClosingElement(node)) return node.getTagNameNode().getText();
  return '';
}

/** The attribute-bearing node: the element itself if self-closing, else its opening tag. */
function attrHost(el: ControlEl) {
  return Node.isJsxSelfClosingElement(el) ? el : el.getOpeningElement();
}

function stringAttr(el: ControlEl, attr: string): string | null {
  const a = attrHost(el).getAttribute(attr);
  if (!a || !Node.isJsxAttribute(a)) return null;
  const init = a.getInitializer();
  if (init && Node.isStringLiteral(init)) return init.getLiteralValue();
  return null;
}

/** Derive a field name from a control's `value` / `checked` expression. */
function exprFieldName(el: ControlEl): string | null {
  const host = attrHost(el);
  for (const attrName of ['value', 'checked', 'selected']) {
    const a = host.getAttribute(attrName);
    if (!a || !Node.isJsxAttribute(a)) continue;
    const init = a.getInitializer();
    if (!init || !Node.isJsxExpression(init)) continue;
    let expr: Node | undefined = init.getExpression();
    // unwrap parens / `X || ''` / `X ?? ''` — take the left operand
    for (let i = 0; i < 4 && expr; i += 1) {
      if (Node.isParenthesizedExpression(expr)) expr = expr.getExpression();
      else if (Node.isBinaryExpression(expr)) expr = expr.getLeft();
      else break;
    }
    if (!expr) continue;
    if (Node.isPropertyAccessExpression(expr)) return expr.getName();
    if (Node.isIdentifier(expr)) return expr.getText();
  }
  return null;
}

const project = new Project({ tsConfigFilePath: 'tsconfig.app.json' });

let fixedCount = 0;
let spanifiedCount = 0;
const reports: string[] = [];

for (const sourceFile of project.getSourceFiles()) {
  const path = sourceFile.getFilePath();
  if (!path.includes('/src/') || !path.endsWith('.tsx')) continue;

  // Per-file id namespace — seed with every id literal already in the file.
  const usedIds = new Set<string>();
  for (const attr of sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (attr.getNameNode().getText() !== 'id') continue;
    const init = attr.getInitializer();
    if (init && Node.isStringLiteral(init)) usedIds.add(init.getLiteralValue());
  }

  const labels = sourceFile
    .getDescendantsOfKind(SyntaxKind.JsxElement)
    .filter((el) => el.getOpeningElement().getTagNameNode().getText() === 'label');

  let fileChanged = false;

  for (const label of labels) {
    const opening = label.getOpeningElement();
    if (opening.getAttribute('htmlFor')) continue; // already associated (incl. the 8 manual fixes)

    // skip compliant labels that nest their control
    const nests = [
      ...label.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ...label.getDescendantsOfKind(SyntaxKind.JsxElement),
    ].some((d) => CONTROL_TAGS.has(tagNameOf(d)));
    if (nests) continue;

    const rel = path.split('/src/')[1];
    const ancestor = label.getFirstAncestorByKind(SyntaxKind.JsxElement);
    if (!ancestor) {
      reports.push(`  REPORT no-wrapper  ${rel}:${label.getStartLineNumber()}`);
      continue;
    }

    // controls after this label, before the next label in the same wrapper
    const labelEnd = label.getEnd();
    const siblingLabels = ancestor
      .getDescendantsOfKind(SyntaxKind.JsxElement)
      .filter((el) => el.getOpeningElement().getTagNameNode().getText() === 'label')
      .map((el) => el.getStart())
      .filter((s) => s > label.getStart())
      .sort((a, b) => a - b);
    const bound = siblingLabels.length ? siblingLabels[0]! : ancestor.getEnd();

    const controls: ControlEl[] = [
      ...ancestor.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ...ancestor.getDescendantsOfKind(SyntaxKind.JsxElement),
    ].filter((el) => {
      if (!isControlTag(tagNameOf(el))) return false;
      if (el.getStart() <= labelEnd || el.getStart() >= bound) return false;
      if (stringAttr(el, 'type') === 'hidden') return false;
      return true;
    });

    if (controls.length === 0) {
      // No form control — this `<label>` is a caption (a field/heading caption
      // in a read-only detail view, or a caption for a custom widget). It is
      // not a form label; demote the tag to `<span>` (the `block` utility
      // class, where present, preserves the block layout).
      label.getOpeningElement().getTagNameNode().replaceWithText('span');
      label.getClosingElement().getTagNameNode().replaceWithText('span');
      spanifiedCount += 1;
      fileChanged = true;
      continue;
    }
    if (controls.length > 1) {
      reports.push(
        `  REPORT multi-control (${controls.length})  ${rel}:${label.getStartLineNumber()}` +
          ` — controls at lines ${controls.map((c) => c.getStartLineNumber()).join(', ')}`,
      );
      continue;
    }

    const control = controls[0]!;
    const host = attrHost(control);

    // resolve the id: reuse the control's existing id, else derive one
    let id = stringAttr(control, 'id');
    if (!id) {
      const field = stringAttr(control, 'name') ?? exprFieldName(control);
      if (!field) {
        reports.push(`  REPORT no-id-source  ${rel}:${label.getStartLineNumber()}`);
        continue;
      }
      const base = kebab(field);
      let candidate = base;
      let n = 2;
      while (usedIds.has(candidate)) {
        candidate = `${base}-${n}`;
        n += 1;
      }
      id = candidate;
      host.addAttribute({ name: 'id', initializer: `"${id}"` });
    }
    usedIds.add(id);
    opening.addAttribute({ name: 'htmlFor', initializer: `"${id}"` });
    fixedCount += 1;
    fileChanged = true;
  }

  if (fileChanged) sourceFile.saveSync();
}

console.log(
  `\n[codemod-label-htmlfor] auto-fixed ${fixedCount} label/control pairs; ` +
    `demoted ${spanifiedCount} control-less caption <label>s to <span>.`,
);
if (reports.length) {
  console.log(`[codemod-label-htmlfor] ${reports.length} case(s) reported for manual handling:`);
  for (const r of reports) console.log(r);
} else {
  console.log('[codemod-label-htmlfor] no ambiguous cases reported.');
}
