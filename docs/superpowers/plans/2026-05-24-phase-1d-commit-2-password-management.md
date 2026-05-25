# Phase 1d Commit 2 — password management (request-reset + complete-reset + change-password)

The full password surface, completing session auth. Three operations the frontend needs
(contract §3.5/§3.6): request-reset (unauthenticated → email a reset link), complete-reset
(unauthenticated → token + new password), change-password (authenticated → current + new, invalidates
other sessions). Wraps better-auth's three password ops (same wrap-and-shape pattern as signin),
routes the reset email through the existing `EmailSender`/OVH SMTP (Phase 1b Commit 4), adds a reset
template. After this, Phase 1d closes with its audit refresh (Commit 3).

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `e9ee9a5` (Commit 1 — signin/out). CI-green. Floor:
apps/api **110** / root **270**; root typecheck 51 / lint 1 / build 139.80; apps/api typecheck 0 /
lint 0 / build ok.

**CF-18 sweep.** No `routes/password.ts`, no `email/reset-template.ts`, no `sendResetPassword` in
`auth.ts`. `EmailSender`/`SmtpEmailSender` + `emailSender` singleton + the verification template +
the `requireAuth` guard all exist. The raw `/auth/request-password-reset`, `/auth/reset-password`,
`/auth/change-password` are reachable through the catch-all (only `/auth/sign-up/email` is 404'd) —
no plugin change.

**Node 20 PATH prefix** + heap bump on commit. apps/api suite **serialized** (`fileParallelism:false`);
the new users-writing `password.test.ts` inherits it. Local runs need the full env block
([[local-migrate-needs-full-env-block]]).

---

## §1 — Locked constraints (architect)

1. **Wrap better-auth's three password ops** — `requestPasswordReset` / `resetPassword` /
   `changePassword` (§2.1). Custom endpoints shape responses, route the email, hold anti-enumeration.
   The raw `/auth/*` equivalents stay reachable.
2. **Reset email** through `emailSender` (OVH SMTP) via the **`emailAndPassword.sendResetPassword`**
   hook — a NEW reset template, NEVER-THROW (the Commit-4 Q2 lesson).
3. **Anti-enumeration on request-reset** — identical generic response whether the email exists or not
   (built-in; §2.4).
4. **change-password** — `requireAuth`-guarded, re-auths with the current password, invalidates other
   sessions while the current device survives (§2.5).
5. **Reset-token mechanism verified** — a **verifications-table row**, NOT a JWT (§2.2 — the opposite
   of email-verify; the Commit-3-class trap avoided).
6. **One commit** — all three ops (cohesive surface, shared template + wrap). One route file
   `password.ts` (~140 lines, under 400 — §2.7).
7. **12-char min** on every new-password input — better-auth enforces `minPasswordLength` (12, set
   Commit 2) automatically (§2.6); the wrapper zod also validates 12 for a clean shaped 400.

**Out of scope:** email-change verification; account deletion/deactivation (Phase 1f); 2FA/MFA;
rate-limiting on reset-request (noted future hardening — a public reset endpoint is a spam vector);
frontend (Phase 1e repoint of ResetPasswordForm/UpdatePasswordForm).

---

## §2 — Inventory & CF-23 verification (verified against installed better-auth 1.6.11 source)

### §2.1 — the three ops ✅
- **`auth.api.requestPasswordReset({ body: { email, redirectTo? } })`** (`api/routes/password.mjs:20`,
  endpoint `/request-password-reset`). Requires `emailAndPassword.sendResetPassword` configured —
  else throws `RESET_PASSWORD_DISABLED` (`:42`). **We MUST wire the hook.**
- **`auth.api.resetPassword({ body: { token, newPassword } })`** (`:120`, endpoint `/reset-password`).
  Validates the token row, enforces min/max length, sets the password, deletes the token row (`:140-
  165`).
- **`auth.api.changePassword({ body: { currentPassword, newPassword, revokeOtherSessions? }, headers,
  returnHeaders: true })`** (`api/routes/update-user.mjs:75`). Re-auths `currentPassword`,
  re-cookies on revoke (§2.5).

### §2.2 — THE reset-token mechanism: a VERIFICATIONS-TABLE ROW, not a JWT ✅ (the load-bearing one)
`requestPasswordReset` generates `verificationToken = generateId(24)` (a random 24-char token, **not
a signed JWT**) and stores `createVerificationValue({ identifier: 'reset-password:<token>', value:
userId, expiresAt })` (default 3600s; `password.mjs:64-71`). `resetPassword` does
`findVerificationValue('reset-password:<token>')`, checks expiry, reads `userId = verification.value`,
sets the password, `deleteVerificationByIdentifier` (`:147-159`). **This is the OPPOSITE of
email-verify** (Commit-3 finding: signup verify = stateless JWT). Verified directly — the
assume-same-as-verification trap (the Commit-3-class surprise) is avoided. **Test can read the token
from the `verifications` row** (`identifier LIKE 'reset-password:%'`).

### §2.3 — the reset link in the email
The hook receives `{ user, url, token }`; `url = ${baseURL}/reset-password/<token>?callbackURL=
<redirectTo>` (`password.mjs:72`). We embed better-auth's `url` in the email AS-IS (it carries the
token + hits better-auth's `/auth/reset-password/:token` callback, which validates + redirects to the
FE `callbackURL`). **No new env** — same shape as the verification email (links to the backend; the
FE `redirectTo`/`callbackURL` page is a **Phase-1e carry-forward**, alongside the existing verification
`callbackURL` carry-forward). M-decision: link = better-auth `url`.

### §2.4 — anti-enumeration on request-reset ✅
`requestPasswordReset` for an **unknown** email runs a **timing-equalizing simulation** (`generateId(24)`
+ `findVerificationValue("dummy-verification-token")`) and returns the **identical** body `{ status:
true, message: "If this email exists…" }` **without sending** (`password.mjs:50-62`). For a known
email it creates the row, calls the hook, returns the **same** body. Response is byte-identical either
way; the email only sends if the account exists. Built-in — no special wrap needed; we just don't add
a leak.

### §2.5 — change-password re-auth + session invalidation ✅
`changePassword` (`update-user.mjs:148-183`): uses `sensitiveSessionMiddleware` (authenticated);
enforces minPasswordLength; re-auths `password.verify(currentPassword)` → wrong → `INVALID_PASSWORD`
(400). With **`revokeOtherSessions: true`**: `deleteSessions(userId)` (kills **all** sessions incl.
the caller's) → `createSession(userId)` (a fresh one) → `setSessionCookie` (new cookie) → returns
`{ token, user }`. **So: every old cookie dies; the caller continues via the NEW cookie in the change
response.** The D4 model — current device survives (via the refreshed cookie), other devices logged
out. We pass `revokeOtherSessions: true`, `returnHeaders: true`, and forward the new Set-Cookie.

### §2.6 — min-password enforcement ✅
`resetPassword` AND `changePassword` both check `minPasswordLength` (PASSWORD_TOO_SHORT → 400)
automatically (config = 12, Commit 2). The wrappers **also** zod-validate `new_password` min 12 for a
clean shaped 400 (consistent with the other endpoints; defense-in-depth).

### §2.7 — route file (M6) + FE greenfield
One file `routes/password.ts` (3 handlers + schemas + the cookie helper ≈ 140 lines, under 400) —
recommend (cohesive surface). FE is **greenfield** re: API (Supabase-direct: `resetPasswordForEmail`,
`updateUser({password})`, `signInWithPassword` re-auth — `auth.service.ts:699/711/767`) → no wire to
match; design clean paths, Phase-1e repoints.

### §2.8 — never-throw reset hook (Q2) ✅
`sendResetPassword` is invoked via `runInBackgroundOrAwait` (awaited when no background runner — a
throw would fail `requestPasswordReset`). Mirror `sendVerificationEmail`: try/catch, `emailSender.send`,
log on failure, **never throw**. An SMTP outage → the request still returns generic success (no leak,
no 500).

### §2.9 — CF-21/22
- **CF-21:** no new env var (SMTP/EmailSender/BETTER_AUTH_URL exist). No cascade. `.env.example`/
  `ci.yml` untouched (confirm at 2.1).
- **CF-22 watch:** M3 (`revokeSessionsOnPasswordReset: true` for the reset flow) + M5 (link = better-
  auth `url`, FE page deferred) are the judgment calls; both surfaced.

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **2.0** | Plan (this file). Halt; surface M1–M7; ratify; commit + push (CF-6). |
| **2.1** | `routes/password.ts` + `email/reset-template.ts` + `auth/auth.ts` (sendResetPassword + revokeSessionsOnPasswordReset) + `routes/index.ts` + `tests/password.test.ts`. Halt; CF-9 (live: anti-enum symmetry, Q2 SMTP-fail-generic, reset old-fails/new-works, change re-auth + session-invalidation); ratify; push (CF-7). |

2.1 judgment seams: the never-throw hook, the change-password cookie-forward, the anti-enum assertions.

---

## §4 — Per-commit verification gates

### Gate 2 — apps/api per-package
```
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # ~121-125 (needs Postgres)
pnpm --filter @toodooh/api build       # ok
```

### Gate 3 — root no-regression vs `e9ee9a5`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 270 | **~281-285** (+~11-15) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 4 — live (real Postgres, nodemailer mocked)
- request-reset existing → generic 200 + `emailSender.send` called; unknown → **identical** 200 +
  send **not** called; SMTP-fail (`emailSender.send` → `{error}`) → still 200 (hook swallowed).
- complete-reset valid token + ≥12 pw → 200; **sign in with new works, old 401**; invalid/expired
  token → 400; <12 → 400.
- change-password correct current + ≥12 → 200 (new cookie); wrong current → 400; unauth → 401; <12 →
  400; **other session dies + current (new cookie) survives**.

### Gate 5 — CI green (Postgres service present; no new service). Optional operator-gated real reset
send (confirmation, not the gate).

---

## §5 — Standing operating procedure
CF-6 for 2.0; CF-7 for 2.1. Node-20 prefix; heap bump. CF-18 re-sweep before first Write. **No new
deps** — verify `pnpm-lock.yaml` untouched at 2.1.

---

## §6 — Hard-halt conditions
1. Reset-token mechanism undeterminable / complete-reset can't validate — **RESOLVED §2.2** (verifications row).
2. requestPasswordReset leaks existence — **RESOLVED §2.4** (timing-equalized, identical body).
3. changePassword can't revoke-others-keep-current — **RESOLVED §2.5** (delete-all + re-cookie).
4. The reset hook throws unavoidably — **RESOLVED §2.8** (mirror the never-throw verification hook).
5. Any gate regresses vs `e9ee9a5`.

---

## §7 — Risk register
| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| reset hook throws → 500 / leak | Low | Gate 4 SMTP-fail | never-throw (try/catch + log), mirror sendVerificationEmail |
| change re-cookie not forwarded → current device logged out | Low | Gate 4 session test | `returnHeaders:true` + forward `getSetCookie()` |
| anti-enum response differs existing vs unknown | Low | Gate 4 symmetry | better-auth returns identical body; assert byte-equality |
| reset link unusable without FE | Known | — | use better-auth `url`; FE page is a Phase-1e carry-forward (like verification callbackURL) |
| token row not found in test | Low | Gate 4 | read `verifications` where `identifier LIKE 'reset-password:%'` |

---

## §8 — Cross-references
- better-auth `dist/api/routes/password.mjs` (request/reset) + `update-user.mjs` (change),
  `cookies/index.mjs` (set/deleteSessionCookie).
- `auth/auth.ts` (the existing `sendVerificationEmail` never-throw hook to mirror; add
  `sendResetPassword`), `email/template.ts` (the verification template to mirror), `email/
  smtp-sender.ts` (`emailSender`), `routes/signin.ts` (the wrap + APIError + cookie-forward pattern),
  `middleware/require-auth.ts`, `tests/signin.test.ts` + `tests/signup.test.ts` (real-PG + nodemailer
  mock + cookie capture).
- `frontend-backend-contract.md` §3.5/§3.6 (the FE flows), §5.4 (the FE password-floor inconsistency,
  class b).

---

## §9 — Carry-forward methodology
- **CF-9** — 2.1 pause: full file contents + Gate-4 live (anti-enum symmetry, Q2 SMTP-fail-generic,
  reset old/new, change re-auth + session-invalidation) + count reconciliation.
- **CF-10** floor re-confirmed (§0). **CF-18** swept (§0).
- **CF-21** — no new env var; no cascade.
- **CF-22** — M3 (revoke-on-reset) + M5 (reset-link target) surfaced.
- **CF-23** — the THREE op signatures + **the reset-token mechanism (verifications-row, NOT JWT)** +
  the never-throw hook + anti-enum + session-invalidation all verified at plan-write against installed
  source; the live behaviors are the execution-time layer. The token-mechanism check is the explicit
  Commit-3-class-trap avoidance.
- **CF-24** — greenfield (FE Supabase-direct); the verify-first/reset flows + 12-char floor are
  class-(b) the FE converges to in Phase 1e (carry-forward).

---

## §10 — Push policy + sequencing
**2.0** — `git add` plan; `docs(phase-1d): plan Commit 2 — password management`; push; `gh run watch`
(CF-6). Node 20.
**2.1** — `git add apps/api`; `feat(api): password management — reset-request + reset + change (better-
auth wrap, reset email, session invalidation)`; push; `gh run watch` (CF-7). Node 20. No
`Co-Authored-By`. **Verify `pnpm-lock.yaml` untouched.**

---

## §11 — Exact file contents (Commit 2.1)

### `apps/api/src/email/reset-template.ts` (new — mirrors template.ts; role-agnostic)
```ts
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif";

export const resetEmailSubject = 'Réinitialisation de votre mot de passe Toodooh';

export const resetEmailTemplate = ({ name, resetUrl }: { name: string; resetUrl: string }): string =>
  `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:24px 0;background:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;font-family:${FONT};color:#333333;">
    <div style="padding:30px;text-align:center;border-bottom:1px solid #e0e0e0;">
      <span style="font-size:28px;font-weight:bold;color:#204B43;letter-spacing:-0.5px;">toodooh</span>
    </div>
    <div style="padding:30px;font-size:14px;line-height:1.5;">
      <p>Bonjour <strong>${name}</strong>,</p>
      <p>Nous avons reçu une demande de réinitialisation du mot de passe de votre compte Toodooh.</p>
      <p>Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe&nbsp;:</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="${resetUrl}" style="background:#76E6AB;color:#204B43;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:bold;display:inline-block;">Réinitialiser mon mot de passe</a>
      </p>
      <p>Ce lien expire dans une heure.</p>
      <p style="margin:24px 0 16px;">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email — votre mot de passe restera inchangé.</p>
      <p>À très vite,<br>L'équipe Toodooh</p>
    </div>
    <div style="padding:24px 30px;text-align:center;border-top:1px solid #e0e0e0;color:#888888;font-size:12px;">
      <p style="margin:0 0 8px;">Toodooh, jump into smarter advertising</p>
      <p style="margin:0;">Pensez à vérifier vos spams si vous ne recevez pas l'email.</p>
    </div>
  </div>
</body>
</html>`;

export const resetEmailPlainText = ({ name, resetUrl }: { name: string; resetUrl: string }): string =>
  `Bonjour ${name},

Nous avons reçu une demande de réinitialisation du mot de passe de votre compte Toodooh.

Pour choisir un nouveau mot de passe, ouvrez ce lien (il expire dans une heure) :
${resetUrl}

Si vous n'avez pas demandé cette réinitialisation, ignorez cet email — votre mot de passe restera inchangé.

À très vite,
L'équipe Toodooh

---
Toodooh, jump into smarter advertising
Pensez à vérifier vos spams si vous ne recevez pas l'email.`;
```

### `apps/api/src/auth/auth.ts` — add the reset hook (never-throw) + revoke-on-reset
Add imports for `resetEmailSubject/resetEmailTemplate/resetEmailPlainText`; define a
`sendResetPassword` mirroring `sendVerificationEmail` (try/catch, `emailSender.send`, log, never
throw); extend `emailAndPassword`:
```ts
const sendResetPassword = async (args: {
  user: { email: string; name?: string };
  url: string;
}): Promise<void> => {
  try {
    const result = await emailSender.send({
      to: args.user.email,
      subject: resetEmailSubject,
      html: resetEmailTemplate({ name: args.user.name ?? '', resetUrl: args.url }),
      text: resetEmailPlainText({ name: args.user.name ?? '', resetUrl: args.url }),
    });
    if ('error' in result) logger.error({ to: args.user.email, error: result.error }, 'reset email failed');
    else logger.info({ to: args.user.email, messageId: result.messageId }, 'reset email sent');
  } catch (err) {
    logger.error({ to: args.user.email, err }, 'reset email threw (swallowed)');
  }
};
// ...
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    sendResetPassword,                    // wires /api/password/reset-request
    revokeSessionsOnPasswordReset: true,  // forgot-password kills all sessions (M3)
  },
```

### `apps/api/src/routes/password.ts` (new)
```ts
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { requireAuth } from '../middleware/require-auth.js';

const resetRequestSchema = z.object({ email: z.email('A valid email is required') });
const resetSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  new_password: z.string().min(12, 'Password must be at least 12 characters'),
});
const changeSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(12, 'Password must be at least 12 characters'),
});

const invalidInput = (reply: FastifyReply, issues: { path: (string | number)[]; message: string }[]) =>
  reply.status(400).send({
    error: 'INVALID_INPUT',
    message: 'Validation failed',
    fields: issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
  });

const forwardSetCookie = (reply: FastifyReply, headers: Headers): void => {
  for (const cookie of headers.getSetCookie()) void reply.header('set-cookie', cookie);
};

export const passwordRoutes: FastifyPluginAsync = async (app) => {
  // Unauthenticated. Generic success regardless of whether the email exists (better-auth
  // timing-equalizes + returns an identical body; the email only sends for a real account).
  app.post('/api/password/reset-request', async (request, reply) => {
    const parsed = resetRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply, parsed.error.issues);
    await auth.api.requestPasswordReset({
      body: { email: parsed.data.email },
      headers: fromNodeHeaders(request.headers),
    });
    return reply.status(200).send({
      success: true,
      message: 'If this email exists, a reset link has been sent.',
    });
  });

  // Unauthenticated. Token + new password (≥12). better-auth validates the token row + length.
  app.post('/api/password/reset', async (request, reply) => {
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply, parsed.error.issues);
    try {
      await auth.api.resetPassword({
        body: { token: parsed.data.token, newPassword: parsed.data.new_password },
        headers: fromNodeHeaders(request.headers),
      });
    } catch (err) {
      if (err instanceof APIError) {
        return reply
          .status(400)
          .send({ error: 'INVALID_TOKEN', message: 'This reset link is invalid or has expired.' });
      }
      request.log.error(err, 'password reset failed');
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' });
    }
    return reply.status(200).send({ success: true });
  });

  // Authenticated. Re-auths current password; invalidates other sessions, keeps the current
  // device alive via the refreshed cookie (revokeOtherSessions → delete-all + new session).
  app.post('/api/password/change', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = changeSchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply, parsed.error.issues);
    const change = () =>
      auth.api.changePassword({
        body: {
          currentPassword: parsed.data.current_password,
          newPassword: parsed.data.new_password,
          revokeOtherSessions: true,
        },
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
    let result: Awaited<ReturnType<typeof change>>;
    try {
      result = await change();
    } catch (err) {
      if (err instanceof APIError) {
        // wrong current password (INVALID_PASSWORD) → generic 400; length is caught by zod above.
        return reply
          .status(400)
          .send({ error: 'INVALID_CREDENTIALS', message: 'The current password is incorrect.' });
      }
      request.log.error(err, 'password change failed');
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' });
    }
    forwardSetCookie(reply, result.headers); // the refreshed current-session cookie
    return reply.status(200).send({ success: true });
  });
};
```
> **NOTE (2.1):** final typing of `result`/`getSetCookie` locked at 2.1 (same as signin); the `invalidInput`
> helper may be inlined if lint/readability prefers — a mechanical deviation surfaced in CF-9.

### `apps/api/src/routes/index.ts` — register
```ts
import { passwordRoutes } from './password.js';
// ...
  await app.register(passwordRoutes);
```

### `apps/api/tests/password.test.ts` (new — real Postgres + mocked nodemailer)
- `vi.hoisted` + `vi.mock('nodemailer')`; spy `emailSender.send` for the call/not-called assertions.
- `createVerifiedUser` (signUpEmail + flip emailVerified) from the signin pattern; a
  `resetTokenFor()` reading `verifications.identifier LIKE 'reset-password:%'` → the token.
- Cases (~12): request-reset existing → 200 + send called; request-reset unknown → identical 200 +
  send NOT called; request-reset SMTP-fail (`emailSender.send`→`{error}`) → still 200; reset valid →
  200, sign-in new works + old 401; reset invalid token → 400; reset <12 → 400; change correct →
  200 + sign-in new works; change wrong current → 400; change unauth → 401; change <12 → 400; change
  revokeOtherSessions → other cookie 401 + the new cookie 200.

**Test delta: apps/api 110 → ~121-125.** Exact locked + reconciled at 2.1. `.env.example`/`ci.yml`
unchanged.

---

## §12 — Fire instruction

This is **Commit 2.0** (plan). Architect: ratify M1–M7; on approval, commit + push docs-only.
**Halt** until then.

- **M1 — reset-token = verifications-table row** (NOT a JWT; `generateId(24)` + `reset-password:<token>`
  row); complete-reset validates the row. *The load-bearing verification; Commit-3-trap avoided.*
- **M2 — wrap the three ops** (`requestPasswordReset`/`resetPassword`/`changePassword`); raw `/auth/*`
  stays reachable. *Recommend.*
- **M3 — `revokeSessionsOnPasswordReset: true`** (reset = forgot → kill all sessions; user re-signs-in)
  + change-password `revokeOtherSessions: true` (kill others, current survives via new cookie).
  *Recommend.*
- **M4 — anti-enumeration** on request-reset: identical generic 200 (existing = unknown), send only
  if the account exists; the hook **never throws** (SMTP-fail → still generic). *Recommend.*
- **M5 — reset link = better-auth's `url`** (carries the token; FE reset page deferred to Phase 1e,
  like the verification callbackURL); no new env. *Recommend.*
- **M6 — one file** `routes/password.ts` (~140 lines) + a separate `email/reset-template.ts`.
  *Recommend.*
- **M7 — endpoint paths + wire** `POST /api/password/{reset-request,reset,change}`; bodies `{email}` /
  `{token,new_password}` / `{current_password,new_password}` (snake_case; FE greenfield); 12-char min
  in zod + better-auth. *Recommend.*

Plus acknowledge: no new env / no new deps (lockfile untouched); count lift apps/api 110→~121-125 /
root 270→~281-285; the Phase-1e carry-forwards (FE repoints reset/change; converges to 12-char;
the FE reset-page `callbackURL`); CF-21/22/23/24 in §9.
