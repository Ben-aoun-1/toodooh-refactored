// DEL-1 (operator 2026-10-19, rulings A A B A) — the deletion GRAPH, pure. A complete account
// deletion removes the user row and every row that cannot exist without it, following the REAL
// foreign keys (read from the Postgres catalog at run time — a table added later is covered
// without touching this file). One rule per foreign key edge, in this order:
//   1. an explicit OVERRIDE wins (a nullable column that still means ownership: screenhosts.owner_id);
//   2. ON DELETE CASCADE → the child rows go too (walked explicitly: a cascaded row can itself be
//      referenced by a RESTRICT key further down, e.g. screens ← proof_of_play);
//   3. a NULLABLE column → it is cleared (a reference, not ownership: validated_by, notifications'
//      campaign link, a reversement line's agent share);
//   4. a NOT NULL column → the child rows go too (they belong to the deleted row).
// Ruled D1 A: complete means complete — rows of OTHER users that point at the deleted user's rows
// (proofs of their campaigns on other venues, payout lines of other owners) go with them.

export interface ForeignKeyEdge {
  child: string;
  column: string;
  parent: string;
  /** The parent column the key points at (its primary key, almost always). */
  ref?: string;
  /** pg_constraint.confdeltype: a = no action, r = restrict, c = cascade, n = set null, d = default. */
  onDelete: string;
  nullable: boolean;
}

export type EdgePolicy = 'delete' | 'nullify';

/** Columns that are nullable yet mean OWNERSHIP: the rows go with their owner. */
export const OWNERSHIP_OVERRIDES: ReadonlySet<string> = new Set(['screenhosts.owner_id']);

export const edgePolicy = (edge: ForeignKeyEdge): EdgePolicy => {
  if (OWNERSHIP_OVERRIDES.has(`${edge.child}.${edge.column}`)) return 'delete';
  if (edge.onDelete === 'c') return 'delete';
  return edge.nullable ? 'nullify' : 'delete';
};

/**
 * The order to delete the target tables in: every child before its parent, over the 'delete'
 * edges between target tables. Throws on a cycle (it would need a nullable link to break it).
 */
export function deletionOrder(
  tables: readonly string[],
  edges: readonly ForeignKeyEdge[],
): string[] {
  const inSet = new Set(tables);
  const children = new Map<string, Set<string>>();
  for (const t of tables) children.set(t, new Set());
  for (const e of edges) {
    if (e.child === e.parent) continue;
    if (!inSet.has(e.child) || !inSet.has(e.parent)) continue;
    if (edgePolicy(e) !== 'delete') continue;
    children.get(e.parent)?.add(e.child);
  }
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (t: string, path: string[]) => {
    const s = state.get(t);
    if (s === 'done') return;
    if (s === 'visiting') throw new Error(`deletion cycle: ${[...path, t].join(' → ')}`);
    state.set(t, 'visiting');
    for (const c of [...(children.get(t) ?? [])].sort()) visit(c, [...path, t]);
    state.set(t, 'done');
    order.push(t);
  };
  for (const t of [...tables].sort()) visit(t, []);
  return order; // children first (post-order)
}
