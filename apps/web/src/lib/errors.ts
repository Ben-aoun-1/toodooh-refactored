/**
 * Type-narrowing helpers for caught error values.
 *
 * TypeScript strict mode types catch bindings as `unknown` (with
 * `useUnknownInCatchVariables`, which is on under strict). To access properties
 * like `.code` / `.message` safely, the binding must be narrowed first.
 *
 * Most TOODOOH error paths receive a Supabase / PostgrestError shape:
 *   { code: string; message: string; details?: string; hint?: string }
 *
 * `isErrorWithCode` is the cheap structural guard for that shape. Use it inside
 * `catch` blocks before accessing the error's properties:
 *
 *   try { … } catch (e) {
 *     if (isErrorWithCode(e)) {
 *       log.error({ err: e, code: e.code }, 'database error');
 *     } else {
 *       log.error({ err: e }, 'unknown error');
 *     }
 *   }
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
