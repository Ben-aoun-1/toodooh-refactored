import { describe, expect, it } from 'vitest';

import { createQueryClient } from './query-client';

describe('createQueryClient', () => {
  it('applies the locked D-Q query defaults', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions().queries;

    expect(defaults?.staleTime).toBe(30_000);
    expect(defaults?.gcTime).toBe(5 * 60_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.retry).toBe(1);
  });

  it('produces an independent client on each call', () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });

  it('resolves a query through fetchQuery in a node environment (smoke test)', async () => {
    const client = createQueryClient();

    const result = await client.fetchQuery({
      queryKey: ['smoke-test'],
      queryFn: async () => 42,
    });

    expect(result).toBe(42);
    expect(client.getQueryData(['smoke-test'])).toBe(42);
  });
});
