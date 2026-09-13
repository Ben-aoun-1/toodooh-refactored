import { describe, expect, it } from 'vitest';

import {
  mainDatabaseName,
  maintenanceUrl,
  quoteIdent,
  sandboxDatabaseName,
  sandboxPrefix,
  sandboxUrl,
} from '../src/simulator/naming.js';

const MAIN = 'postgresql://toodooh:pw@db:5432/toodooh_prod';

describe('simulator naming', () => {
  it('reads the main database name from the url', () => {
    expect(mainDatabaseName(MAIN)).toBe('toodooh_prod');
  });

  it('derives a sandbox name under the main prefix with 8 hex chars', () => {
    const name = sandboxDatabaseName('toodooh_prod', () => 'abcdef01');
    expect(name).toBe('toodooh_prod_sim_abcdef01');
    expect(sandboxDatabaseName('toodooh_prod')).toMatch(/^toodooh_prod_sim_[0-9a-f]{8}$/);
    expect(sandboxPrefix('toodooh_prod')).toBe('toodooh_prod_sim_');
  });

  it('rewrites only the pathname for sandbox and maintenance urls', () => {
    expect(sandboxUrl(MAIN, 'toodooh_prod_sim_abcdef01')).toBe(
      'postgresql://toodooh:pw@db:5432/toodooh_prod_sim_abcdef01',
    );
    expect(maintenanceUrl(MAIN)).toBe('postgresql://toodooh:pw@db:5432/postgres');
  });

  it('quotes identifiers safely', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});
