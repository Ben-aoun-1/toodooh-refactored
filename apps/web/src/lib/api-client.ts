/**
 * The single HTTP client for `apps/api` (Phase-1f keystone, design §1 / rulings D1/D2/D6).
 *
 * - **Base `/api`** (D1): the Vite dev proxy + prod nginx put `apps/web` and `apps/api` on one
 *   origin, so the path is relative — no `VITE_API_URL`.
 * - **`credentials: 'include'`** on every request so the better-auth httpOnly `Lax` session cookie
 *   rides same-origin.
 * - **Domain-agnostic errors** (D2): non-2xx → a structured {@link ApiError} carrying the machine
 *   `code` (read from `body.error`), HTTP `status`, raw `message`, optional `fields`/`requestId`.
 *   French translation is a separate concern (`features/auth/services/auth-errors.ts`), keeping this
 *   client reusable by later (non-auth) slices.
 * - **401 handling** (D6): a registered {@link onUnauthorized} handler fires on a mid-session 401
 *   (the store clears identity → guards redirect). Rehydration calls pass `skipAuthRedirect` so
 *   their 401 is the *normal* logged-out path and does NOT trip the handler. One-way dependency:
 *   this module never imports the store.
 *
 * No module-level mutable state except the single unauthorized handler.
 */

export interface ApiErrorField {
  field: string;
  reason: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: ApiErrorField[];
  readonly requestId?: string;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    fields?: ApiErrorField[];
    requestId?: string;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.status = args.status;
    this.code = args.code;
    this.fields = args.fields;
    this.requestId = args.requestId;
  }
}

const BASE = '/api';

let unauthorizedHandler: (() => void) | null = null;

interface RequestOptions {
  skipAuthRedirect?: boolean;
}

/**
 * Build an {@link ApiError} from a non-2xx response. The backend has two error shapes (design
 * §0.2): the route shape `{ error, message, fields? }` and the generic/guard shape
 * `{ error, message, statusCode, requestId }`. Both carry the code in `error`; `requestId` falls
 * back to the `x-request-id` header when absent from the body.
 */
function toApiError(status: number, raw: unknown, headerRequestId: string | null): ApiError {
  const body: Record<string, unknown> =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const code = typeof body.error === 'string' ? body.error : 'UNKNOWN';
  const message = typeof body.message === 'string' ? body.message : '';
  const fields = Array.isArray(body.fields) ? (body.fields as ApiErrorField[]) : undefined;
  const requestId =
    typeof body.requestId === 'string' ? body.requestId : (headerRequestId ?? undefined);
  return new ApiError({ status, code, message, fields, requestId });
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; form?: FormData; skipAuthRedirect?: boolean } = {},
): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' };
  if (opts.form !== undefined) {
    // Multipart: do NOT set Content-Type — the browser sets the boundary.
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    // fetch rejects only on a network-level failure (offline, DNS, CORS preflight block).
    throw new ApiError({ status: 0, code: 'NETWORK', message: '' });
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    const parsed: unknown = JSON.parse(text);
    return parsed as T;
  }

  let raw: unknown;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
  }
  const err = toApiError(res.status, raw, res.headers.get('x-request-id'));
  if (res.status === 401 && !opts.skipAuthRedirect) unauthorizedHandler?.();
  throw err;
}

export const apiClient = {
  /** Register the mid-session-401 handler (the store clears identity). Called once at store init. */
  onUnauthorized(fn: () => void): void {
    unauthorizedHandler = fn;
  },
  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>('GET', path, opts);
  },
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('POST', path, { ...opts, body });
  },
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('PATCH', path, { ...opts, body });
  },
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, { ...opts, body });
  },
  del<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, opts);
  },
  postForm<T>(path: string, form: FormData, opts?: RequestOptions): Promise<T> {
    return request<T>('POST', path, { ...opts, form });
  },
};
