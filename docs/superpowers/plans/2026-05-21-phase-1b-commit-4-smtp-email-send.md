# Phase 1b Commit 4 — OVH SMTP wiring (nodemailer + EmailSender abstraction) + verification email template + first real send

Fourth and final commit of Phase 1b. Commit 3 (`927d61b`) shipped `POST /api/signup`
with JWT-stateless email verification — but the verification email is still the
Commit-2 **stub** (logs to pino). Commit 4 replaces the stub with a real
`SmtpEmailSender` (nodemailer → OVH SMTP) behind an `EmailSender` interface, plus
a French, brand-aligned verification email template. After this, a real signup
produces a real inbox email whose JWT link verifies the address. **Phase 1b
closes after this; the audit refresh (promoting CF-21/22/23) follows.**

**CF-23 verification (better-auth installed source + nodemailer via Context7
`/nodemailer/nodemailer-homepage`) surfaced two findings that change the locked
plan, both for ratification BEFORE code:**

- **F1 (→ Q1) — ethereal can't be the CI test path.** `nodemailer.createTestAccount()`
  makes a **network call** to provision an ephemeral account. CI tests must make
  **no external network calls** (verification gate + hard-halt). So Decision 6's
  "unit tests use ethereal createTestAccount" cannot stand for automated tests.
  **Recommend: mock nodemailer in tests (network-free); reserve ethereal for
  optional local manual preview.**
- **F2 (CRITICAL, interaction → Q2) — the `sendVerificationEmail` hook must NEVER
  throw.** better-auth `await`s the hook (`sign-up.mjs:243`). If it throws,
  `signUpEmail` throws → `/api/signup` catch → **Commit-3's `deleteOrphanUser`
  deletes the just-created user** + 500. So an email outage would *delete the
  account*. **Recommend: the hook swallows all errors (logs, returns); EmailSender
  returns `{messageId}|{error}` and never throws.** This is the correct mechanism
  for Decision 8 ("signup completes even if email fails").

Plus F3–F6 (versions/types, hook signature, sendMail-throws, env coercion) and
the CF-21 sixth-instance cascade. All micro-decisions in §2/§12.

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `927d61b` (Phase 1b Commit 3.1),
pushed + CI-green (run `26256593231`, first run with the Postgres service).

**Baseline floor (CF-10, plan-time).** typecheck **51** / lint **1** / test
**192** (160 web + 32 api) / build apps/web **139.80 kB**.

**CF-18 sweep — clean.** No `apps/api/src/email/` dir. No `SmtpEmailSender`,
`EmailSender`, `nodemailer`, `SMTP_` in `src`/`package.json`/`.env.example`. The
`auth.ts` hook is still the Commit-2 `sendVerificationEmailStub` (pino log).

**Node 20 PATH prefix** on every gate + git command. Heap bump on commit.

---

## §1 — Locked constraints

**Pinned (CF-19, plan-time):** `nodemailer` **8.0.7** (`npm view` → 8.0.7;
engines node>=6, compatible). `@types/nodemailer` **8.0.0** (devDep; nodemailer
ships **no** bundled types — verified `npm view nodemailer types` empty). Both
exact, no caret.

**In scope (Commit 4.1), reflecting recommended F1–F6 resolutions:**

| File | Action |
| --- | --- |
| `apps/api/src/email/sender.ts` | **new** — `EmailSender` interface |
| `apps/api/src/email/smtp-sender.ts` | **new** — `SmtpEmailSender` (nodemailer, per-send transport) |
| `apps/api/src/email/template.ts` | **new** — French HTML + text verification template |
| `apps/api/src/auth/auth.ts` | modify — export `emailSender` singleton; hook = real send (never-throws, F2) |
| `apps/api/src/env.ts` | modify — six `SMTP_*` vars |
| `apps/api/.env.example` | modify — six `SMTP_*` placeholders |
| `apps/api/package.json` | modify — `nodemailer` dep + `@types/nodemailer` devDep |
| `apps/api/tests/email.test.ts` | **new** — sender + template unit tests (nodemailer mocked) |
| `apps/api/tests/signup.test.ts` | modify — mock nodemailer; assert send attempted; +email-failure-still-201 test |
| `apps/api/vitest.config.ts` | modify (CF-21) — fake `SMTP_USER/PASSWORD/FROM` |
| `apps/api/tests/error-handler.test.ts` | modify (CF-21) — `SMTP_*` in Env literal |
| `apps/api/tests/env.test.ts` | modify (CF-21) — `SMTP_*` success cases + missing-→-fail test |
| `.github/workflows/ci.yml` | modify — fake `SMTP_*` in job env |
| `pnpm-lock.yaml` | modify — nodemailer tree |

**Out of scope (per architect SCOPE-OUT):** Resend/other providers, rate-limit/
queue, open-tracking, send-retry, password-reset/email-change templates, admin
notifications, frontend UX, real email in CI, prod secret management (Phase 1g).

---

## §2 — Inventory phase & CF-23 findings

Verified: better-auth `dist/api/routes/sign-up.mjs` (installed); nodemailer via
Context7 `/nodemailer/nodemailer-homepage`.

### F1 (→ Q1) — ethereal needs network → mock nodemailer for tests
`nodemailer.createTestAccount()` provisions an account over the network from
ethereal.email. CI test runs must be network-free (gate + hard-halt). **Recommend:
`vi.mock('nodemailer')` in `email.test.ts` and `signup.test.ts`** — the transport
is a stub returning a synthetic `{ messageId }`; assert `createTransport` config
+ `sendMail` args. ethereal stays a documented **local** convenience only (not
automated). Overrides Decision 6's "unit tests use ethereal".

### F2 (CRITICAL, → Q2) — the hook must never throw
`sign-up.mjs:243`: `await runInBackgroundOrAwait(sendVerificationEmail(...))`. A
throwing hook propagates → `signUpEmail` throws → `/api/signup` catch → **Commit-3
`deleteOrphanUser` deletes the new user** + 500. **Recommend:** `EmailSender.send`
returns `{ messageId } | { error }` (catches `sendMail`'s throw internally); the
hook additionally `try/catch`es and only logs. signup then always completes
(Decision 8), and a transient SMTP outage never deletes an account.

### F3 (→ Q4) — versions + types
`nodemailer@8.0.7`, `@types/nodemailer@8.0.0` (no bundled types → @types required;
not deprecated). Exact-pin both.

### F4 (confirm) — hook signature unchanged
`sendVerificationEmail({ user, url, token }, request)` — identical to the Commit-2
stub. `url` already carries the JWT link (`…/auth/verify-email?token=eyJhbGci…`,
Commit-3 finding) — no URL construction in our hook.

### F5 — `sendMail` throws on failure
Context7 confirms `transporter.sendMail(...)` returns
`{ messageId, accepted, rejected, response }` and **throws** on error. So
`SmtpEmailSender.send` wraps it in try/catch → returns the result union.

### F6 (→ Q5) — env coercion for SMTP_SECURE / SMTP_PORT
env values are strings. `z.stringbool()` (verified present in zod 4.4.3:
`z.stringbool().parse('true') === true`) coerces `SMTP_SECURE`; `z.coerce.number()`
for `SMTP_PORT`. Defaults: HOST `smtp.mail.ovh.net`, PORT `465`, SECURE `true`.
**Required (no default):** `SMTP_USER` (email), `SMTP_PASSWORD` (min 8), `SMTP_FROM`
(email).

### CF-21 sixth instance — the required-var cascade (→ Q6)
Only the 3 **required** SMTP vars (USER/PASSWORD/FROM) need test shims (the 3
defaulted ones don't). `vitest.config.ts` (env-aware fallback), `error-handler.test.ts`
(inline Env literal), `env.test.ts` (parseEnv success cases), and `ci.yml` job env
all get fakes. Same mechanical pattern as AUTH_SECRET (Commit 2) / BETTER_AUTH_URL
(Commit 3).

### Template approach (Decision 5)
Single-column, `max-width:600px`, **inline CSS only** (no external stylesheets/
fonts — email-client standard). Brand hexes from `apps/web/tailwind.config.js`:
deep `#204B43`, primary `#76E6AB`, accent `#9195F8`. French copy. HTML + plain-text
fallback. Standard, well-understood pattern → no email-on-acid verification needed
for slice 1 (inline CSS + table-free single column is broadly compatible).

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **4.0** | Plan (this file). Halt; surface Q1–Q6; ratify; commit + push (CF-6). |
| **4.1** | email module + auth.ts wiring + env + tests + ci.yml + deps. Halt; CF-9 (incl. **operator-gated real-send** boot verification); ratify; push (CF-7). |

4.1 has an **operator-dependent** seam: the real OVH send needs Ben's credentials
+ inbox (executor can't self-serve). Automated gates (mocked) validate the code
regardless; the real-send + Authentication-Results check is operator-gated.

---

## §4 — Per-commit verification gates

### Gate 2 — per-package (apps/api floor: test 32 → 38)
```bash
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # 38 (nodemailer mocked; Postgres for signup suite)
pnpm --filter @toodooh/api build       # success
```

### Gate 3 — root no-regression vs `927d61b`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 192 | **198** (+6) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 4 — CI (fake SMTP env, no network)
Tests pass with mocked nodemailer; **no external SMTP connection** during CI.

### Gate 5 — real-send boot verification (LOCAL, operator-gated)
```bash
# Ben supplies real OVH creds in apps/api/.env (SMTP_USER/PASSWORD/FROM + host/port/secure)
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @toodooh/api migrate
pnpm --filter @toodooh/api dev
# POST /api/signup with Ben's PERSONAL email as the user email
#   pino: "verification email sent" + messageId
#   Ben's inbox: From "Toodooh <no-reply@too-dooh.com>", subject FR, JWT link,
#     HTML+text render; Authentication-Results: spf=pass dkim=pass dmarc=pass
#   click link → /auth/verify-email → DB users.email_verified = true
# Failure case: wrong SMTP_PASSWORD → signup STILL 201, error logged (F2/Decision 8)
# teardown: down -v, rm .env
```
Captured in 4.1 CF-9: timestamp, Message-ID, Authentication-Results, verified flip.

---

## §5 — Standing operating procedure

CF-6 for 4.0; CF-7 for 4.1 (gate sweep → mocked-test verify → operator-gated
real-send → CF-9 → ratify → push → CI). Node-20 prefix; heap bump. CF-18 re-sweep
before first Write. CF-23 verification done plan-time (§2); nodemailer source
re-verified at install.

---

## §6 — Hard-halt conditions

1. Q1/Q2 unratified — they change the test strategy and the failure-handling
   contract; no code until ruled.
2. nodemailer's installed `createTransport`/`sendMail` shape diverges from §2 — halt.
3. Mocking nodemailer doesn't intercept the transport (real connection attempted
   in CI) — halt.
4. The never-throw hook still lets an error reach `signUpEmail` (orphan deletion
   recurs) — halt.
5. `SMTP_*` name collides with an existing env var — halt (none known).
6. Any gate regresses vs `927d61b`.
7. **Real-send (Gate 5):** OVH auth fails, or spf/dkim/dmarc not all pass — halt,
   surface headers (operator + architect decide; may be a DNS/OVH-config issue
   outside code).

---

## §7 — Risk register

| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| ethereal network call breaks CI | **Resolved by Q1** | Gate 4 | mock nodemailer |
| email failure deletes user (orphan rollback) | **Resolved by Q2** | Gate 5 failure case | never-throw hook |
| @types/nodemailer mismatch | Low | Gate 2 typecheck | 8.0.0 ↔ 8.0.7 (same major) |
| SMTP_SECURE coercion wrong | Low | Gate 2/5 | `z.stringbool()` (verified) |
| SPF/DKIM/DMARC fail → spam/bounce | Medium | Gate 5 | operator-gated; DNS fix if needed (out-of-code) |
| transport-per-send latency | Low | Gate 5 | slice-1 volume; pool deferred (Decision 2) |
| hook backgrounded → stub-spy race | Low | Gate 2 | `vi.waitFor` (carried from Commit 3) |
| lockfile pulls large nodemailer tree | Low | lockfile diff | nodemailer has zero runtime deps |

---

## §8 — Cross-references

- `00-PROJECT_HANDOFF.md` §4 — self-hosted auth; owns its domain (`too-dooh.com`).
- `supabase-schema-inventory.md` §5.2 — legacy `enable_confirmations=false`
  (email-verify was OFF); Phase 1 turned it ON (Commit 2) → Commit 4 is the new
  send capability. `itstrategix.tn` site_url replaced by our domain.
- `better-auth@1.6.11` `sign-up.mjs:240-247` — JWT token + `sendVerificationEmail`
  awaited hook.
- Context7 `/nodemailer/nodemailer-homepage` — createTransport/sendMail/ethereal.
- `apps/web/tailwind.config.js` — brand palette hexes.
- `docs/audit.md` §12 (Phase 1a), §11 (P0a/P0b). Prior: `927d61b` (Commit 3).

---

## §9 — Carry-forward methodology

- **CF-9** — 4.1 pause summary: full email module, auth.ts diff, the operator-gated
  real-send report (Message-ID, Authentication-Results, verified flip), failure
  case, all gates, CI run.
- **CF-10** — floor re-confirmed plan-time (§0).
- **CF-18** — swept clean (§0).
- **CF-21 — sixth instance** (SMTP_* shim across vitest/error-handler/env.test/ci).
- **CF-22 — seventh instance.** F1 (ethereal-vs-CI) and F2 (hook-must-not-throw,
  a Commit-3↔Commit-4 interaction) are locked-intent-vs-reality conflicts surfaced
  for ratification.
- **CF-23 — fourth worked instance.** Context7 (nodemailer) + installed source
  (better-auth hook) again caught real issues (ethereal network, sendMail-throws,
  no-bundled-types). Two-layer discipline continues: the F2 interaction will be
  re-confirmed at execution (Gate 5 failure case).

All three (CF-21/22/23) promote at the **Phase 1b audit refresh** after this commit.

---

## §10 — Push policy + sequencing

**4.0** — `git add` plan; `docs(phase-1b): plan Commit 4 — SMTP email send`;
push; `gh run watch` (CF-6). Node 20.

**4.1** — `git add apps/api .github pnpm-lock.yaml`; commit (body: EmailSender +
SmtpEmailSender + template + the ratified F1/F2 + CF movement); push; `gh run
watch` (CF-7). Node 20. No `Co-Authored-By`.

---

## §11 — Exact file contents (Commit 4.1)

> Recommended F1–F6 resolutions. Adjusts to architect rulings before code.

### `apps/api/src/email/sender.ts` (new)
```ts
export type SendResult = { messageId: string } | { error: string };

export interface EmailSender {
  send(params: { to: string; subject: string; html: string; text?: string }): Promise<SendResult>;
}
```

### `apps/api/src/email/smtp-sender.ts` (new)
```ts
import nodemailer from 'nodemailer';

import type { Env } from '../env.js';
import { logger } from '../logger.js';
import type { EmailSender, SendResult } from './sender.js';

// Per-send transport (no pool — slice-1 volume; Decision 2). send() NEVER throws
// (F2): returns a result union so the better-auth hook can't fail signup.
export class SmtpEmailSender implements EmailSender {
  private readonly from: string;
  private readonly transportConfig: nodemailer.TransportOptions;

  constructor(env: Env) {
    this.from = `"Toodooh" <${env.SMTP_FROM}>`;
    this.transportConfig = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    } as nodemailer.TransportOptions;
  }

  async send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<SendResult> {
    try {
      const transporter = nodemailer.createTransport(this.transportConfig);
      const info = await transporter.sendMail({ from: this.from, ...params });
      return { messageId: info.messageId };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown SMTP error';
      logger.error({ to: params.to, error }, 'SMTP send failed');
      return { error };
    }
  }
}
```

### `apps/api/src/email/template.ts` (new — French, inline CSS, brand hexes)
```ts
interface VerificationEmailParams {
  name: string;
  verificationUrl: string;
}

export const verificationEmailSubject = 'Vérifiez votre adresse email Toodooh';

export const verificationEmailTemplate = ({ name, verificationUrl }: VerificationEmailParams): string => `
<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#204B43;">
  <div style="background:#204B43;padding:24px;text-align:center;">
    <span style="color:#76E6AB;font-size:24px;font-weight:bold;">Toodooh</span>
  </div>
  <div style="padding:32px 24px;">
    <p>Bonjour ${name},</p>
    <p>Merci de votre inscription. Confirmez votre adresse email pour activer votre compte&nbsp;:</p>
    <p style="text-align:center;margin:32px 0;">
      <a href="${verificationUrl}" style="background:#76E6AB;color:#204B43;text-decoration:none;
        padding:14px 28px;border-radius:6px;font-weight:bold;display:inline-block;">
        Vérifier mon adresse email
      </a>
    </p>
    <p style="font-size:13px;color:#555;">Ou copiez ce lien dans votre navigateur&nbsp;:<br>
      <a href="${verificationUrl}" style="color:#9195F8;word-break:break-all;">${verificationUrl}</a></p>
    <p style="font-size:13px;color:#555;">Vous n'avez pas créé de compte&nbsp;? Ignorez cet email.</p>
    <p style="font-size:13px;color:#555;">Si vous ne voyez pas cet email, vérifiez votre dossier spam.</p>
  </div>
  <div style="background:#f4f4f4;padding:16px;text-align:center;font-size:12px;color:#888;">
    © Toodooh
  </div>
</div>`;

export const verificationEmailPlainText = ({ name, verificationUrl }: VerificationEmailParams): string =>
  `Bonjour ${name},

Merci de votre inscription. Confirmez votre adresse email pour activer votre compte :

${verificationUrl}

Vous n'avez pas créé de compte ? Ignorez cet email.
Si vous ne voyez pas cet email, vérifiez votre dossier spam.

© Toodooh`;
```

### `apps/api/src/auth/auth.ts` (modify — hook = real send, never throws)
```ts
import { SmtpEmailSender } from '../email/smtp-sender.js';
import {
  verificationEmailPlainText,
  verificationEmailSubject,
  verificationEmailTemplate,
} from '../email/template.js';
// …
export const emailSender = new SmtpEmailSender(env); // exported for test spying

// replaces sendVerificationEmailStub. NEVER throws (F2) — a throw would make
// signUpEmail fail and Commit-3's orphan rollback delete the new user.
const sendVerificationEmail = async ({
  user,
  url,
}: {
  user: { id: string; email: string; name?: string };
  url: string;
  token: string;
}): Promise<void> => {
  try {
    const result = await emailSender.send({
      to: user.email,
      subject: verificationEmailSubject,
      html: verificationEmailTemplate({ name: user.name ?? '', verificationUrl: url }),
      text: verificationEmailPlainText({ name: user.name ?? '', verificationUrl: url }),
    });
    if ('error' in result) {
      logger.error({ to: user.email, error: result.error }, 'verification email failed');
    } else {
      logger.info({ to: user.email, messageId: result.messageId }, 'verification email sent');
    }
  } catch (err) {
    logger.error({ to: user.email, err }, 'verification email threw (swallowed)');
  }
};
// betterAuth({ … emailVerification: { sendOnSignUp: true, sendVerificationEmail } … })
```
(The Commit-2 `sendVerificationEmailStub` export is removed; `auth.test.ts`'s
stub test is replaced by `email.test.ts` coverage.)

### `apps/api/src/env.ts` (add to the zod object)
```ts
  SMTP_HOST: z.string().default('smtp.mail.ovh.net'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.stringbool().default(true),
  SMTP_USER: z.email(),
  SMTP_PASSWORD: z.string().min(8),
  SMTP_FROM: z.email(),
```

### `apps/api/.env.example` (add)
```
SMTP_HOST=smtp.mail.ovh.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@too-dooh.com
SMTP_PASSWORD=<from-password-manager>
SMTP_FROM=no-reply@too-dooh.com
```

### `apps/api/package.json`
```json
"dependencies": { "nodemailer": "8.0.7", … },
"devDependencies": { "@types/nodemailer": "8.0.0", … }
```

### `apps/api/tests/email.test.ts` (new — nodemailer mocked, ~5 tests)
```ts
// vi.mock('nodemailer') → createTransport returns { sendMail: vi.fn() }.
// 1. SmtpEmailSender.send → success returns { messageId } (sendMail resolves)
// 2. SmtpEmailSender.send → sendMail rejects → returns { error }, never throws
// 3. createTransport called with host/port/secure/auth from env
// 4. verificationEmailTemplate renders name + URL (HTML contains the href + brand)
// 5. verificationEmailPlainText renders name + URL (no HTML tags)
```

### `apps/api/tests/signup.test.ts` (modify)
```ts
// Top: vi.mock('nodemailer') so no real SMTP in the integration suite.
// Update test 3: assert emailSender.send was called (spy) OR the "verification
//   email sent" log fired (vi.waitFor), with to=user email.
// Add test: emailSender.send rejects/returns error → signup STILL 201, user row
//   present (F2/Decision 8 — orphan rollback does NOT fire).
```

### `apps/api/vitest.config.ts` / `error-handler.test.ts` / `env.test.ts` (CF-21)
```ts
// vitest.config: SMTP_USER/PASSWORD/FROM via process.env ?? fakes
//   (SMTP_USER 'ci@too-dooh.com', SMTP_PASSWORD 'ci-smtp-password', SMTP_FROM 'no-reply@too-dooh.com')
// error-handler.test.ts: same three in the inline Env literal
// env.test.ts: add the three to parseEnv success cases + 1 test: missing SMTP_USER → throws /SMTP_USER/
```

### `.github/workflows/ci.yml` (add to job `env`)
```yaml
      SMTP_USER: ci@too-dooh.com
      SMTP_PASSWORD: ci-smtp-password
      SMTP_FROM: no-reply@too-dooh.com
```

---

## §12 — Fire instruction

This is **Commit 4.0** (plan). Architect: ratify the micro-decisions; on approval,
commit + push docs-only. **Halt** until then.

**Micro-decisions for ratification (CF-22 surface, prose — no AskUserQuestion):**

- **Q1 — mock nodemailer in tests; ethereal local-only.** ethereal's
  `createTestAccount()` is a network call → fails the no-network CI gate.
  *Recommend yes (overrides Decision 6's ethereal-for-unit-tests).*
- **Q2 (CRITICAL, interaction) — the verification hook never throws;
  `EmailSender.send` returns `{messageId}|{error}`.** Else an email outage trips
  Commit-3's orphan rollback and **deletes the user**. *Recommend yes (this is the
  correct mechanism for Decision 8).*
- **Q3 — drop `SMTP_TEST_MODE`.** With mocked tests + real-creds local boot, the
  flag (Decision 6) is unneeded; ethereal stays a documented manual option.
  *Recommend drop.*
- **Q4 — `nodemailer@8.0.7` + `@types/nodemailer@8.0.0`** (no bundled types).
  *Recommend (exact-pin).*
- **Q5 — env coercion:** `SMTP_SECURE z.stringbool()` (verified), `SMTP_PORT
  z.coerce.number()`; HOST/PORT/SECURE default, USER/PASSWORD/FROM required.
  *Recommend.*
- **Q6 — CF-21 sixth instance:** SMTP_USER/PASSWORD/FROM fakes into vitest.config
  + error-handler.test + env.test + ci.yml. *Acknowledge.*

Plus acknowledge: **From** = `"Toodooh" <${SMTP_FROM}>` (display name hardcoded,
Decision 9); count lift apps/api 32 → 38 / root 192 → 198; **4.1's real-send is
operator-gated** (needs Ben's OVH creds + inbox + ~10 min availability); nodemailer
source re-verified at install. CF-21 sixth + CF-22 seventh + CF-23 fourth worked
instance (§9) — all promote at the Phase 1b audit refresh after this commit.
