# Slice-2 · Z2 — zone-image upload (public-read storage cutover)

**Status:** PLAN — awaiting architect ratification of the bucket strategy (§3.1) + provider shape
(§3.2) before any implementation code. Path A (public-read) is LOCKED. Written on `main` @ `ee69fd1`.

Z2 finishes the zones-domain cutover Z1 began: `uploadZoneImage` is the **sole remaining Supabase
call** in `predefined-zones.service.ts`. This pass repoints it onto `apps/api` + MinIO with a
**public-read** storage class (the first non-private storage in the system), preserving today's
durable-public-URL render behavior.

---

## §0 — Source-confirm (verified at plan-write, `ee69fd1`)

- **Z1 serializer to extend:** `apps/api/src/routes/predefined-zones.ts:18` `toZoneRow` already maps
  every column; `image_url` is currently passed through raw (`row.imageUrl`). Z2 extends this one
  field (key → `/storage/<key>`).
- **Column:** `schema.ts:245` `imageUrl: text('image_url')` — **nullable, no default**. All **8 seed
  rows hold `null`** (the `0003` seed INSERT sets only name/description/lat/lng/radius). So seeded
  zones render the picsum fallback today; only admin-uploaded zones carry an image.
- **Today's Supabase upload:** `predefined-zones.service.ts:80-92` —
  `supabase.storage.from('zone-images').upload(\`${zoneId}/${Date.now()}.${ext}\`, …, {upsert:true})`
  then `getPublicUrl(path)` → a durable public URL persisted to `image_url`. **Bug being killed:**
  the timestamped path means every re-upload orphans the prior object.
- **Upload is EDIT-ONLY.** `GeographicZonesManagement.tsx:142` `if (!file || !editingZone) return;`
  and `:150` uses `editingZone.id`. The **create** path (`:191-205`) never sets `image_url`. ⇒ the
  stable key `zones/<zoneId>` always has a real, existing id — **no create-before-id / temp-key
  problem.**
- **Consumers render `image_url` directly** as `<img src>`: admin (`GeographicZonesManagement.tsx:327,
  470`) and the advertiser wizard (`new-campaign/Step4.tsx:279`, picsum fallback on null). These
  **renders stay unchanged** — the GET serializer delivers a renderable `/storage/<key>` path.
- **Precedent (real MinIO, usable):** `routes/profile-documents.ts` (multipart via `@fastify/multipart`,
  5MB/1-file, MIME allow-set, key `${type}/${id}`, column holds the KEY) + `storage/s3-storage.ts`
  (AWS SDK v3 → MinIO, `forcePathStyle`, single bucket `env.STORAGE_BUCKET`). Exercised by
  `tests/storage.integration.test.ts` (real-MinIO round-trip).

---

## §1 — Locked constraints (architect, do not re-litigate)

1. **Path A, public-read.** Zone images stay public-durable; **not** private-presigned. Consumer
   `<img src>` renders unchanged.
2. **Store the KEY** in `image_url` (`zones/<zoneId>`), not a URL. **Serialize key → relative
   `/storage/<key>`** in the GET serializer; `null → null` (consumer keeps its picsum fallback).
3. **Stable key + overwrite (upsert)** — `zones/<zoneId>`, mirroring profile-doc's `${type}/${id}`.
   No timestamped paths; kills the re-upload-orphans bug.
4. **MIME: images only** (`image/jpeg`, `image/png`, `image/webp`) — matches the frontend's `:143-144`
   validation. Reuse profile-doc's size/limits (5 MB, 1 file).
5. **Admin-guarded write** — `requireAuth + requireAdmin` (upload is admin-only per the call site).

---

## §2 — The four infra questions (RESOLVED — recommendations; architect rules at ratify)

### §2.1 — Q1 · Bucket strategy → **RECOMMEND: public-read PREFIX in the `storage` bucket** ⚠️ (conflicts with your stated lean — read this)

**Config evidence (`nginx/toodooh.conf:67-74`, `toodooh-http.conf:40-48`):**

```
location /storage/ {
  proxy_pass http://minio:9000;        # NO trailing slash → PATH-PRESERVING
  proxy_set_header Host $host;          # HOST-preserving (SigV4 over host=too-dooh.com)
  ...                                   # NO auth_request, NO signature check at nginx → pure pass-through
}
```

`proxy_pass` has **no trailing slash**, so `/storage/<key>` reaches MinIO verbatim as
`/storage/<key>` — and MinIO reads **path-style**, where the **first path segment IS the bucket
name**. The prod bucket is literally named `storage`. **⇒ `/storage/` is hardwired to bucket
`storage`.** A *separate* public bucket (`zone-images`) would be path-style `/zone-images/<key>` and
is **unreachable** through the existing location — it needs a **new nginx `location /zone-images/`
block + a deploy**.

**Two options, with the cost the evidence reveals:**

| | **Option 1 — prefix in `storage`** (recommend) | **Option 2 — separate `zone-images` bucket** (your lean) |
|---|---|---|
| Key / path | `zones/<id>` → `/storage/zones/<id>` | `<id>` → `/zone-images/<id>` |
| nginx | **none** (reuses `/storage/`) | **new `location /zone-images/` + deploy** |
| Serializer | `/storage/<key>` — **matches your LOCKED §1.2** | `/zone-images/<key>` — **overrides LOCKED §1.2** |
| Provider | `upload()` **unchanged** (same bucket) | new public bucket + `uploadPublic()` |
| Policy | anonymous-read scoped to `arn:aws:s3:::storage/zones/*` | anonymous-read on whole `zone-images` bucket |
| Isolation | shares bucket w/ private rne/cin (other prefixes) | clean — no private objects in the bucket |

**⚠️ Surfaced conflict you must resolve:** your **LOCKED §1.2 serialization (`/storage/<key>`)
presupposes Option 1** (bucket `storage`), but your **Q1 lean was Option 2** (separate bucket, for
isolation). They are mutually exclusive. The path-style mechanic above is likely the piece not in
view when the lean was set: Option 2's "no-nginx-change" assumption is **false** — it needs a new
location.

**Why I recommend Option 1:** it is internally consistent with your locked serializer, needs **zero
nginx change**, leaves `upload()` untouched, and the isolation risk is **mitigable and provable** —
the anonymous policy is scoped to `storage/zones/*` only (rne/cin live under `rne/`,`cin/` and stay
private), and §2.3's integration test **asserts a private doc key returns 403 on unsigned GET**.
Presigned private access is signature-based and **unaffected** by an additive anonymous-read
statement. If you still prefer Option 2's hard isolation, the cost is the new nginx location + a
deploy + re-opening §1.2 — fine, but it should be a deliberate call, not an accident of the lean.

### §2.2 — Q2 · StorageProvider shape → **smallest change, tracks the Q1 ruling**

Current `StorageProvider` (`provider.ts:9-13`): `upload` / `getPresignedUrl` / `delete` on one
private bucket. **No `getPublicUrl` is needed** — the serializer composes `/storage/<key>` itself
(§1.2).

- **If Option 1 (recommended):** `upload()` is **unchanged** (same bucket; key just carries the
  `zones/` prefix). The *only* new capability is a one-time, idempotent **anonymous-read prefix
  policy**. Add **one method** `ensureZonesPublicRead()` to `S3Storage` (a memoized
  `PutBucketPolicyCommand` granting `s3:GetObject` to `Principal:*` on `arn:aws:s3:::<bucket>/zones/*`),
  fired lazily before the first zone-image `PutObject` — exactly the `ensureBucket()` pattern
  (`s3-storage.ts:45-56`). Interface gains one method; no second client, no bucket param. **Smallest
  coherent change.**
- **If Option 2:** add `STORAGE_PUBLIC_BUCKET` (env, default `zone-images`) + an `uploadPublic()`
  targeting it + an `ensurePublicBucket()` (create + bucket-wide anonymous-read policy). Larger:
  second bucket, second ensure path, env addition.

**Note (both options):** a MinIO bucket policy is one document per bucket. `storage` currently has
**no** bucket policy (private-by-default; presigned access needs none), so setting a single
anonymous-read statement is additive and safe. If `storage` later needs other statements they
coexist in one document — out of scope for Z2, noted.

### §2.3 — Q3 · Public-read verification WITHOUT a deploy

Prod is on the divergent `626cd71` branch (see §7), so Z2 cannot deploy; verification is local +
static.

- **(a) Static nginx read (done at plan-write):** the `/storage/` block is **pure pass-through** —
  `proxy_pass http://minio:9000;`, host-preserving, **no `auth_request`, no signature enforcement**.
  ⇒ an unsigned GET to `/storage/zones/<id>` is **not blocked by nginx**; access control is entirely
  MinIO-side (the bucket/prefix policy). Evidence cited in §2.1. **This is the proof nginx won't
  block anonymous reads.**
- **(b) Local real-MinIO integration test** (NEW, mirrors `storage.integration.test.ts`): after
  `ensureZonesPublicRead()`, upload `zones/itest-<n>`, then do an **UNSIGNED** `fetch` straight to
  MinIO (`${STORAGE_ENDPOINT}/<bucket>/zones/itest-<n>`, no SigV4) → **assert 200 + bytes match**.
  **Isolation proof (load-bearing):** unsigned `fetch` of a private key (`rne/itest-<n>`) → **assert
  403** (still private). Self-cleaning (delete own keys).
- **(c) Live nginx+TLS smoke** (real `https://too-dooh.com/storage/zones/<id>` through nginx) —
  **deploy-time item, DEFERRED.** Named here; blocked on the branch reconciliation regardless. Not a
  Z2-build blocker.

### §2.4 — Q4 · Commit factoring (for Option 1; Option 2 splits C1 differently)

| # | Commit | Nature |
|---|---|---|
| **C1** | `S3Storage.ensureZonesPublicRead()` + the real-MinIO integration test (anonymous GET 200 for `zones/*`; private key 403) | **JUDGMENT** — policy ARN scope, anonymous semantics, isolation proof |
| **C2** | `POST /api/predefined-zones/:id/image` — multipart, `requireAuth+requireAdmin`, image MIME, 5 MB, stable key `zones/<id>` (upsert), **persists `image_url=key` server-side** (route owns the column, per precedent), returns `{ image_url: '/storage/zones/<id>' }`; 404 on unknown id. + route test (real PG + MinIO) | mostly **mechanical** (copy profile-doc route; swap guard/MIME/key/persist) |
| **C3** | extend `toZoneRow`: `image_url` key → `/storage/<key>`, `null→null`; update the Z1 GET test expectation | **mechanical** |
| **C4** | frontend `uploadZoneImage` → `apiClient.postForm` to the new endpoint; **drop the `supabase` import** (last call → file leaves the 55-set, **55→54**); `handleSave` drops `image_url` from the edit patch (route owns persistence now); renders unchanged | **mechanical** |

C1→C4, each green independently. C2+C3 may merge if you prefer one backend commit; kept split for
independently-testable serializer + clean diffs.

---

## §3 — Write-path design point (resolved — flag for ratify)

The route, not the frontend, owns `image_url` persistence (mirrors profile-doc owning
`registration_doc_url`). Concretely:

- `handleImageChange` (edit-only) → upload returns `{ image_url: '/storage/zones/<id>' }` → set local
  preview state to that renderable path (immediate `<img src>` works) + invalidate the zones query.
- `handleSave` **omits `image_url`** from the `updateZone` patch — the upload route already persisted
  the key. (The create path never sent `image_url`; unchanged.)

This keeps the column single-writer (the upload route), avoids a key-vs-path round-trip mismatch
(the column stores `zones/<id>`; the wire/preview shows `/storage/zones/<id>`), and the LOCKED
render path (`<img src={image_url}>` after GET) is untouched. **This is the one frontend behavior
delta beyond a pure repoint — surfaced for ratify.**

---

## §4 — Change set per file (Option 1)

- `apps/api/src/storage/s3-storage.ts` — add `ensureZonesPublicRead()` (memoized `PutBucketPolicy`).
- `apps/api/src/storage/provider.ts` — add `ensureZonesPublicRead(): Promise<void>` to the interface.
- `apps/api/tests/storage.integration.test.ts` — add the anonymous-GET-200 + private-key-403 cases
  (or a sibling `zone-image-public.integration.test.ts`).
- `apps/api/src/routes/predefined-zones.ts` — add `POST /:id/image` (multipart) + extend `toZoneRow`
  (`image_url` → `/storage/<key>`). Register `@fastify/multipart` in-plugin (profile-doc pattern).
- `apps/api/tests/predefined-zones.test.ts` — add image-upload route cases (201 + key persisted;
  403/401 guards; 404 unknown id; bad-MIME 400; oversize 413) + update the GET serializer expectation.
- `apps/web/src/features/screens/services/predefined-zones.service.ts` — `uploadZoneImage` →
  `apiClient.postForm`; **delete the `supabase` import** (Z2's headline: the file leaves the
  supabase-import set).
- `apps/web/src/features/admin/pages/GeographicZonesManagement.tsx` — `handleSave` drops `image_url`
  from the edit patch (§3).

No schema/migration change (column already exists; storing a key in the same nullable `text` column).

---

## §5 — Gate expectations

- **apps/api real-MinIO + real-PG suite:** green incl. the new integration test (anonymous 200 +
  private 403) and the route cases. (CI provisions MinIO; the integration suite is gated on
  `STORAGE_*` like today.)
- **apps/api typecheck/lint:** 0/0.
- **apps/web typecheck:** 27 identity (touched files add 0).
- **apps/web lint 0, test flat, build marginal.**
- **Supabase-import file count: 55 → 54** — `predefined-zones.service.ts` drops its last
  `@/lib/supabase` import. **This is the Z2 headline metric** (Z1 held 55→55 precisely because this
  call remained).

---

## §6 — Hard-halt conditions (build-time)

- nginx `/storage/` turns out to enforce a signature / `auth_request` after all (it does not, per
  §2.1 — but re-confirm in the build pass before relying on anonymous reads).
- MinIO version rejects the prefix-scoped anonymous policy (re-scope to a separate bucket = fall back
  to Option 2, escalate).
- The isolation test (private key 403) **fails** → the policy is over-broad → HALT, do not ship a
  config that could expose rne/cin.

---

## §7 — Carry-forward / cross-refs

- **Deploy/branch reality:** prod runs `626cd71` (`fix/slice1-auth-e2e`, manual deploy 2026-06-03) —
  **no slice-2**. Z2 (and Z1) reach prod only via the branch reconciliation (slice-2-discovery §9)
  + a manual deploy. The live `/storage/` TLS smoke (§2.3c) rides that.
- **nginx addition (Option 2 only):** if the architect rules Option 2, the new `location
  /zone-images/` batches with the reconciliation deploy work.
- **Zones domain after Z2:** fully off Supabase (reads + scalar writes Z1, image Z2). `predefined_zones`
  is the first end-to-end-native data domain.

---

## §8 — Status

PLAN written, committed, pushed (CF-6). **HALT for architect ratification of §2.1 (bucket strategy)
+ §2.2 (provider shape) + §3 (write-path delta) before the build prompt.** No implementation code in
this pass.
