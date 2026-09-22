import multipart from '@fastify/multipart';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import { accounts, agentReferrals, screenhosts, users } from '../db/schema.js';
import { env } from '../env.js';
import { ROLE_LABELS_FR, notifyAdmins } from '../lib/admin-notifications.js';
import { agentCodeVerdict, agentCompatibleWith, resolveAgentByCode } from '../lib/agent-lookup.js';
import { PROFILE_TYPES, fromProfileType } from '../lib/profile-type.js';
import {
  MAX_SIGNUP_FILE_PARTS,
  type SignupDocument,
  type SignupFilePart,
  persistSignupDocument,
  signupDocumentErrors,
  signupFileLimit,
  signupKind,
  slotSignupDocuments,
} from '../lib/signup-documents.js';
import { MAX_DOCUMENT_BYTES } from '../lib/user-documents.js';
import { encryptWifiPassword } from '../lib/wifi-crypto.js';
import { companySizeSchema } from '../validation/company-size.js';
import { validatePhone } from '../validation/phone.js';
import {
  declarationRequired,
  declaredCountSchema,
  individualDeclares,
} from '../validation/screen-declaration.js';
import {
  HOURS_REQUIRED_MESSAGE,
  ORDER_MESSAGE,
  PAIR_MESSAGE,
  fleetEstablishmentSchema,
  hourField,
  hoursAreOrdered,
  hoursArePaired,
} from '../validation/signup-venue.js';
import { normalizeTaxNumber, validateTaxNumber } from '../validation/tax-number.js';

// snake_case request shape (apps/web-facing per Decision 3) — the full signup wizard profile
// (Phase 1e Commit 2 grow). role/status are NOT accepted: zod strips unknown keys and better-auth's
// input:false drops them, so they default server-side (advertiser/pending). profile_type is a
// non-privileged hint mapped to role post-create (CF-24 class-b). Required = the minimal account
// identity + terms; the rest of the profile is optional and stored when present (kept lenient to
// decouple from the reference-data-GET ordering and avoid FK-500s on partial data).
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
    company_size: companySizeSchema.optional(),
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
    // HOURS-M1 (Mejri 09/09, operator 2026-09-12): REQUIRED for an individual_owner — the
    // « préciser plus tard » skip is gone; NULL hours now only exist on legacy rows.
    opening_hour: hourField.optional(),
    closing_hour: hourField.optional(),
    // SCR-DECL1 — the individual_owner's venue counts, REQUIRED like its hours (fleet: per entry).
    screen_count: declaredCountSchema.optional(),
    room_count: declaredCountSchema.optional(),
    fleet_establishments: z.array(fleetEstablishmentSchema).optional(),
  })
  .refine(hoursArePaired, { message: PAIR_MESSAGE, path: ['closing_hour'] })
  .refine(hoursAreOrdered, { message: ORDER_MESSAGE, path: ['closing_hour'] })
  .refine((b) => b.profile_type !== 'individual_owner' || b.opening_hour !== undefined, {
    message: HOURS_REQUIRED_MESSAGE,
    path: ['opening_hour'],
  })
  .refine(individualDeclares('screen_count'), declarationRequired('screen_count'))
  .refine(individualDeclares('room_count'), declarationRequired('room_count'));

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

// A file part over the shared 5 MB cap → 413, no account created.
const payloadTooLarge = {
  error: 'PAYLOAD_TOO_LARGE',
  message: `A document exceeds the ${MAX_DOCUMENT_BYTES}-byte limit.`,
} as const;

// MORE file parts than the kind allows → 413, no account created. A DISTINCT code from the size
// refusal above: both are 413, but the client words them differently and « le fichier est trop
// volumineux (maximum 5 Mo) » is simply false when fifteen small files arrived. The two causes used
// to share `payloadTooLarge` (and, before DOC-CAST1, the bare busboy `files: 4` overflow did too).
const tooManyFiles = {
  error: 'TOO_MANY_FILES',
  message: 'Too many document parts for this signup.',
} as const;

// The multipart plugin refuses the part COUNT itself (busboy's `files` limit) with FST_FILES_LIMIT,
// and an oversized part with FST_REQ_FILE_TOO_LARGE — both surface as a throw from request.parts().
// Read the code off the error so the count case keeps its own reply instead of borrowing the size
// one. `unknown` + a real narrowing, never a cast.
const errorCode = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const { code } = err;
  return typeof code === 'string' ? code : undefined;
};

export const signupRoute: FastifyPluginAsync = async (app) => {
  // A signup WITH documents posts multipart (a `payload` field + the file parts): every owner, and a
  // screencaster that attached files (DOC-CAST1); a signup without documents may post plain JSON.
  // Registration is content-type-scoped — JSON requests are parsed by Fastify's JSON parser, unchanged.
  // The files limit is the largest kind's (lib/signup-documents.ts); the route re-checks per kind.
  // The fileSize limit is the shared 5 MB cap.
  await app.register(multipart, {
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: MAX_SIGNUP_FILE_PARTS, fields: 5 },
  });

  app.post('/api/signup', async (request, reply) => {
    // Dual-path body source: a multipart request carries the signup JSON in a `payload` field + named
    // file parts; a JSON request uses request.body verbatim.
    const isMultipart = request.isMultipart();
    let rawBody: unknown = request.body;
    const fileParts: SignupFilePart[] = [];
    if (isMultipart) {
      let payloadRaw: string | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer(); // throws past the fileSize limit
            fileParts.push({
              field: part.fieldname,
              file: { buffer, mimetype: part.mimetype, filename: part.filename },
            });
          } else if (part.fieldname === 'payload') {
            payloadRaw = part.value as string;
          }
        }
      } catch (err) {
        return reply
          .status(413)
          .send(errorCode(err) === 'FST_FILES_LIMIT' ? tooManyFiles : payloadTooLarge);
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
      company_size,
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
      screen_count,
      room_count,
      fleet_establishments,
    } = parsed.data;
    // terms_accepted is enforced `true` by the schema (z.literal); the acceptance time is
    // server-stamped below, never taken from the client.

    // R7/N4 reversed (Kais QA 2026-06-24): documents are OPTIONAL at signup (provide-later via the
    // post-signin /api/profile/documents surface). An account may finalize with NO documents — on the
    // JSON path or an empty multipart → 201. We do NOT 400 a missing or partial set; completeness is
    // surfaced as an approval signal via documentPresence, not a submit gate. BEFORE create, with NO
    // account on refusal: more file parts than the kind allows → 413, and the MIME of every part that
    // will be stored → 400 (the FE caps MIME at pick, so this is a defensive guard for a malformed
    // upload, never for absence). The same rules for owners and — since DOC-CAST1 — screencasters.
    let signupDocuments: SignupDocument[] = [];
    if (isMultipart) {
      const kind = signupKind(profile_type);
      if (fileParts.length > signupFileLimit(kind)) {
        return reply.status(413).send(tooManyFiles);
      }
      signupDocuments = slotSignupDocuments(fileParts, kind);
      const documentErrs = signupDocumentErrors(signupDocuments);
      if (documentErrs.length > 0) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: documentErrs,
        });
      }
    }

    // AGENT-V1 (Mejri 09/09, operator 2026-09-12): a typed agent code must name an EXISTING agent
    // of the right type, checked BEFORE the account is created (like the matricule pre-check
    // below) — refusing after signUpEmail would 4xx an account that already exists. This reverses
    // the 2026-06-06 A2 rule (accept unknown, store unlinked, flag for admin). Absent → no check:
    // the field is required by the wizard, not by the wire (admin-created accounts carry none).
    if (agent_toodooh !== undefined && agent_toodooh.trim() !== '') {
      const verdict = await agentCodeVerdict(agent_toodooh, profile_type);
      if (verdict !== 'ok') {
        return reply.status(409).send({
          error: verdict === 'unknown' ? 'AGENT_CODE_UNKNOWN' : 'AGENT_CODE_INCOMPATIBLE',
          message:
            verdict === 'unknown'
              ? 'No agent matches this code.'
              : 'This agent code belongs to an agent of another type.',
          fields: [{ field: 'agent_toodooh', reason: verdict }],
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
        if (company_size !== undefined) updates.companySize = company_size;
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
            // SCR-DECL1 — both present for an individual_owner (the refines above).
            screenCount: screen_count ?? 0,
            roomCount: room_count ?? null,
            businessSectorId: business_sector_id ?? null,
            ownerId: persisted.id,
          });
        } else if (mappedRole === 'fleet_owner' && fleet_establishments?.length) {
          await db.insert(screenhosts).values(
            fleet_establishments.map((establishment) => ({
              name: establishment.name,
              screenCount: establishment.screen_count,
              roomCount: establishment.room_count,
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

        // Agent referral linkage (P1 Commit 3, resolver shared since AGENT-V1). The pre-check
        // above already refused an unknown or role-incompatible code with 409, so a present code
        // resolves to a compatible agent here — same resolver, same normalisation (uppercase,
        // whitespace stripped), so the two verdicts cannot drift. The raw `users.agent_code` write
        // above still happens (audit field); agent_referrals is the structured attribution. This
        // sits INSIDE the synthetic-id guard, so a duplicate-email signup never links.
        if (agent_toodooh !== undefined && agent_toodooh.trim() !== '') {
          const agent = await resolveAgentByCode(agent_toodooh);
          if (agent && agentCompatibleWith(agent.agentRole, profile_type)) {
            await db.insert(agentReferrals).values({
              agentUserId: agent.agentUserId,
              referredUserId: persisted.id,
              agentCodeUsed: agent_toodooh, // raw entered value (audit trail, pre-normalization)
            });
          }
        }

        // R7/N4 + DOC-CAST1 — persist whatever documents WERE provided, now that the account exists
        // (inside the persisted-id guard, so a duplicate-email signup never uploads). Documents are
        // optional at signup: a missing one simply leaves onboarding incomplete (C1). Degraded + never
        // thrown: a storage/db failure also leaves a document absent, not a failed signup.
        for (const doc of signupDocuments) {
          await persistSignupDocument(persisted.id, doc, request.log);
        }
      }

      // ADM-BELL1 — a new account waits for the admin's validation: tell every admin (a duplicate
      // signup never reaches here with a real persisted id — the guard above).
      if (persisted && persisted.id === result.user.id) {
        const role = fromProfileType(profile_type ?? 'advertiser').role;
        await notifyAdmins(db, {
          type: 'admin_account_pending',
          title: 'Nouveau compte à valider',
          body: `Le compte « ${business_name} » (${ROLE_LABELS_FR[role] ?? role}) attend votre validation.`,
        }).catch((err: unknown) => request.log.warn({ err }, 'admin notice failed (signup)'));
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
