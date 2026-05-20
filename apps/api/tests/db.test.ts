import { describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema.js';

describe('db schema', () => {
  it('imports without opening a connection', () => {
    expect(schema).toBeDefined();
  });
});
