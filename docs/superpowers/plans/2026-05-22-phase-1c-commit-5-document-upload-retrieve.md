# Phase 1c Commit 5 — document upload + retrieve (POST + GET /api/profile/documents/:type) — the StorageProvider consumer

The last feature commit of Phase 1c: RNE/CIN document upload + retrieve. First endpoint to
**consume** the Commit-2 StorageProvider, first **multipart** endpoint (adds `@fastify/multipart`),
first **new-dependency** commit since the API stood up (lockfile in the same commit — the `249fc87`
guard). Reuses the Commit-3 `requireAuth` guard (proven across 7 endpoints in Commits 3-4).

Per the Commit-2 decision: the columns (`registration_doc_url`, `cin_doc_url`, shipped Commit 1)
hold the object **KEY** (`rne/<userId>` | `cin/<userId>`), not a presigned URL — presigned URLs
expire. Upload stores the key; retrieve presigns on demand. The `_url` column names are cosmetically
wrong (they hold keys); a code comment notes it — **not** worth a rename migration.

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `ed8d273` (Commit 4 — profile contact/address/
notifications). CI-green. Floor: apps/api **88** / root **248**; root typecheck 51 / lint 1 / build
139.80; apps/api typecheck 0 / lint 0 / build ok.

**CF-18 sweep.** No `@fastify/multipart` in `package.json` or `node_modules`. No
`routes/profile-documents.ts`. No multipart registration in `server.ts`. The columns
`registrationDocUrl`/`cinDocUrl` exist (schema.ts:75-76, Commit 1). The `storage` singleton +
`StorageProvider` exist (Commit 2). CI already runs **both** Postgres + MinIO services.

**Node 20 PATH prefix** on every gate + git command; heap bump on commit. The apps/api suite is
**serialized** (`fileParallelism:false`, Commit 3) — the new document suite inherits it (writes
`users`). Running the suite locally needs the full env block ([[local-migrate-needs-full-env-block]]).

---

## §1 — Locked constraints (architect)

1. **One concept, type discriminator.** Upload + retrieve for `rne|cin`, same code path; the type
   selects the column + key prefix.
2. **`@fastify/multipart`** — new dep, exact-pinned (CF-19); lockfile in the **same** 5.1 commit.
3. **File validation:** MIME allowlist `{application/pdf, image/jpeg, image/png}`, size cap (M3 —
   verified FE value); enforced at TWO layers (framework `limits.fileSize` = the real guard; a
   defensive check). Oversize → **413**; bad MIME → **400**.
4. **Include the GET/retrieve** — presign the stored key, own-documents-only, `{ url }` JSON, 404 if
   none.
5. **Key format** `rne/<userId>` | `cin/<userId>`. One doc per type per user; re-upload
   **overwrites** (PutObject default).
6. **Auth + ownership:** both endpoints `requireAuth`; always `request.user.id`'s own documents —
   userId is **never** in the request, type is.
7. **Upload ordering:** parse → drain/validate → `storage.upload(key, buffer, contentType)` → on
   `{key}` success **update the column**; on `{error}` **do NOT** touch the column (no orphan key
   reference) → 502. `StorageProvider.upload` returns shaped `{key}|{error}` (Commit 2) — handle the
   `{error}` branch.

**Out of scope:** logo/`company_logo` upload (owner slice), `bank_doc` (money-adjacent slice),
multipart for non-document fields, presigned-PUT/client-direct upload, virus/magic-byte sniffing,
document DELETE (re-upload overwrites), image processing, admin review (Phase 1f), frontend
(Phase 1e), audit refresh (Commit 6).

---

## §2 — Inventory & CF-23 verification (verified against installed source + npm)

### §2.1 — `@fastify/multipart` version + buffer/limit API (load-bearing #1)
- **Pin `10.0.0`** (latest, published 2026-04-07). v9.4.0 and v10.0.0 both target **Fastify 5**
  (`fastify-plugin: ^5`, dev-peer `fastify: ^5`); our fastify is **5.8.5** ✓. **No `engines.node`
  restriction** (Node 20.20.2 fine). Transitives are light + all @fastify-family: `@fastify/busboy
  ^3`, `@fastify/deepmerge ^3`, `@fastify/error ^4`, `fastify-plugin ^5`, `secure-json-parse ^4` —
  no heavy/unexpected pulls (no hard-halt). Exact-pinnable (CF-19).
- **API:** register `app.register(multipart, { limits: { fileSize, files: 1, fields: 0 } })`. Read
  the single file via `const data = await request.file()` → `{ filename, mimetype, file (stream),
  toBuffer() }`. `await data.toBuffer()` yields the **Buffer** for `StorageProvider.upload`. With
  `throwFileSizeLimit` (default true), `toBuffer()` **throws** on oversize (busboy stops at the
  limit — never fully buffers); `data.file.truncated` is the belt-and-suspenders flag. Registered
  **inside** the document-routes plugin (it's `fastify-plugin`-wrapped, skip-override → decorates
  that plugin's context) so the routes — and their tests — self-contain the multipart dep (no
  server.ts change, no test-side re-registration). **M4.**

### §2.2 — Frontend document upload shape (load-bearing #2, CF-23)
The frontend has **no API-level document upload** — it writes **Supabase storage directly**
(`registres` bucket) and picks the column by `isIndividualOwner`, with **no `type` field**:
- **Signup** (`SignUpForm.tsx`): `accept=".pdf,.jpg,.jpeg,.png"`, "Max 5 MB",
  `if (file.size > 5 * 1024 * 1024)` (lines 1611/1622, 1814/1824); uploads `cin_<uid>`/`rne_<uid>`.
- **Owner-settings** (`useOwnerProfileMutations.ts` `uploadDocument`): branches `isIndividualOwner`
  → `cin_<uid>` (writes `cin_doc_url`) vs `rne_<uid>` (writes `registration_doc_path` +
  `registration_doc_url`); `OwnerSettings.tsx` `accept=".pdf,.jpg,.jpeg,.png"`, 5 MB cap.

**Finding (CF-23):** there is **no existing API wire** to match — the endpoint is greenfield.
The type is **implicit** in `isIndividualOwner`; the upload is direct-to-Supabase. So the Phase-1e
repoint must (a) add a `type` discriminator and (b) switch from `supabase.storage` to the API. This
**removes the "match the frontend's separate-upload shape" concern** — one endpoint + discriminator
is clean. **Verified constraints: MIME `{application/pdf, image/jpeg, image/png}`** (`.jpg`+`.jpeg`
→ `image/jpeg`), **size cap 5 MB** (consistent across both surfaces).

### §2.3 — size cap: 5 MB (M3 — corrects the architect's estimate)
The architect's Decision 3 said "~10MB"; the **verified** FE cap is **5 MB** (both surfaces). CF-24
says match-or-slightly-more-permissive. *Recommend matching **5 MB*** — there's no reason to accept
larger than the FE ever sends, and matching avoids a divergence. `MAX_FILE_BYTES = 5 * 1024 * 1024`.

### §2.4 — StorageProvider signatures (confirmed, provider.ts)
```ts
upload(params: { key: string; body: Buffer; contentType: string }): Promise<{ key } | { error }>;
getPresignedUrl(params: { key: string; expiresInSeconds?: number }): Promise<{ url } | { error }>;
```
`storage` singleton exported from `storage/s3-storage.js` (`:109`). `getPresignedUrl` default expiry
**3600s** (`s3-storage.ts:85`) — the GET uses the default (M6 lean 3600). PutObject overwrites by
default → re-upload semantics for free. Shaped results (not throws) → branch on `'error' in result`.

### §2.5 — `type` discriminator: PATH param, not a multipart field (M1 — literal-vs-spirit)
The architect's lean was a `type` **field**; the GET already uses `:type` in the **path**. Since the
FE has no existing wire (§2.2), I recommend **`POST /api/profile/documents/:type`** (type in the
path) for: symmetry with the GET, order-independence (a multipart `type` *field* must precede the
file in the body for busboy to expose it — fragile), and trivial dependency-free test construction
(the file is the sole part). This is a deviation from the literal "field" → surfaced for ratification
([[literal-vs-spirit-surface-and-ratify]]); the discriminator intent is unchanged.

### §2.6 — route file: SPLIT into `routes/profile-documents.ts` (M2)
`profile.ts` is 234 lines. The document endpoints need a `multipart` registration + the storage dep
+ a distinct concern (binary I/O vs JSON field-edits). *Recommend a **split*** into
`routes/profile-documents.ts` (multipart registered inside it), registered in `routes/index.ts`
alongside `profileRoutes`. Keeps `profile.ts` focused/unchanged and self-contains multipart for clean
test isolation. (A merge would also pull multipart into the field-edit endpoints' scope — avoidable.)

### §2.7 — status codes (M5)
Bad/missing type → **400**; missing file → **400**; bad MIME → **400** (not 415 — consistent with
the other endpoints' 400s, Decision 3 lean); oversize → **413** (semantically correct, Decision 3);
storage `{error}` → **502** (upstream storage failure; Decision 7 lean over 500); GET no-column →
**404**. The app error-handler honors `err.statusCode`, but we return **shaped** responses inline
(deterministic in the handler-only test apps, which set no custom error handler).

### §2.8 — multipart test construction (M7, confirmed)
`form-data` is **not** installed and the global `FormData` isn't consumable by `app.inject`. Build
the body **dependency-free** as a Buffer (boundary + one `file` part) and pass `payload` +
`content-type` header to `inject`. GET round-trips verified via global `fetch` of the presigned URL
(the `storage.integration.test.ts` pattern). Needs **both** Postgres + MinIO → its own test file;
serialized suite inherited.

### §2.9 — CF-21 / CF-22
- **CF-21:** `@fastify/multipart` needs **no new env var** (STORAGE_* exist from Commit 2; the size
  limit is a code constant). No CF-21 cascade — `.env.example` + `env.ts` untouched. CI already runs
  both services → **no `ci.yml` change** (confirm at 5.1).
- **CF-22 watch:** M1 (path-param vs field) and M3 (5 MB vs the architect's ~10MB estimate) are the
  two surfaced decisions; both lean to the verified/cleaner option.

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **5.0** | Plan (this file). Halt; surface M1–M7; ratify; commit + push (CF-6). |
| **5.1** | `profile-documents.ts` + `routes/index.ts` + `package.json` + `pnpm-lock.yaml` + `profile-documents.test.ts`. Halt; CF-9 (incl. live both-services round-trip + frozen-lockfile); ratify; push (CF-7). |

5.1 judgment seams: the multipart drain/validate/limit handling; the storage-error→no-column-update
ordering. The rest is mechanical (the GET, the column map).

---

## §4 — Per-commit verification gates

### Gate 2 — apps/api per-package
```
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # ~101 (needs Postgres + MinIO)
pnpm --filter @toodooh/api build       # ok
```

### Gate 3 — root no-regression vs `ed8d273`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 248 | **~261** (+~13) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 3b — lockfile (new dep)
`pnpm-lock.yaml` **changes** (adds `@fastify/multipart@10.0.0` + transitives). `pnpm install
--frozen-lockfile` must pass locally AND in CI. `git add` MUST include the lockfile (the `249fc87`
guard).

### Gate 4 — live (real Postgres + real MinIO)
- POST rne + cin → keys stored in the right columns, objects in MinIO (presign succeeds).
- GET → `{ url }` fetches the **right bytes**; re-upload → GET fetches the **new** bytes (overwrite).
- Oversize (5 MB + 1) → **413**, column **not** written; bad MIME (`text/plain`) → **400**; invalid
  type → **400**.
- `storage.upload` mocked `{error}` → **502**, column **not** updated.
- Unauthenticated POST → **401**, GET → **401**.

### Gate 5 — CI green (Postgres + MinIO services already present; no CI change).

---

## §5 — Standing operating procedure
CF-6 for 5.0; CF-7 for 5.1. Node-20 prefix; heap bump. CF-18 re-sweep before first Write.
**New dep** → run the dependency→lockfile check; `git add` the lockfile in the SAME 5.1 commit.

---

## §6 — Hard-halt conditions
1. `@fastify/multipart` buffer/limit API differs from §2.1 (can't get a Buffer or enforce the limit
   at registration) — **not expected** (API confirmed). 
2. FE upload shape unrecoverable / materially different — **RESOLVED §2.2** (greenfield; no halt).
3. StorageProvider signature differs from §2.4 — **RESOLVED** (confirmed against provider.ts).
4. Multipart requests can't be constructed in inject — **RESOLVED §2.8** (dependency-free Buffer).
5. Any gate regresses vs `ed8d273`.
6. The dep pulls heavy transitives or isn't exact-pinnable — **RESOLVED §2.1** (light @fastify deps).

---

## §7 — Risk register
| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| oversize not rejected cleanly | Medium | Gate 4 / 413 test | `limits.fileSize` + `toBuffer()` throw-catch → 413 + `truncated` check |
| stream not drained on reject → hang | Low | Gate 4 | `toBuffer()` (drains) BEFORE MIME validation |
| storage error leaves orphan column | Low | Gate 4 / mock test | update column ONLY in the `{key}` branch |
| multipart-in-plugin scope wrong | Low | Gate 4 / 401 + upload tests | fp skip-override decorates the plugin ctx; test registers only the plugin |
| lockfile dropped from commit | Low | frozen-lockfile (local+CI) | §5 dep→lockfile check; §10 file list |
| presigned URL host unfetchable in test | Low | Gate 4 GET test | localhost:9000 (proven by storage.integration.test.ts) |

---

## §8 — Cross-references
- `storage/provider.ts` + `storage/s3-storage.ts` (the interface + `storage` singleton + 3600
  default), `tests/storage.integration.test.ts` (the presign→fetch→bytes pattern),
  `middleware/require-auth.ts`, `routes/profile.ts` + `routes/index.ts` (registration style),
  `error-handler.ts` (honors `err.statusCode`), `db/schema.ts:75-76` (`registrationDocUrl`/
  `cinDocUrl`).
- Commit-2 plan §11 (key-not-URL decision, lines 42-43), `frontend-backend-contract.md` §3.1/§3.9
  (the RNE/CIN upload surfaces), §7.
- `.github/workflows/ci.yml` (Postgres + MinIO services already present).

---

## §9 — Carry-forward methodology
- **CF-9** — 5.1 pause: full file contents + lockfile-in-commit + Gate-4 both-services round-trip
  (upload/GET/overwrite/413/400/502/401) + frozen-lockfile pass + count reconciliation.
- **CF-10** floor re-confirmed (§0). **CF-18** swept (§0). **CF-19** exact-pin `10.0.0`.
- **CF-21** — no new env var; no cascade (confirmed §2.9).
- **CF-22** — M1 (path-param discriminator, literal-vs-spirit) + M3 (5 MB corrects the estimate).
- **CF-23** — multipart API, FE upload shape/limits, StorageProvider + getPresignedUrl signatures
  all verified at plan-write; the live both-services round-trip is the execution-time layer.
- **CF-24** — greenfield endpoint (no FE wire to match); Phase-1e repoint adds `type` + swaps
  Supabase-storage → this API. Tracked as a Phase-1e carry-forward.

---

## §10 — Push policy + sequencing
**5.0** — `git add` plan; `docs(phase-1c): plan Commit 5 — document upload/retrieve`; push;
`gh run watch` (CF-6). Node 20.
**5.1** — `git add apps/api pnpm-lock.yaml`; `feat(api): POST+GET /api/profile/documents/:type
(RNE/CIN upload+retrieve via StorageProvider; @fastify/multipart)`; push; `gh run watch` (CF-7).
Node 20. No `Co-Authored-By`. **Lockfile in the commit** (dep→lockfile check first).

---

## §11 — Exact file contents (Commit 5.1)

### `apps/api/src/routes/profile-documents.ts` (new)
```ts
import multipart from '@fastify/multipart';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

// RNE (company registry) → registration_doc_url; CIN (individual ID) → cin_doc_url. The columns
// hold the STORAGE KEY (`rne/<userId>` | `cin/<userId>`), NOT a presigned URL — presigned URLs
// expire (Commit-2 decision). The "_url" column names are cosmetically wrong (they hold keys);
// not worth a rename migration.
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — matches the frontend cap (signup + owner-settings)
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const typeParamSchema = z.object({ type: z.enum(['rne', 'cin']) });

export const profileDocumentsRoutes: FastifyPluginAsync = async (app) => {
  // Framework-level guard: busboy stops at fileSize, so an oversized upload is never fully
  // buffered. Registered inside this plugin (fastify-plugin skip-override → decorates this
  // context) so the routes + their tests self-contain the multipart dependency.
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0 },
  });

  // POST /api/profile/documents/:type — single-file multipart upload. type in the PATH
  // (symmetric with the GET; order-independent vs a multipart field). The column gets the key
  // ONLY on a genuine StorageProvider success (no orphan key references).
  app.post('/api/profile/documents/:type', { preHandler: requireAuth }, async (request, reply) => {
    const parsedParams = typeParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'type', reason: 'must be rne or cin' }],
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const { type } = parsedParams.data;

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'file', reason: 'a file is required' }],
      });
    }

    // Drain the stream (toBuffer) BEFORE MIME validation — avoids a hung request. The
    // fileSize limit makes toBuffer throw (throwFileSizeLimit default) on oversize → 413.
    let body: Buffer;
    try {
      body = await data.toBuffer();
    } catch {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds the ${MAX_FILE_BYTES}-byte limit.`,
      });
    }
    if (data.file.truncated) {
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds the ${MAX_FILE_BYTES}-byte limit.`,
      });
    }
    if (!ALLOWED_MIME.has(data.mimetype)) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'file', reason: `unsupported content type: ${data.mimetype}` }],
      });
    }

    const key = `${type}/${userId}`;
    const result = await storage.upload({ key, body, contentType: data.mimetype });
    if ('error' in result) {
      // Storage failed → do NOT touch the column. User retries; no orphan key reference.
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Document storage failed. Please retry.',
      });
    }

    await db
      .update(users)
      .set(type === 'rne' ? { registrationDocUrl: key } : { cinDocUrl: key })
      .where(eq(users.id, userId));

    return reply.status(200).send({ type, key });
  });

  // GET /api/profile/documents/:type — presign the stored key on demand (3600s default). 404
  // if the user has no document of that type. Own-documents-only (userId from the guard).
  app.get('/api/profile/documents/:type', { preHandler: requireAuth }, async (request, reply) => {
    const parsedParams = typeParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: [{ field: 'type', reason: 'must be rne or cin' }],
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const { type } = parsedParams.data;

    const [row] = await db
      .select({
        registrationDocUrl: users.registrationDocUrl,
        cinDocUrl: users.cinDocUrl,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const key = type === 'rne' ? row?.registrationDocUrl : row?.cinDocUrl;
    if (!key) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `No ${type} document on file.`,
      });
    }

    const result = await storage.getPresignedUrl({ key });
    if ('error' in result) {
      return reply.status(502).send({
        error: 'STORAGE_ERROR',
        message: 'Could not generate a document URL. Please retry.',
      });
    }
    return reply.status(200).send({ url: result.url });
  });
};
```

### `apps/api/src/routes/index.ts` — register
```ts
import { profileDocumentsRoutes } from './profile-documents.js';
// ...
  await app.register(profileRoutes);
  await app.register(profileDocumentsRoutes);
```

### `apps/api/package.json` — add dependency (exact pin)
```jsonc
"@fastify/multipart": "10.0.0",
```
Then `pnpm install` → **`pnpm-lock.yaml`** updated; both committed together.

### `apps/api/tests/profile-documents.test.ts` (new)
Integration (real Postgres + MinIO). Dependency-free multipart Buffer; GET round-trips via global
`fetch`. Own `afterAll(sql.end())` + per-test MinIO cleanup. Cases (~13):
- POST rne → 200, `key === rne/<uid>` in `registrationDocUrl`, object presignable in MinIO.
- POST cin → 200, key in `cinDocUrl`.
- GET rne → 200 `{ url }`; `fetch(url)` bytes equal the uploaded bytes.
- GET no-document → 404.
- re-upload rne → GET fetches the **new** bytes (overwrite at same key).
- oversize (5 MB + 1) → 413, column **not** written.
- bad MIME (`text/plain`) → 400.
- invalid type (`/passport`) → 400.
- `storage.upload` spied `{error}` → 502, column **not** updated.
- unauthenticated POST → 401; unauthenticated GET → 401.

```ts
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { profileDocumentsRoutes } from '../src/routes/profile-documents.js';
import { storage } from '../src/storage/s3-storage.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'pending' },
  } as unknown as GetSessionResult);
};

// Dependency-free multipart body (form-data not installed; web FormData isn't consumable by
// inject). Single `file` part — the `type` rides in the URL path.
const multipartBody = (file: { filename: string; contentType: string; content: Buffer }) => {
  const boundary = `----toodoohtest${Date.now()}${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file.content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
};

describe('POST/GET /api/profile/documents/:type (real Postgres + MinIO)', () => {
  let app: ReturnType<typeof buildApp>;
  let userId: string;

  beforeEach(async () => {
    await resetAuthTables();
    const [u] = await db
      .insert(users)
      .values({ email: 'doc@example.com', contactName: 'Doc Owner' })
      .returning();
    userId = u?.id ?? '';
    app = buildApp();
    await app.register(profileDocumentsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await storage.delete({ key: `rne/${userId}` }).catch(() => undefined);
    await storage.delete({ key: `cin/${userId}` }).catch(() => undefined);
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const pdf = Buffer.from('%PDF-1.4 fake rne bytes');
  const post = (type: string, body: ReturnType<typeof multipartBody>) =>
    app.inject({ method: 'POST', url: `/api/profile/documents/${type}`, ...body });
  const get = (type: string) => app.inject({ method: 'GET', url: `/api/profile/documents/${type}` });

  it('POST rne → 200, key stored, object in MinIO', async () => {
    mockSession(userId);
    const res = await post(
      'rne',
      multipartBody({ filename: 'rne.pdf', contentType: 'application/pdf', content: pdf }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<{ key: string }>().key).toBe(`rne/${userId}`);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.registrationDocUrl).toBe(`rne/${userId}`);
    expect('url' in (await storage.getPresignedUrl({ key: `rne/${userId}` }))).toBe(true);
  });

  it('POST cin → 200, key in cin_doc_url', async () => {
    mockSession(userId);
    const res = await post(
      'cin',
      multipartBody({ filename: 'cin.png', contentType: 'image/png', content: pdf }),
    );
    expect(res.statusCode).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.cinDocUrl).toBe(`cin/${userId}`);
  });

  it('GET rne → 200 { url } fetching the uploaded bytes', async () => {
    mockSession(userId);
    await post('rne', multipartBody({ filename: 'rne.pdf', contentType: 'application/pdf', content: pdf }));
    const res = await get('rne');
    expect(res.statusCode).toBe(200);
    const fetched = Buffer.from(await (await fetch(res.json<{ url: string }>().url)).arrayBuffer());
    expect(fetched.equals(pdf)).toBe(true);
  });

  it('GET with no document → 404', async () => {
    mockSession(userId);
    expect((await get('cin')).statusCode).toBe(404);
  });

  it('re-upload rne overwrites (same key, new bytes)', async () => {
    mockSession(userId);
    await post('rne', multipartBody({ filename: 'a.pdf', contentType: 'application/pdf', content: pdf }));
    const v2 = Buffer.from('%PDF-1.4 SECOND version');
    await post('rne', multipartBody({ filename: 'b.pdf', contentType: 'application/pdf', content: v2 }));
    const fetched = Buffer.from(
      await (await fetch((await get('rne')).json<{ url: string }>().url)).arrayBuffer(),
    );
    expect(fetched.equals(v2)).toBe(true);
  });

  it('oversized → 413, column not written', async () => {
    mockSession(userId);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const res = await post('rne', multipartBody({ filename: 'big.pdf', contentType: 'application/pdf', content: big }));
    expect(res.statusCode).toBe(413);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.registrationDocUrl).toBeNull();
  });

  it('bad MIME → 400', async () => {
    mockSession(userId);
    const res = await post('rne', multipartBody({ filename: 'x.txt', contentType: 'text/plain', content: Buffer.from('hi') }));
    expect(res.statusCode).toBe(400);
  });

  it('invalid type → 400', async () => {
    mockSession(userId);
    const res = await post('passport', multipartBody({ filename: 'x.pdf', contentType: 'application/pdf', content: pdf }));
    expect(res.statusCode).toBe(400);
  });

  it('StorageProvider failure → 502, column not updated', async () => {
    mockSession(userId);
    vi.spyOn(storage, 'upload').mockResolvedValue({ error: 'disk full' });
    const res = await post('rne', multipartBody({ filename: 'rne.pdf', contentType: 'application/pdf', content: pdf }));
    expect(res.statusCode).toBe(502);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row?.registrationDocUrl).toBeNull();
  });

  it('unauthenticated POST → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    const res = await post('rne', multipartBody({ filename: 'rne.pdf', contentType: 'application/pdf', content: pdf }));
    expect(res.statusCode).toBe(401);
  });

  it('unauthenticated GET → 401', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null);
    expect((await get('rne')).statusCode).toBe(401);
  });
});
```

**Test delta: apps/api 88 → ~101 (+~13).** `.env.example` + `ci.yml` **unchanged** (confirm at 5.1).

---

## §12 — Fire instruction

This is **Commit 5.0** (plan). Architect: ratify M1–M7; on approval, commit + push docs-only.
**Halt** until then.

- **M1 — `type` as PATH param** (`POST /api/profile/documents/:type`), not a multipart field —
  symmetric with the GET, order-independent, dependency-free to test; the FE has no existing wire
  (§2.2) so nothing to match. *Recommend (literal-vs-spirit deviation from "type field").*
- **M2 — SPLIT** into `routes/profile-documents.ts` (multipart registered inside it). *Recommend.*
- **M3 — size cap 5 MB** (verified FE value, both surfaces), correcting the architect's "~10MB"
  estimate. *Recommend matching 5 MB.*
- **M4 — `@fastify/multipart@10.0.0`** (Fastify-5, Node-20-ok, light @fastify transitives,
  exact-pinned); `request.file()` + `toBuffer()`; `limits.fileSize` framework guard. *Recommend.*
- **M5 — status codes:** bad type/file/MIME → 400, oversize → 413, storage `{error}` → 502, GET
  no-column → 404. *Recommend.*
- **M6 — GET returns `{ url }`** JSON, 3600s presign default. *Recommend.*
- **M7 — dependency-free multipart test body** (Buffer) + `fetch` round-trips; both-services suite.
  *Recommend.*

Plus acknowledge: lockfile in the SAME 5.1 commit (dep→lockfile check, the `249fc87` guard); no new
env var / no CI change (§2.9); profile.ts unchanged (234 lines); count lift apps/api 88→~101 / root
248→~261; CF-21/22/23/24 in §9; the Phase-1e carry-forward (FE adds `type` + swaps Supabase-storage
→ this API).
