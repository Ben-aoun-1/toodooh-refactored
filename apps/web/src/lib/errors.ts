/**
 * Type-narrowing helpers for caught error values.
 *
 * TypeScript strict mode types catch bindings as `unknown` (with
 * `useUnknownInCatchVariables`, which is on under strict). To access properties
 * like `.code` / `.message` safely, the binding must be narrowed first.
 *
 * Three patterns to pick from depending on what the catch body actually does:
 *
 * 1. **You need `.code` / `.details` / `.hint` (Supabase / PostgrestError
 *    shape)** → use `isErrorWithCode`:
 *
 *      try { … } catch (e) {
 *        if (isErrorWithCode(e)) {
 *          log.error({ err: e, code: e.code }, 'database error');
 *        } else {
 *          log.error({ err: e }, 'unknown error');
 *        }
 *      }
 *
 *    This is STRICT — a vanilla `Error` instance has no `code` property and
 *    will fail the guard, so plain `new Error('boom')` returns `false`.
 *
 * 2. **You only need a string `.message` for UI display** (handle both vanilla
 *    `Error` and Supabase shape) → use `getErrorMessage`:
 *
 *      try { … } catch (e) {
 *        toast.error(getErrorMessage(e) || 'Une erreur est survenue');
 *      }
 *
 *    Falls back to `''` for non-message-bearing values; combine with `||
 *    '<fallback>'` to keep a user-facing default.
 *
 * 3. **You only need to log the raw error** (no property access) → no helper
 *    needed; `log.error({ err: e }, '…')` works directly with `unknown` since
 *    pino's serialisers handle arbitrary shapes.
 *
 * Pure: no I/O, no side effects, no module-level state. Same invariant as
 * `lib/dooh/*` and `lib/logger.ts`.
 */

export interface ErrorWithCode {
  code: string;
  message: string;
  details?: string;
  hint?: string;
}

export function isErrorWithCode(e: unknown): e is ErrorWithCode {
  if (typeof e !== 'object' || e === null) return false;
  if (!('code' in e) || typeof (e as { code: unknown }).code !== 'string') return false;
  if (!('message' in e) || typeof (e as { message: unknown }).message !== 'string') return false;
  return true;
}

/**
 * Best-effort string extraction from `unknown` errors. Tries:
 *   1. `instanceof Error` (covers vanilla `new Error(...)`, `TypeError`, etc.)
 *   2. Structural `{ message: string }` (covers Supabase / PostgrestError)
 *   3. Returns `''` otherwise.
 *
 * Combine with `|| '<fallback>'` at the call site for a user-facing default
 * when the underlying value has no message.
 */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message;
  }
  return '';
}
