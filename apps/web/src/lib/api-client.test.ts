import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiClient } from './api-client';

/** Minimal Response stand-in covering exactly what the client reads (ok/status/headers.get/text). */
function makeRes(
  status: number,
  body?: string | Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  apiClient.onUnauthorized(() => undefined); // reset the handler between tests
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiClient', () => {
  it('sends credentials:include against the /api base and parses JSON on 2xx', async () => {
    fetchMock.mockResolvedValue(makeRes(200, { user: { id: 'u1' } }));
    const out = await apiClient.get<{ user: { id: string } }>('/me');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(out).toEqual({ user: { id: 'u1' } });
  });

  it('POST sets the JSON content-type + body and includes credentials', async () => {
    fetchMock.mockResolvedValue(makeRes(200, { ok: true }));
    await apiClient.post('/signin', { email: 'a@b.c', password: 'x' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.c', password: 'x' }));
  });

  it('returns undefined on a 204 (empty) response', async () => {
    fetchMock.mockResolvedValue(makeRes(204));
    await expect(apiClient.post('/signout')).resolves.toBeUndefined();
  });

  it('normalizes the route error shape { error, message, fields }', async () => {
    fetchMock.mockResolvedValue(
      makeRes(400, {
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'email', reason: 'bad' }],
      }),
    );
    const err = await apiClient.post('/signin', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.code).toBe('INVALID_INPUT');
    expect(apiErr.message).toBe('Validation failed');
    expect(apiErr.fields).toEqual([{ field: 'email', reason: 'bad' }]);
  });

  it('normalizes the generic/guard shape and reads requestId from the body', async () => {
    fetchMock.mockResolvedValue(
      makeRes(401, {
        error: 'UNAUTHENTICATED',
        message: 'Authentication required.',
        statusCode: 401,
        requestId: 'req-1',
      }),
    );
    const err = (await apiClient
      .get('/me', { skipAuthRedirect: true })
      .catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.requestId).toBe('req-1');
  });

  it('falls back to the x-request-id header when requestId is absent from the body', async () => {
    fetchMock.mockResolvedValue(
      makeRes(500, { error: 'INTERNAL_ERROR', message: 'x' }, { 'x-request-id': 'hdr-9' }),
    );
    const err = (await apiClient
      .get('/me', { skipAuthRedirect: true })
      .catch((e: unknown) => e)) as ApiError;
    expect(err.requestId).toBe('hdr-9');
  });

  it('handles a non-JSON error body (code UNKNOWN, empty message)', async () => {
    fetchMock.mockResolvedValue(makeRes(502, '<html>bad gateway</html>'));
    const err = (await apiClient
      .get('/me', { skipAuthRedirect: true })
      .catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('');
    expect(err.status).toBe(502);
  });

  it('maps a fetch rejection (network failure) to a NETWORK ApiError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await apiClient.get('/me').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NETWORK');
    expect(err.status).toBe(0);
  });

  it('fires the unauthorized handler on a 401 — but NOT when skipAuthRedirect is set', async () => {
    const handler = vi.fn();
    apiClient.onUnauthorized(handler);

    fetchMock.mockResolvedValue(makeRes(401, { error: 'UNAUTHENTICATED', message: 'x' }));
    await apiClient.get('/me').catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);

    handler.mockClear();
    await apiClient.get('/me', { skipAuthRedirect: true }).catch(() => undefined);
    expect(handler).not.toHaveBeenCalled();
  });
});
