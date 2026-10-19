import { type SQL, sql } from 'drizzle-orm';

import type { db } from '../../db/client.js';

import { type ForeignKeyEdge, edgePolicy } from './graph.js';

// DEL-1 — reads the catalog and walks the graph (graph.ts) from one user: which rows of which
// tables go, which references are cleared. Runs inside the deletion's transaction, so what it
// finds is exactly what is deleted.

type Executor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/** [child table, child column, parent table, parent column]. */
export type EdgeRef = [string, string, string, string];

export interface DeletionTargets {
  /** table → the primary-key values of its rows that go. */
  rows: Map<string, Set<string>>;
  /** table → its single-column primary key. */
  pk: Map<string, string>;
  /** Children without a single-column primary key, deleted through their foreign key. */
  leafDeletes: EdgeRef[];
  /** References cleared before the deletes. */
  nullifies: EdgeRef[];
  edges: ForeignKeyEdge[];
}

/**
 * A Postgres text[] literal as ONE bound parameter (drizzle would expand a JS array into a list).
 * The values are keys read from the database, quoted and escaped all the same.
 */
export const pgTextArray = (values: readonly string[]): string =>
  `{${values.map((v) => `"${v.replace(/["\\]/g, '\\$&')}"`).join(',')}}`;

const rowsOf = async <T>(executor: Executor, query: SQL): Promise<T[]> =>
  (await executor.execute(query)) as unknown as T[];

/** Every single-column foreign key of the public schema. */
export const loadForeignKeys = async (executor: Executor): Promise<ForeignKeyEdge[]> =>
  rowsOf<ForeignKeyEdge>(
    executor,
    sql`SELECT c.conrelid::regclass::text AS child, a.attname AS column,
          c.confrelid::regclass::text AS parent, r.attname AS ref,
          c.confdeltype AS "onDelete", NOT a.attnotnull AS nullable
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute r ON r.attrelid = c.confrelid AND r.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
          AND array_length(c.conkey, 1) = 1`,
  );

/** table → its primary-key column, for tables with a single-column primary key. */
const primaryKeys = async (executor: Executor): Promise<Map<string, string>> => {
  const rows = await rowsOf<{ t: string; c: string }>(
    executor,
    sql`SELECT c.conrelid::regclass::text AS t, a.attname AS c
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'p' AND c.connamespace = 'public'::regnamespace
          AND array_length(c.conkey, 1) = 1`,
  );
  return new Map(rows.map((r) => [r.t, r.c]));
};

/** The values of `column` on the target rows of `table` (the parent side of an edge). */
export const refValues = async (
  executor: Executor,
  targets: Pick<DeletionTargets, 'rows' | 'pk'>,
  table: string,
  column: string,
): Promise<string[]> => {
  const ids = [...(targets.rows.get(table) ?? [])];
  if (ids.length === 0) return [];
  const pk = targets.pk.get(table) ?? 'id';
  if (column === pk) return ids;
  const rows = await rowsOf<{ v: string | null }>(
    executor,
    sql`SELECT ${sql.identifier(column)}::text AS v FROM ${sql.identifier(table)}
        WHERE ${sql.identifier(pk)}::text = ANY(${pgTextArray(ids)}::text[])`,
  );
  return rows.flatMap((r) => (r.v ? [r.v] : []));
};

export const collectTargets = async (
  executor: Executor,
  userId: string,
): Promise<DeletionTargets> => {
  const edges = await loadForeignKeys(executor);
  const pk = await primaryKeys(executor);
  const byParent = new Map<string, ForeignKeyEdge[]>();
  for (const e of edges) byParent.set(e.parent, [...(byParent.get(e.parent) ?? []), e]);

  const rows = new Map<string, Set<string>>([['users', new Set([userId])]]);
  const leafDeletes: EdgeRef[] = [];
  const nullifies: EdgeRef[] = [];
  const seenLeaf = new Set<string>();
  const seenNull = new Set<string>();
  const queue: string[] = ['users'];
  const targets = { rows, pk };

  while (queue.length > 0) {
    const table = queue.shift() as string;
    for (const edge of byParent.get(table) ?? []) {
      const ref = edge.ref ?? pk.get(table) ?? 'id';
      const key = `${edge.child}.${edge.column}`;
      const edgeRef: EdgeRef = [edge.child, edge.column, edge.parent, ref];
      if (edgePolicy(edge) === 'nullify') {
        if (!seenNull.has(key)) {
          seenNull.add(key);
          nullifies.push(edgeRef);
        }
        continue;
      }
      const childPk = pk.get(edge.child);
      if (!childPk) {
        if ((byParent.get(edge.child) ?? []).length > 0) {
          throw new Error(`table ${edge.child} has children but no single-column primary key`);
        }
        if (!seenLeaf.has(key)) {
          seenLeaf.add(key);
          leafDeletes.push(edgeRef);
        }
        continue;
      }
      const parentValues = await refValues(executor, targets, table, ref);
      if (parentValues.length === 0) continue;
      const found = await rowsOf<{ id: string }>(
        executor,
        sql`SELECT ${sql.identifier(childPk)}::text AS id FROM ${sql.identifier(edge.child)}
            WHERE ${sql.identifier(edge.column)}::text = ANY(${pgTextArray(parentValues)}::text[])`,
      );
      const set = rows.get(edge.child) ?? new Set<string>();
      const before = set.size;
      for (const r of found) set.add(r.id);
      rows.set(edge.child, set);
      // Re-walk a table whenever it gained rows (its own children must follow them).
      if (set.size > before) queue.push(edge.child);
    }
  }
  return { rows, pk, leafDeletes, nullifies, edges };
};

/** Column values of the target rows of one table (e.g. the storage keys to delete). */
export const valuesOf = async (
  executor: Executor,
  targets: DeletionTargets,
  table: string,
  column: string,
): Promise<string[]> => {
  const ids = [...(targets.rows.get(table) ?? [])];
  if (ids.length === 0) return [];
  const rows = await rowsOf<{ v: string | null }>(
    executor,
    sql`SELECT ${sql.identifier(column)}::text AS v FROM ${sql.identifier(table)}
        WHERE ${sql.identifier(targets.pk.get(table) ?? 'id')}::text = ANY(${pgTextArray(ids)}::text[])`,
  );
  return rows.flatMap((r) => (r.v ? [r.v] : []));
};

/** Whole target rows of one table, as JSON (the financial archive). */
export const rowsAsJson = async (
  executor: Executor,
  targets: DeletionTargets,
  table: string,
): Promise<unknown[]> => {
  const ids = [...(targets.rows.get(table) ?? [])];
  if (ids.length === 0) return [];
  const rows = await rowsOf<{ j: unknown }>(
    executor,
    sql`SELECT to_jsonb(t) AS j FROM ${sql.identifier(table)} t
        WHERE ${sql.identifier(targets.pk.get(table) ?? 'id')}::text = ANY(${pgTextArray(ids)}::text[])`,
  );
  return rows.map((r) => r.j);
};
