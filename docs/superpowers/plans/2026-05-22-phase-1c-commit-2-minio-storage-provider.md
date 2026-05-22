# Phase 1c Commit 2 — MinIO container + StorageProvider abstraction + S3-compatible client

Storage infrastructure-before-use, mirroring how Phase 1a stood up Drizzle/Postgres before
Phase 1b consumed it, and the EmailSender abstraction (Phase 1b Commit 4) it copies in shape.
A self-hosted MinIO container next to Postgres; an AWS-SDK-v3 S3 client; a `StorageProvider`
interface + `S3Storage` implementation with shaped-result returns. **Commit 3** (the reframed
update-business-profile endpoint, audit §7.1) consumes it to store RNE/CIN documents — **no
endpoint touches it this commit.**

This commit does **not** touch any frontend contract — the audit (`frontend-backend-contract.md`)
and the Model-1→Option-B reversal don't bear on it. Pure backend infrastructure.

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `9e9d716` (Commit 1.1 — onboarding columns +
reference tables), CI-green.

**Baseline floor (CF-10).** root typecheck **51** / lint **1** / test **206** (160 web + 46
api) / build apps/web **139.80 kB**. apps/api 0 / 0 / 46 / build ok.

**CF-18 sweep.** No `apps/api/src/storage/`. No `minio` service in `infra/docker-compose.yml`.
No `STORAGE_*` in `env.ts`. No `@aws-sdk/*` in `apps/api/package.json`.

**Node 20 PATH prefix** on every gate + git command; heap bump on commit.

---

## §1 — Locked constraints (architect)

1. **AWS SDK v3, not the `minio` npm package** — `@aws-sdk/client-s3` +
   `@aws-sdk/s3-request-presigner`. S3-generic, so MinIO→R2→S3 is a config change, not a code
   change (the EmailSender→Resend optionality analog).
2. **`StorageProvider` mirrors `EmailSender`** — shaped results, not throws (`{ key } | { error }`
   etc.). **Honest distinction:** this is NOT EmailSender's safety-critical never-throw (that
   existed because a throw cascaded to Commit-3 orphan-rollback). Storage has no such cascade —
   a failed upload during a profile edit just means the edit didn't complete; the user retries.
   Shaped-result here is an ergonomics/consistency choice.
3. **`forcePathStyle: true` is MANDATORY** (CF-23 gotcha) — verified §2.
4. **Documents stored PRIVATELY; access via presigned GET only.** Bucket is not public-read.
5. **DB columns hold the KEY, not a URL** (Commit-3 concern, shapes `getPresignedUrl(key)`).
   `registration_doc_url`/`cin_doc_url` hold a stable key (`rne/<userId>`); presigned URLs are
   generated on demand. The `..._url` naming is legacy-cosmetic — a code comment, not a migration.
6. **Single bucket, key-prefixed by type** — `rne/<userId>`, `cin/<userId>`. Bucket name
   proposal: **`toodooh-documents`** (clean; NOT legacy `registres` — the old backend was
   deleted, no data to match). Surface Q1.
7. **Bucket ensure-on-init** — HeadBucket → on `NotFound`, CreateBucket. Idempotent. See §2.5
   for the sync-constructor nuance (memoized-lazy). Surface Q2.
8. **Singleton from env at module load**, like `emailSender` (`auth/auth.ts:16`).
9. **CI runs a REAL MinIO** (mirror the Postgres service, not the nodemailer mock) — the
   round-trip is tested for real. See §2.7 for the GHA-service-container resolution.

**Out of scope (do not include):** the upload endpoint, multipart parsing, file validation
(type/size/virus — the caller's job, Commit 3), storing keys into columns (Commit 3), presigned
PUT/client-direct upload, image/thumbnail/logo handling, public CDN/public-read, production
MinIO creds (Phase 1g), multi-bucket/lifecycle/versioning, frontend (Phase 1e).

---

## §2 — Inventory phase & CF-23 verification (verified at plan-write)

CF-23 two-layer: plan-write verification below (npm + Context7 `/aws/aws-sdk-js-v3` + a real
`docker pull/inspect/run`); execution-time verification is the 2.1 boot round-trip (§4 Gate 4).

### §2.1 — AWS SDK versions (npm view, verified)
- **`@aws-sdk/client-s3` = `3.1052.0`**, `engines.node >=20.0.0` ✓
- **`@aws-sdk/s3-request-presigner` = `3.1052.0`**, `engines.node >=20.0.0` ✓
- Presigner is a **separate package** (confirmed). Both exact-pinnable (CF-19). Released in
  lockstep — pin both at `3.1052.0`.
- **Transitive footprint:** the normal AWS-SDK-v3 modular set (`@smithy/*` + `@aws-sdk/*`
  sub-packages) — expected for `client-s3`, not "unexpected heavy". API-only deps; **not bundled
  into apps/web**, so the 139.80 kB web bundle is unaffected (only `apps/api` node_modules grows).

### §2.2 — `forcePathStyle` (Context7 `/aws/aws-sdk-js-v3`, verified)
Documented S3Client config (renamed from v2 `s3ForcePathStyle`): "controls whether to force path
style URLs for S3 objects." AWS SDK defaults to virtual-hosted-style (`bucket.endpoint`); MinIO
needs path-style (`endpoint/bucket`). Config shape (top-level):
```ts
new S3Client({
  endpoint: env.STORAGE_ENDPOINT,        // http://localhost:9000
  region: env.STORAGE_REGION,            // us-east-1 (SDK requires a region be set)
  credentials: { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY },
  forcePathStyle: true,
});
```
**Execution-time confirmation deferred to Gate 4** (real path-style round-trip vs MinIO).

### §2.3 — Command shapes (Context7, verified)
- `PutObjectCommand({ Bucket, Key, Body, ContentType })`
- `GetObjectCommand({ Bucket, Key })`
- `DeleteObjectCommand({ Bucket, Key })`
- `HeadBucketCommand({ Bucket })`, `CreateBucketCommand({ Bucket })`
- Client dispatch: `await client.send(command)`.

### §2.4 — `getSignedUrl` (Context7, verified)
```ts
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });
```
`expiresIn` is **seconds**, **defaults to 900** if omitted — our interface defaults **3600**.

### §2.5 — ensure-bucket (Context7, verified) + the sync-constructor nuance
`HeadBucketCommand` throws on a missing bucket with `error.name === 'NotFound'`; catch → `CreateBucketCommand`. **Nuance (→ Q2):** Decision 7 says "on instantiation," but constructors
can't be `async`, and an eager fire-in-constructor would do a network call at *module import*
(every test transitively importing `storage` would hit MinIO). **Recommend memoized-lazy**: the
constructor stays sync (builds the client only); a private `ensureBucket()` runs once on the
**first `upload`**, memoized via a `bucketReady` promise. No import-time network; faithful to the
intent (the bucket is ensured before first use). Surface Q2.

### §2.6 — MinIO image (docker pull/inspect, verified)
- Pin **`minio/minio:RELEASE.2025-09-07T16-13-09Z`** (digest
  `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`) — CF-19, date-based
  RELEASE tag.
- Server command: `server /data --console-address ":9001"`.
- Healthcheck endpoint: `GET /minio/health/live`. **`curl` IS present** in the image
  (`/usr/bin/curl`, verified) — compose healthcheck uses `curl -f`. (`wget` absent; `mc` present.)
- MinIO requires `MINIO_ROOT_USER` ≥ 3 chars, `MINIO_ROOT_PASSWORD` ≥ 8 chars.

### §2.7 — CI service-container resolution (the load-bearing item-7 finding)
**The official `minio/minio` image CANNOT be a plain GitHub Actions `services:` block.** Postgres
works as a service because the postgis image starts its server by default; `minio/minio` needs
the `server /data` **command**, and GHA `services:` syntax has **no `command:`/`args:` key** (only
`image`/`env`/`ports`/`options`/`volumes`/`credentials`; `options` passes `docker create` flags
like `--health-cmd`, not the command). **Resolution: a `docker run -d … server /data` step**
before the test step (keeps the architect-locked `minio/minio` image, full command control,
identical `localhost:9000` reachability), followed by a curl-based readiness wait. Alternative
considered + rejected: `bitnami/minio` as a service (starts the server by default) — rejected to
keep one image across compose + CI. **Resolved → docker-run step.** (See §11 ci.yml.)

### §2.8 — CF-21 cascade (the 5 STORAGE_* vars)
Required (no default): `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`.
Defaulted: `STORAGE_BUCKET` (`toodooh-documents`), `STORAGE_REGION` (`us-east-1`).
- **CF-21a (runtime shims, required-only):** `vitest.config.ts` `test.env` + `env.test.ts`
  parseEnv success cases — add the **3 required**.
- **CF-21b (type literals, all-5):** `error-handler.test.ts` (and any inline `Env` literal) — add
  **all 5** (TS enforces the full `Env` type regardless of runtime defaults).
- `ci.yml` job `env:` — add the 3 required (+ the docker-run `MINIO_ROOT_*` matching them).

### §2.9 — CF-22 watch
No architect lock conflicts with verified SDK behavior. The only literal-vs-reality item is
Q2 (ensure-on-instantiation → memoized-lazy), surfaced for ratification.

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **2.0** | Plan (this file). Halt; surface Q1–Q2; ratify; commit + push (CF-6). |
| **2.1** | docker-compose minio + provider.ts + s3-storage.ts + env.ts + .env.example + storage tests + vitest/env/error-handler CF-21 shims + package.json/lockfile + ci.yml. Halt; CF-9 (incl. real-MinIO boot round-trip + CI service); ratify; push (CF-7). |

2.1 is mostly mechanical (SDK wiring to a verified API) with one judgment seam (the ensure-bucket
lifecycle, Q2) and one infra seam (the CI docker-run step, §2.7 — resolved).

---

## §4 — Per-commit verification gates

### Gate 2 — apps/api per-package
```
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # 55 (needs Postgres + a real MinIO for the round-trip)
pnpm --filter @toodooh/api build       # ok
```

### Gate 3 — root no-regression vs `9e9d716`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 206 | **215** (+9) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 4 — boot verification (LOCAL, real MinIO)
```
docker compose -f infra/docker-compose.yml up -d           # postgres + minio
# .env with dev STORAGE_* (MinIO root creds)
# run storage.integration.test.ts (or a one-off script):
#  - instantiate S3Storage → ensureBucket created 'toodooh-documents'
#  - upload buffer → 'rne/test-user'
#  - getPresignedUrl(key) → fetch URL → bytes match  (proves forcePathStyle path-style works)
#  - delete(key) → presigned fetch now 404s
docker compose -f infra/docker-compose.yml down            # (keep -v optional)
```

### Gate 5 — CI: the `docker run` MinIO starts, readiness curl passes, the integration round-trip
connects + passes (no external network — MinIO is local to the runner, like Postgres).

---

## §5 — Standing operating procedure
CF-6 for 2.0; CF-7 for 2.1 (gate sweep → boot round-trip → CF-9 → ratify → push → CI). Node-20
prefix; heap bump. CF-18 re-sweep before first Write. **Dependency→lockfile (the `249fc87`
learning):** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` and `pnpm-lock.yaml` land in
the **same** 2.1 commit; the §10 file list is the guard; `git add` must include the lockfile.

---

## §6 — Hard-halt conditions
1. `forcePathStyle` round-trip fails / MinIO rejects the SDK's requests (Gate 4).
2. The CI docker-run MinIO can't start or isn't reachable from the test step.
3. `getSignedUrl` against MinIO yields URLs that don't resolve (endpoint/region signature
   mismatch — sign and fetch must use the same endpoint config).
4. Integration round-trip can't isolate (bucket/key state leaks between runs).
5. Any gate regresses vs `9e9d716`.
6. `@aws-sdk` packages aren't exact-pinnable or pull unexpected non-`@smithy`/`@aws-sdk` deps.

---

## §7 — Risk register
| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| forcePathStyle missing → confusing failures | **Resolved** §2.2 | Gate 4 | `forcePathStyle: true` locked + round-trip |
| MinIO can't be a GHA service | **Resolved** §2.7 | CI | docker-run step, not a service block |
| presigned URL signature mismatch | Medium | Gate 4 / CI | one endpoint config for sign + fetch |
| import-time network from eager ensure-bucket | Low | unit-test runs | memoized-lazy on first upload (Q2) |
| AWS SDK transitive bloat in web bundle | None | build gate | API-only deps; web bundle unaffected |
| lockfile dropped from the commit | Low | frozen-lockfile CI | §10 guard + dependency→lockfile check |

---

## §8 — Cross-references
- `apps/api/src/email/sender.ts` + `smtp-sender.ts` (the mirrored interface+impl+shaped-result).
- `auth/auth.ts:16` (`emailSender` singleton pattern).
- `infra/docker-compose.yml` (the postgres service to sit beside), `.github/workflows/ci.yml`
  (the postgres-service + job-`env:` pattern to mirror).
- `frontend-backend-contract.md` §3.1 (legacy `registres` bucket + `cin_`/`rne_`/`logo_`/`bank_`
  key prefixes — context only; we use a clean `toodooh-documents` bucket).
- `docs/audit.md` §13 (Phase 1b — EmailSender, CF-21 cascade, dependency→lockfile). Prior `9e9d716`.

---

## §9 — Carry-forward methodology
- **CF-9** — 2.1 pause: full file contents + Gate-4 real-MinIO round-trip + CI service log.
- **CF-10** floor re-confirmed (§0). **CF-18** swept (§0).
- **CF-19** — exact-pin both `@aws-sdk` packages (`3.1052.0`) + the MinIO RELEASE tag.
- **CF-21** — new instance: 5 STORAGE_* (3 required) cascaded across vitest.config (21a),
  env.test (21a), error-handler.test (21b all-5), ci.yml.
- **CF-22** — Q2 (ensure-on-instantiation → memoized-lazy) surfaced for ratification.
- **CF-23** — SDK behaviors verified at plan-write (npm + Context7 + docker pull/inspect/run);
  the real round-trip is the execution-time layer at 2.1.

---

## §10 — Push policy + sequencing
**2.0** — `git add` plan; `docs(phase-1c): plan Commit 2 — MinIO + StorageProvider`; push;
`gh run watch` (CF-6). Node 20.
**2.1** — `git add apps/api infra .github` (+ `pnpm-lock.yaml`); commit; push; `gh run watch`
(CF-7). Node 20. No `Co-Authored-By`. **Lockfile in the commit** — verify before push.

---

## §11 — Exact file contents (Commit 2.1)

### `apps/api/src/storage/provider.ts` (new)
```ts
// StorageProvider mirrors EmailSender (shaped results, not throws) for consistent,
// explicit caller handling. NOTE: unlike EmailSender's never-throw (a throw there
// cascaded to signup orphan-rollback), storage has no downstream cascade — shaped
// results here are ergonomics, not a safety lock.
export type UploadResult = { key: string } | { error: string };
export type PresignResult = { url: string } | { error: string };
export type DeleteResult = { deleted: boolean } | { error: string };

export interface StorageProvider {
  upload(params: { key: string; body: Buffer; contentType: string }): Promise<UploadResult>;
  getPresignedUrl(params: { key: string; expiresInSeconds?: number }): Promise<PresignResult>;
  delete(params: { key: string }): Promise<DeleteResult>;
}
```

### `apps/api/src/storage/s3-storage.ts` (new)
```ts
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Env } from '../env.js';
import { logger } from '../logger.js';

import type { DeleteResult, PresignResult, StorageProvider, UploadResult } from './provider.js';

const log = logger.child({ module: 's3-storage' });

// S3-generic (AWS SDK v3 speaks S3 to any S3-compatible backend). forcePathStyle:true
// is mandatory for MinIO (path-style endpoint/bucket, not virtual-hosted bucket.endpoint).
export class S3Storage implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  // Memoized ensure-bucket: runs once on first upload (sync constructor → no import-time
  // network). Faithful to "ensure before first use" without an async constructor.
  private bucketReady: Promise<void> | undefined;

  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }

  static fromEnv(env: Env): S3Storage {
    const client = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
      },
      forcePathStyle: true,
    });
    return new S3Storage(client, env.STORAGE_BUCKET);
  }

  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        try {
          await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        } catch {
          await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        }
      })();
    }
    return this.bucketReady;
  }

  async upload(params: { key: string; body: Buffer; contentType: string }): Promise<UploadResult> {
    try {
      await this.ensureBucket();
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.key,
          Body: params.body,
          ContentType: params.contentType,
        }),
      );
      return { key: params.key };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown storage error';
      log.error({ key: params.key, error }, 'storage upload failed');
      return { error };
    }
  }

  async getPresignedUrl(params: { key: string; expiresInSeconds?: number }): Promise<PresignResult> {
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: params.key }),
        { expiresIn: params.expiresInSeconds ?? 3600 },
      );
      return { url };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown storage error';
      log.error({ key: params.key, error }, 'storage presign failed');
      return { error };
    }
  }

  async delete(params: { key: string }): Promise<DeleteResult> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: params.key }));
      return { deleted: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown storage error';
      log.error({ key: params.key, error }, 'storage delete failed');
      return { error };
    }
  }
}

// Singleton from env at module load, like emailSender (auth/auth.ts:16). Lazy: no
// network on import (S3Client connects lazily; ensureBucket runs on first upload).
export const storage: StorageProvider = S3Storage.fromEnv(env);
```
*(Import note: the singleton needs `import { env } from '../env.js';`. The DI constructor
`(client, bucket)` keeps unit tests free of module-mocks for the success/error paths — a fake
client `{ send: vi.fn() }` cast via `unknown`; `getSignedUrl` is module-mocked for the presign
unit tests. Final import order locked at 2.1 against lint.)*

### `apps/api/src/env.ts` — add to `EnvSchema` (after the SMTP block)
```ts
  // MinIO / S3-compatible object storage (Commit 2). ENDPOINT/ACCESS_KEY/SECRET_KEY
  // required (fast-fail at boot); BUCKET/REGION default. forcePathStyle is set in code.
  STORAGE_ENDPOINT: z.url(),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1).default('toodooh-documents'),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
```
*(`Env` type is `z.infer` — no manual edit needed beyond the schema.)*

### `apps/api/.env.example` — append
```
# MinIO / S3-compatible object storage (Commit 2). Dev creds = the docker-compose
# MINIO_ROOT_USER / MINIO_ROOT_PASSWORD. BUCKET/REGION have defaults.
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET=toodooh-documents
STORAGE_REGION=us-east-1
```

### `infra/docker-compose.yml` — add the `minio` service (beside `postgres`) + a named volume
```yaml
  minio:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - '9000:9000'
      - '9001:9001'
    volumes:
      - toodooh_miniodata:/data
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live']
      interval: 5s
      timeout: 5s
      retries: 10
```
plus `toodooh_miniodata:` under the top-level `volumes:`.

### `.github/workflows/ci.yml` — job `env:` additions + a docker-run MinIO step (§2.7)
Add to the job `env:` block:
```yaml
      STORAGE_ENDPOINT: http://localhost:9000
      STORAGE_ACCESS_KEY: ci-minio-root
      STORAGE_SECRET_KEY: ci-minio-secret
      STORAGE_BUCKET: toodooh-documents
```
Add a step **before "Test"** (MinIO can't be a `services:` block — §2.7):
```yaml
      - name: Start MinIO (S3-compatible storage for integration tests)
        run: |
          docker run -d --name minio -p 9000:9000 \
            -e MINIO_ROOT_USER=ci-minio-root \
            -e MINIO_ROOT_PASSWORD=ci-minio-secret \
            minio/minio:RELEASE.2025-09-07T16-13-09Z server /data
          for i in $(seq 1 30); do
            if curl -fs http://localhost:9000/minio/health/live; then echo "minio ready"; break; fi
            sleep 1
          done
```
*(`MINIO_ROOT_*` match `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`. `STORAGE_REGION` uses its
default.)*

### `apps/api/vitest.config.ts` — CF-21a runtime shim (add the 3 required to `test.env`)
```ts
      STORAGE_ENDPOINT: process.env['STORAGE_ENDPOINT'] ?? 'http://localhost:9000',
      STORAGE_ACCESS_KEY: process.env['STORAGE_ACCESS_KEY'] ?? 'minioadmin',
      STORAGE_SECRET_KEY: process.env['STORAGE_SECRET_KEY'] ?? 'minioadmin',
```

### `apps/api/tests/env.test.ts` — CF-21a
Add `STORAGE_ENDPOINT/ACCESS_KEY/SECRET_KEY` to the shared required-vars fixture; add a
`rejects missing STORAGE_ENDPOINT` fast-fail test; assert `STORAGE_BUCKET`/`STORAGE_REGION`
defaults in the "applies defaults" case.

### `apps/api/tests/error-handler.test.ts` — CF-21b
Add **all 5** STORAGE_* to the inline `Env` literal (TS enforces the full type).

### `apps/api/tests/storage.test.ts` (new) — unit, ~8 (DI fake client + mocked `getSignedUrl`)
```
1. fromEnv builds an S3Client with forcePathStyle/endpoint/region/credentials.
2. upload success → { key } (PutObjectCommand sent).
3. upload SDK throw → { error } (logged).
4. getPresignedUrl success → { url } (getSignedUrl mocked).
5. getPresignedUrl SDK throw → { error }.
6. delete success → { deleted: true }.
7. delete SDK throw → { error }.
8. ensureBucket: HeadBucket NotFound → CreateBucket sent (memoized — once across two uploads).
```

### `apps/api/tests/storage.integration.test.ts` (new) — real MinIO, 1 (round-trip)
```
9. ensure-bucket creates 'toodooh-documents'; upload buffer → 'rne/itest-<ts>';
   getPresignedUrl → fetch → bytes match; delete → presigned fetch 404s. Self-cleaning
   (deletes its own key) → no shared-state leak; no helper needed (db-test-setup unchanged).
```
**Test delta: apps/api 46 → 55 (+9); root 206 → 215 (+9).**

### `apps/api/package.json` — dependencies (exact-pinned, CF-19) + `pnpm-lock.yaml` (same commit)
```
"@aws-sdk/client-s3": "3.1052.0",
"@aws-sdk/s3-request-presigner": "3.1052.0",
```

---

## §12 — Fire instruction
This is **Commit 2.0** (plan). Architect: ratify Q1–Q2; on approval, commit + push docs-only.
**Halt** until then.

- **Q1 — bucket name `toodooh-documents`** (clean, not legacy `registres`). *Recommend.*
- **Q2 — ensure-bucket = memoized-lazy on first upload** (sync constructor; no import-time
  network), vs the literal "on instantiation." *Recommend memoized-lazy.*

Plus acknowledge: AWS SDK v3 `3.1052.0` (both, exact-pinned); MinIO
`RELEASE.2025-09-07T16-13-09Z`; **CI uses a docker-run step, not a service block** (§2.7);
shaped-result is ergonomics not safety (§1.2); count lift apps/api 46→55 / root 206→215; deps +
lockfile in the 2.1 commit. CF-19/21/22/23 in §9.
