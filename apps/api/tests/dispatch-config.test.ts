import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '../src/db/client.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';

// Integration — the singleton config row is seeded by migration 0026 with the V1 POC defaults.
describe('getDispatchConfig (seeded singleton, real Postgres)', () => {
  afterAll(async () => {
    await sql.end();
  });

  it('returns the seeded V1 defaults', async () => {
    const cfg = await getDispatchConfig();
    expect(cfg).toMatchObject({
      seuilDiffusable: 1000,
      gMois: 100,
      joursActifs: 30,
      rMinEfficace: 2,
      fMaxSeconds: 300,
    });
  });
});
