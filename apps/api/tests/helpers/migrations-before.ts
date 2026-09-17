import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CPM-1 — a copy of the migrations folder whose journal stops just BEFORE `idx`, so a scratch
// database can be migrated to the schema a deploy starts from (the backfill proof, the simulator
// sandbox upgrade). The caller removes the returned directory.

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

const isJournal = (value: unknown): value is { entries: { idx: number }[] } =>
  typeof value === 'object' &&
  value !== null &&
  'entries' in value &&
  Array.isArray(value.entries) &&
  value.entries.every(
    (e: unknown) => typeof e === 'object' && e !== null && 'idx' in e && typeof e.idx === 'number',
  );

export const migrationsFolderBefore = (idx: number): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), `migrations-before-${idx}-`));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal: unknown = JSON.parse(readFileSync(journalPath, 'utf8'));
  if (!isJournal(journal)) throw new Error('unexpected journal shape');
  const entries = journal.entries.filter((e) => e.idx < idx);
  // Journal indices are contiguous from 0: anything else means the folder is not what we think.
  if (entries.length !== idx) {
    throw new Error(`expected ${idx} migrations before idx ${idx}, found ${entries.length}`);
  }
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries }));
  return dir;
};
