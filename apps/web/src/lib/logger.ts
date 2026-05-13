/**
 * Frontend logger — pino-backed.
 *
 * Pure: no I/O at module load (just configuration). All log output goes through
 * pino's browser shim, which by default writes to `console.{log,info,warn,error}`
 * — so this module satisfies the `no-console` ESLint rule by routing every log
 * call through a single point rather than scattering raw console statements.
 *
 * Levels by environment:
 *   - test (`import.meta.env.MODE === 'test'`) → silent (no output during vitest)
 *   - dev  (`import.meta.env.DEV`)             → debug
 *   - prod (else)                              → info
 *
 * Module-scoped usage (preferred):
 *
 *   const log = logger.child({ module: 'auth.service' });
 *   log.error({ err, userId }, 'failed to load profile');
 *
 * Pino call shape: **context object first, message string second**. Error objects go
 * in the context object's `err` field (not folded into the message); pino's serialisers
 * extract `err.message` / `err.stack` automatically. A bare `log.info('hello')` is fine
 * for context-free messages.
 *
 * This file is the ONLY place `console.*` is permitted in production source
 * (via pino's browser shim, indirectly). Lint exempts this path explicitly.
 */

import pino, { type Logger, type LevelWithSilent } from 'pino';

const isTest = import.meta.env.MODE === 'test';
const isDev = import.meta.env.DEV;

const level: LevelWithSilent = isTest ? 'silent' : isDev ? 'debug' : 'info';

export const logger: Logger = pino({
  level,
  browser: {
    asObject: false,
  },
});

export type { Logger };
