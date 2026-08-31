import { randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import {
  accounts,
  agentReferrals,
  agents,
  screenhosts,
  userDocuments,
  users,
} from '../db/schema.js';
import { env } from '../env.js';
import { PROFILE_TYPES, fromProfileType } from '../lib/profile-type.js';
import { ALLOWED_DOCUMENT_MIME, MAX_DOCUMENT_BYTES } from '../lib/user-documents.js';
import { encryptWifiPassword } from '../lib/wifi-crypto.js';
import { storage } from '../storage/s3-storage.js';
import { validatePhone } from '../validation/phone.js';
import { normalizeTaxNumber, validateTaxNumber } from '../validation/tax-number.js';

// snake_case request shape (apps/web-facing per Decision 3) — the full signup wizard profile
// (Phase 1e Commit 2 grow). role/status are NOT accepted: zod strips unknown keys and better-auth's
// input:false drops them, so they default server-side (advertiser/pending). profile_type is a
// non-privileged hint mapped to role post-create (CF-24 class-b). Required = the minimal account
// identity + terms; the rest of the profile is optional and stored when present (kept lenient to
// decouple from the reference-data-GET ordering and avoid FK-500s on partial data).
// One fleet location the fleet_owner declares at signup → one screenhosts row. All
// location/WiFi fields are optional ("add later"); name is the only requirement.
// room_count is accepted on the wire (the FE still sends it) but stripped here —
// screenhosts has no room_count column, so it is never persisted.

// H1 (Mejri item 5) — working hours at signup: the venue's single daily window [open, close),
// ints 0–23, landing in the SAME screenhosts.opening_hour/closing_hour columns the admin
// eligibility PATCH and the C3 ingest write. The pair is all-or-nothing and must satisfy
// open < close (the dispatch/report reading semantics); skipping leaves both NULL (14h report
// fallback, full hachure, dispatch-ineligible until set). Per-day + overnight stay deferred.
const hourField = z.number().int().min(0).max(23);
interface HoursPair {
  opening_hour?: number;
  closing_hour?: number;
}
const hoursArePaired = (b: HoursPair): boolean =>
  (b.opening_hour === undefined) === (b.closing_hour === undefined);
const hoursAreOrdered = (b: HoursPair): boolean =>
  b.opening_hour === undefined || b.closing_hour === undefined || b.opening_hour < b.closing_hour;
const PAIR_MESSAGE = 'opening_hour and closing_hour must be provided together';
const ORDER_MESSAGE = 'opening_hour must be strictly before closing_hour';

const fleetEstablishmentSchema = z
  .object({
    name: z.string().min(1).max(200),
    screen_count: z.number().int().min(0).optional(),
    address: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    zone: z.string().optional(),
    governorate_id: z.uuid().optional(),
    postal_code: z
      .string()
      .regex(/^\d{4}$/, 'Postal code must be 4 digits')
      .optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    wifi_ssid: z.string().min(1).optional(),
    wifi_password: z.string().min(1).optional(),
    opening_hour: hourField.optional(),
    closing_hour: hourField.optional(),
  })
  .refine(hoursArePaired, { message: PAIR_MESSAGE, path: ['closing_hour'] })
  .refine(hoursAreOrdered, { message: ORDER_MESSAGE, path: ['closing_hour'] });

const signupBodySchema = z
  .object({
    email: z.email('A valid email is required'),
    password: z.string().min(10, 'Password must be at least 10 characters'),
    contact_name: z.string().min(1).max(100),
    business_name: z.string().min(1).max(200),
    contact_phone: z.string().refine(validatePhone, 'Phone must be E.164 (e.g. +21612345678)'),
    terms_accepted: z.literal(true, { error: 'Terms must be accepted' }),
    tax_number: z.string().refine(validateTaxNumber, 'Invalid tax number format').optional(),
    profile_type: z.enum(PROFILE_TYPES).optional(),
    business_type: z.string().min(1).optional(),
    business_sector_id: z.uuid().optional(),
    street_address: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    postal_code: z
      .string()
      .regex(/^\d{4}$/, 'Postal code must be 4 digits')
      .optional(),
    governorate_id: z.uuid().optional(),
    fonction: z.string().optional(),
    zone: z.string().optional(),
    agent_toodooh: z.string().optional(),
    // Screenhost signup location/WiFi capture (P3). individual_owner = ONE location
    // built from these top-level fields; fleet_owner = one per fleet_establishments
    // row. Coordinates and WiFi are optional ("add later") and never block signup.
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    wifi_ssid: z.string().min(1).optional(),
    wifi_password: z.string().min(1).optional(),
    // H1 — the individual_owner's working-hours window (fleet owners carry a pair per
    // fleet_establishments entry instead). Advertisers/agencies never persist these.
    opening_hour: hourField.optional(),
    closing_hour: hourField.optional(),
    fleet_establishments: z.array(fleetEstablishmentSchema).optional(),
  })
  .refine(hoursArePaired, { message: PAIR_MESSAGE, path: ['closing_hour'] })
  .refine(hoursAreOrdered, { message: ORDER_MESSAGE, path: ['closing_hour'] });

// Q4 — better-auth's signup is sequential, not atomic (createUser → linkAccount
// → verification are separate calls; no injectable tx). If linkAccount throws
// after createUser, an orphan user (no credential account) can remain. Best-
// effort cleanup; the `if (acct) return` guard means a real (account-backed)
// user is never deleted, and the anti-enumeration duplicate path never reaches
// the catch (it returns success). The caller guards this so it never masks the
// original error.
const deleteOrphanUser = async (email: string): Promise<void> => {
  const normalized = email.toLowerCase();
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  if (!u) return;
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, u.id))
    .limit(1);
  if (acct) return; // account-backed → real user, not an orphan
  await db.delete(users).where(eq(users.id, u.id));
};

// ── R7/N4 — owner signup document volets (reverses F5 for owners) ──────────────────────────────
// Owners post multipart: a `payload` field (the signup JSON) + the volet files. fleet_owner → RNE;
// both owner types → bank (RIB). Advertisers/agencies still post JSON and submit no documents.
//
// SIGN-2 (operator ruling 2026-08-31) — the CIN volets are GONE from signup: an individual owner is
// asked for the RIB only. CIN is NOT abolished, it is PROVIDE-LATER — the 'cin' document category,
// the admin request path and POST /api/profile/documents all still accept it after sign-in. An
// unknown file part is ignored by the parser below, so a stale client still signs up cleanly; its
// CIN parts are simply dropped rather than rejected.
type VoletFile = { buffer: Buffer; mimetype: string; filename: string };

const VOLET_FIELDS = ['rne', 'bank'] as const;
type VoletField = (typeof VOLET_FIELDS)[number];
const isVoletField = (name: string): name is VoletField =>
  (VOLET_FIELDS as readonly string[]).includes(name);

const isOwnerType = (t: string | undefined): boolean =>
  t === 'individual_owner' || t === 'fleet_owner';

// Owner documents are OPTIONAL at signup (provide-later — Kais QA 2026-06-24): presence/completeness
// is an approval signal via documentPresence, NOT a signup-submit gate. So we never reject a missing
// or partial volet — only the MIME of an ATTACHED file is validated (size is already capped by the
// multipart fileSize limit → 413 on parse). Mirrors profile-documents' MIME guard via the shared set.
// Returns the problems (empty = valid).
const attachedVoletErrors = (
  files: Partial<Record<VoletField, VoletFile>>,
): { field: string; reason: string }[] => {
  const errs: { field: string; reason: string }[] = [];
  for (const field of VOLET_FIELDS) {
    const file = files[field];
    if (file && !ALLOWED_DOCUMENT_MIME.has(file.mimetype)) {
      errs.push({ field, reason: `unsupported content type: ${file.mimetype}` });
    }
  }
  return errs;
};

// Persist one volet AFTER account creation. Storage-FIRST so a row never references a missing object
// (the profile-documents no-orphan-key rule); on a row-insert failure, best-effort delete the object
// we just wrote so no orphan object lingers. Degraded, NEVER thrown: a failure leaves the volet absent
// → the onboarding indicator (C1) shows incomplete → the user finishes via the post-signin
// /api/profile/documents path. Same storage key format + table as that path (no new storage path).
const persistVolet = async (
  userId: string,
  category: 'cin' | 'rne' | 'bank',
  position: number,
  file: VoletFile,
  log: FastifyBaseLogger,
): Promise<void> => {
  const rowId = randomUUID();
  const key = `${category}/${userId}/${rowId}`;
  const uploaded = await storage.upload({ key, body: file.buffer, contentType: file.mimetype });
  if ('error' in uploaded) {
    log.error({ userId, category, position }, 'signup volet upload failed (degraded)');
    return;
  }
  try {
    await db.insert(userDocuments).values({
      // The row id MUST equal the UUID embedded in storageKey (<cat>/<uid>/<rowId>) so isRowOwnedKey
      // holds — else a later DELETE/REPLACE via /api/profile/documents skips storage.delete and
      // orphans the object. Mirrors profile-documents.ts's `.values({ id: rowId, ... })`.
      id: rowId,
      userId,
      category,
      position,
      storageKey: key,
      originalFilename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.length,
    });
  } catch (err) {
    // The row didn't land — drop the object we just wrote so it isn't orphaned in MinIO.
    await storage.delete({ key }).catch(() => undefined);
    log.error({ userId, category, position, err }, 'signup volet row insert failed (degraded)');
  }
};

export const signupRoute: FastifyPluginAsync = async (app) => {
  // Owners post multipart (a `payload` field + the volet files); advertisers/agencies still post JSON.
  // Registration is content-type-scoped — JSON requests are parsed by Fastify's JSON parser, unchanged.
  // files:4 leaves headroom over rne/bank; the fileSize limit is the shared 5 MB cap.
  await app.register(multipart, {
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: 4, fields: 5 },
  });

  app.post('/api/signup', async (request, reply) => {
    // Dual-path body source: a multipart owner request carries the signup JSON in a `payload` field +
    // named volet file parts; a JSON request uses request.body verbatim (advertiser/agency, unchanged).
    const isMultipart = request.isMultipart();
    let rawBody: unknown = request.body;
    const voletFiles: Partial<Record<VoletField, VoletFile>> = {};
    if (isMultipart) {
      let payloadRaw: string | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer(); // throws past the fileSize limit
            if (isVoletField(part.fieldname)) {
              voletFiles[part.fieldname] = {
                buffer,
                mimetype: part.mimetype,
                filename: part.filename,
              };
            }
          } else if (part.fieldname === 'payload') {
            payloadRaw = part.value as string;
          }
        }
      } catch {
        return reply.status(413).send({
          error: 'PAYLOAD_TOO_LARGE',
          message: `A document exceeds the ${MAX_DOCUMENT_BYTES}-byte limit.`,
        });
      }
      if (payloadRaw === undefined) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'payload', reason: 'the signup payload field is required' }],
        });
      }
      try {
        rawBody = JSON.parse(payloadRaw);
      } catch {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'payload', reason: 'must be valid JSON' }],
        });
      }
    }

    const parsed = signupBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const {
      email,
      password,
      contact_name,
      business_name,
      contact_phone,
      tax_number,
      profile_type,
      business_type,
      business_sector_id,
      street_address,
      city,
      postal_code,
      governorate_id,
      fonction,
      zone,
      agent_toodooh,
      latitude,
      longitude,
      wifi_ssid,
      wifi_password,
      opening_hour,
      closing_hour,
      fleet_establishments,
    } = parsed.data;
    // terms_accepted is enforced `true` by the schema (z.literal); the acceptance time is
    // server-stamped below, never taken from the client.

    // R7/N4 reversed (Kais QA 2026-06-24): owner documents are OPTIONAL at signup (provide-later via
    // the post-signin /api/profile/documents surface). An owner may finalize with NO documents — on
    // the JSON path or an empty multipart → 201. We do NOT 400 a missing or partial volet; completeness
    // (both CIN faces + RIB) is enforced as an approval signal via documentPresence, not a submit gate.
    // Only the MIME of any ATTACHED file is validated BEFORE create → 400 with NO account (the FE caps
    // MIME at pick, so this is a defensive guard for a malformed upload, never for absence).
    if (isMultipart) {
      const voletErrs = attachedVoletErrors(voletFiles);
      if (voletErrs.length > 0) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: voletErrs,
        });
      }
    }

    // tax_number is ours (UNIQUE) — pre-check for a clean 409, but ONLY when provided: it is
    // optional now (owners have no matricule at signup) and the nullable UNIQUE column allows many
    // nulls. (Email dupes are masked by anti-enumeration → generic 201, no EMAIL_TAKEN.)
    if (tax_number) {
      const taxOwner = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.taxNumber, normalizeTaxNumber(tax_number)))
        .limit(1);
      if (taxOwner.length > 0) {
        return reply.status(409).send({
          error: 'TAX_NUMBER_TAKEN',
          message: 'A business with this tax number is already registered.',
          fields: [{ field: 'tax_number', reason: 'already registered' }],
        });
      }
    }

    try {
      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name: contact_name,
          businessName: business_name,
          contactPhone: contact_phone,
          // SIGN-3 — stored in the ONE canonical form (separators stripped, upper-case).
          ...(tax_number ? { taxNumber: normalizeTaxNumber(tax_number) } : {}),
          // Post-verify redirect target (Phase-1f F3). Absolute → passes better-auth's
          // originCheck (WEB_ORIGIN is trusted); the FE /verify-email page reads ?error=.
          callbackURL: `${env.WEB_ORIGIN}/verify-email`,
        },
      });

      // Write the rest of the profile + the mapped role in ONE post-create update. role is
      // input:false (server-controlled), so it can't ride signUpEmail input; profile_type (a
      // validated, non-privileged hint) maps to it here. DUPLICATE-SAFE: on a duplicate email
      // better-auth returns a SYNTHETIC, non-persisted user (anti-enumeration) whose id is not in
      // the DB — and is not even a uuid, so `where id = result.user.id` would THROW on the uuid cast
      // rather than no-op. So re-fetch by email and apply the write only when the persisted row's id
      // matches the returned id: a duplicate's synthetic id won't match, so the existing account is
      // left untouched (verified by the duplicate-no-op test).
      const [persisted] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      if (persisted && persisted.id === result.user.id) {
        const updates: Partial<typeof users.$inferInsert> = { termsAcceptedAt: new Date() };
        let mappedRole: ReturnType<typeof fromProfileType>['role'] | undefined;
        if (profile_type) {
          const { role, businessTypeOverride } = fromProfileType(profile_type);
          mappedRole = role;
          updates.role = role;
          if (businessTypeOverride) updates.businessType = businessTypeOverride;
        }
        if (business_type && updates.businessType === undefined)
          updates.businessType = business_type;
        if (business_sector_id !== undefined) updates.businessSectorId = business_sector_id;
        if (street_address !== undefined) updates.streetAddress = street_address;
        if (city !== undefined) updates.city = city;
        if (postal_code !== undefined) updates.postalCode = postal_code;
        if (governorate_id !== undefined) updates.governorateId = governorate_id;
        if (fonction !== undefined) updates.fonction = fonction;
        if (zone !== undefined) updates.zone = zone;
        if (agent_toodooh !== undefined) updates.agentCode = agent_toodooh;
        await db.update(users).set(updates).where(eq(users.id, persisted.id));

        // P3 — persist screenhost location(s) from signup. owner_id is enforced in
        // application code here (every row gets ownerId = the new user id); the column
        // stays nullable on disk by design. Coordinates/WiFi are stored when provided,
        // else NULL ("add later"). The WiFi password is encrypted at rest (recoverable);
        // the plaintext is never logged. export_status keeps its 'pending' default.
        // Every venue INHERITS the owner's signup sector (Lane B V1: a fleet's venues
        // all carry the SAME owner sector; per-venue divergence comes later via the
        // admin eligibility PATCH) — null when the owner declared none.
        if (mappedRole === 'individual_owner') {
          await db.insert(screenhosts).values({
            name: business_name,
            address: street_address ?? null,
            city: city ?? null,
            postalCode: postal_code ?? null,
            governorateId: governorate_id ?? null,
            zone: zone ?? null,
            latitude: latitude !== undefined ? latitude.toString() : null,
            longitude: longitude !== undefined ? longitude.toString() : null,
            wifiSsid: wifi_ssid ?? null,
            wifiPasswordEncrypted: wifi_password ? encryptWifiPassword(wifi_password) : null,
            openingHour: opening_hour ?? null,
            closingHour: closing_hour ?? null,
            businessSectorId: business_sector_id ?? null,
            ownerId: persisted.id,
          });
        } else if (mappedRole === 'fleet_owner' && fleet_establishments?.length) {
          await db.insert(screenhosts).values(
            fleet_establishments.map((establishment) => ({
              name: establishment.name,
              screenCount: establishment.screen_count ?? 0,
              address: establishment.address ?? null,
              city: establishment.city ?? null,
              postalCode: establishment.postal_code ?? null,
              governorateId: establishment.governorate_id ?? null,
              zone: establishment.zone ?? null,
              latitude:
                establishment.latitude !== undefined ? establishment.latitude.toString() : null,
              longitude:
                establishment.longitude !== undefined ? establishment.longitude.toString() : null,
              wifiSsid: establishment.wifi_ssid ?? null,
              wifiPasswordEncrypted: establishment.wifi_password
                ? encryptWifiPassword(establishment.wifi_password)
                : null,
              openingHour: establishment.opening_hour ?? null,
              closingHour: establishment.closing_hour ?? null,
              businessSectorId: business_sector_id ?? null,
              ownerId: persisted.id,
            })),
          );
        }

        // Agent referral linkage (P1 Commit 3). Resolve the entered code (trim+uppercase) against
        // agents.code; on a ROLE-COMPATIBLE match, normalize the link into agent_referrals. The
        // raw `users.agent_code` write above still happens regardless — agent_referrals is the
        // structured attribution, agent_code is the raw audit field. A non-match or an
        // incompatible role links NOTHING (signup still 201). Absent agent_toodooh → no lookup.
        // This sits INSIDE the synthetic-id guard, so a duplicate-email signup never links.
        if (agent_toodooh !== undefined) {
          const resolvedCode = agent_toodooh.trim().toUpperCase();
          const [agent] = await db
            .select({ agentUserId: agents.userId, agentRole: users.role })
            .from(agents)
            .innerJoin(users, eq(users.id, agents.userId))
            .where(eq(agents.code, resolvedCode))
            .limit(1);
          if (agent) {
            // The referred user's MAPPED role (server-controlled): profile_type maps via
            // fromProfileType; absent profile_type defaults to advertiser (the DB default applied
            // above). screenhost_agent ↔ individual_owner/fleet_owner; screencast_agent ↔
            // advertiser (which subsumes 'agency' = advertiser + business_type='agency').
            const referredRole = profile_type ? fromProfileType(profile_type).role : 'advertiser';
            const compatible =
              (agent.agentRole === 'screenhost_agent' &&
                (referredRole === 'individual_owner' || referredRole === 'fleet_owner')) ||
              (agent.agentRole === 'screencast_agent' && referredRole === 'advertiser');
            if (compatible) {
              await db.insert(agentReferrals).values({
                agentUserId: agent.agentUserId,
                referredUserId: persisted.id,
                agentCodeUsed: agent_toodooh, // raw entered value (audit trail, pre-normalization)
              });
            }
          }
        }

        // R7/N4 — persist whatever owner volets WERE provided, now that the account exists (inside the
        // persisted-id guard, so a duplicate-email signup never uploads). Documents are optional at
        // signup, so the per-file presence guards below are load-bearing: only attached volets persist;
        // a missing one simply leaves onboarding incomplete (C1). Degraded + never thrown: a storage/db
        // failure also leaves a volet absent, not a failed signup.
        if (isMultipart && isOwnerType(profile_type)) {
          // SIGN-2 — only fleet_owner carries a legal volet at signup; an individual owner's CIN is
          // provide-later. Both types may attach the RIB below.
          if (profile_type !== 'individual_owner' && voletFiles.rne) {
            await persistVolet(persisted.id, 'rne', 1, voletFiles.rne, request.log);
          }
          if (voletFiles.bank)
            await persistVolet(persisted.id, 'bank', 1, voletFiles.bank, request.log);
        }
      }

      return reply.status(201).send({
        userId: result.user.id,
        email: result.user.email,
        verificationRequired: true,
        message: 'Account created. Please check your email to verify your address.',
      });
    } catch (err) {
      // Best-effort orphan cleanup (Q4); guarded so it never masks `err`.
      await deleteOrphanUser(email).catch(() => undefined);
      if (err instanceof APIError) {
        // We pre-validated, so this is rare (e.g. a better-auth-side rule).
        return reply.status(400).send({ error: 'INVALID_INPUT', message: err.message, fields: [] });
      }
      request.log.error(err, 'signup failed');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again.',
      });
    }
  });
};
