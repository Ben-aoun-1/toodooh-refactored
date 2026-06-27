import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Phase 1b Commit 1 — the single users table (dual-identity collapse per
// 00-PROJECT_HANDOFF §4 + supabase-schema-inventory §9). better-auth
// (Commit 2) adds account + session tables and maps its `user` model to
// this `users` table via the Drizzle adapter. Property names are camelCase
// (what better-auth's adapter reads); DB columns are snake_case (the
// column-name argument).

export const userRole = pgEnum('user_role', [
  'advertiser',
  'individual_owner',
  'fleet_owner',
  'admin',
  'superadmin',
  // Slice-2 A — agent is a SEPARATE admin-created role (NOT a profile_type), with two types.
  // screenhost_agent is the inventory-creation path consumed by slice E; screencast_agent's
  // product surface is deferred (2.9). Distinct from the signup `agent_code`/`agent_toodooh`
  // referral-attribution field, which is unrelated to this role.
  'screenhost_agent',
  'screencast_agent',
]);

// 'banned' (N3 Scenario 2, fraud) is TERMINAL: the account is retained as evidence but can never
// sign in or resubmit. The validation trio carries the ban record (validationNotes = ban reason).
export const userStatus = pgEnum('user_status', ['pending', 'approved', 'rejected', 'banned']);

export const users = pgTable(
  'users',
  {
    // better-auth core identity
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    // better-auth's logical `name` field maps here via user.fields.name='contactName'
    // (auth.ts). DB column is contact_name (matches the frontend contract wire name).
    contactName: text('contact_name').notNull(),
    image: text('image'),
    // toodooh role + moderation
    role: userRole('role').notNull().default('advertiser'),
    status: userStatus('status').notNull().default('pending'),
    // validation audit trio (validated_by self-references an admin user)
    validatedBy: uuid('validated_by').references((): AnyPgColumn => users.id),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    validationNotes: text('validation_notes'),
    // N3 Scenario 1 — which document area(s) a rejection flags as deficient: 'legal' (RNE/CIN)
    // and/or 'bank' (RIB). MULTI (text[]); the reject route validates the allowed values with a zod
    // enum, mirroring the businessType "text column + zod-at-route" convention. Null unless rejected.
    rejectionTopics: text('rejection_topics').array(),
    // business profile (subset; rest land in Phase 1c onboarding)
    businessName: text('business_name'),
    taxNumber: text('tax_number').unique(),
    contactPhone: text('contact_phone'),
    // responsable role/title (owner contact sub-form, CF-23) — nullable, free text
    fonction: text('fonction'),
    // Generic nullable contact field — NOT better-auth's phoneNumber plugin
    // column (that plugin uses `phone_number`). If the plugin is adopted
    // later it adds its own columns and coexists with this one.
    phone: text('phone'),
    // ── onboarding (Phase 1c) — nullable; populated by POST /api/onboarding ──
    // FKs use callbacks (forward refs); the reference tables are declared
    // below. ON DELETE SET NULL: a deleted reference row must not cascade-
    // delete users (plan §2 / §11).
    businessSectorId: uuid('business_sector_id').references(() => businessSectors.id, {
      onDelete: 'set null',
    }),
    // text + zod enum at Commit 3 (local/national/agency/event_organizer)
    businessType: text('business_type'),
    streetAddress: text('street_address'),
    city: text('city'),
    postalCode: text('postal_code'),
    governorateId: uuid('governorate_id').references(() => governorates.id, {
      onDelete: 'set null',
    }),
    // free-text zone/secteur (owner address sub-form) — NOT a predefined_zones FK (CF-23 §2.1)
    zone: text('zone'),
    // FROZEN (F-docs Commit 1): single-slot doc keys superseded by user_documents (backfilled
    // by migration 0013). No readers or writers remain; the columns drop in a later cleanup.
    registrationDocUrl: text('registration_doc_url'), // RNE — frozen legacy slot
    cinDocUrl: text('cin_doc_url'), // CIN — frozen legacy slot
    // ── bank details (QA-fix lane) — owner payout coordinates, migrated off the dead
    // Supabase business_profiles surface. Free text, nullable: RIB/IBAN format is not
    // constrained here (product ruling pending — route validates required-only).
    bankAccountHolder: text('bank_account_holder'),
    bankRib: text('bank_rib'),
    bankIban: text('bank_iban'),
    // FROZEN (F-docs Commit 1) — same legacy single-slot convention as the two above.
    bankDocUrl: text('bank_doc_url'),
    // Server-stamped on each PATCH /api/profile/bank (money-adjacent audit marker).
    bankDetailsUpdatedAt: timestamp('bank_details_updated_at', { withTimezone: true }),
    onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
    // ── notification preferences (Phase 1c) — columns only this commit; the
    // notify endpoint is Commit 4. Defaults from the legacy schema (inventory §2.2).
    notifyNewsUpdates: boolean('notify_news_updates').notNull().default(false),
    notifyRemindersEvents: boolean('notify_reminders_events').notNull().default(true),
    notifyPromotionsOffers: boolean('notify_promotions_offers').notNull().default(false),
    // ── signup-grows (Phase 1e Commit 2) ──
    // Agent acquisition attribution, captured at signup. Wire name is agent_toodooh (the wizard
    // field); the column is agent_code. STORE-NEW = capture-irreversible-now (distinct from the
    // collect-and-ignore owner-extras): acquisition attribution is lost forever if not captured at
    // signup, so we store it even though the consuming feature is future. Nullable + unvalidated
    // for now — a typed agents reference table + validation arrive with the agent slice. The agent
    // TYPE is implied by role (screencaster↔advertiser / screenhost↔owner), so no agent_type column.
    agentCode: text('agent_code'),
    // Terms-of-service acceptance: server-set to now() when the wizard's terms_accepted boolean is
    // true. The signup route REJECTS (400) if terms are not accepted, so this is set on every new
    // signup. No terms_version (the wizard captures none — inventing one would be fake data); never
    // store a client-supplied timestamp (the server stamps the time).
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    // timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('users_role_idx').on(table.role),
    index('users_status_idx').on(table.status),
    index('users_business_sector_id_idx').on(table.businessSectorId),
    index('users_governorate_id_idx').on(table.governorateId),
    index('users_onboarding_completed_idx').on(table.onboardingCompleted),
    // postal_code is nullable (onboarding fills it; signup doesn't). A CHECK on
    // a nullable column passes on NULL, so it only constrains supplied values.
    check('users_postal_code_valid', sql`${table.postalCode} ~ '^\\d{4}$'`),
    // tax_number is nullable (owners have no matricule at signup — audit §7.2). The
    // lenient CHECK constrains only supplied values (passes on NULL). Route zod still
    // validates non-null at the edge; this is DB-level defense-in-depth.
    check('users_tax_number_valid', sql`${table.taxNumber} ~ '^[A-Za-z0-9/]{7,20}$'`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ── better-auth tables (Commit 2) ──────────────────────────────────────
// better-auth's standard schema is four tables (user/account/session/
// verification). `users` landed in Commit 1; the three below complete it.
// Property names are camelCase (the adapter reads these); DB columns are
// snake_case. The adapter maps user→users, account→accounts,
// session→sessions, verification→verifications.

// account: credential rows (password hash) + future OAuth provider records.
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('accounts_provider_account_idx').on(table.providerId, table.accountId),
    index('accounts_user_id_idx').on(table.userId),
  ],
);

// session: stateful, revocable sessions (handoff §4 — not JWT).
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

// verification: email-verify + password-reset tokens. REQUIRED by the
// locked requireEmailVerification (Commit 2 Q1). No user FK — `identifier`
// is an email/token, and rows can predate a user row.
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;

// ── reference tables (Phase 1c) ────────────────────────────────────────
// Seeded by migration 0003 (hand-appended INSERTs, verbatim from the legacy
// SQL per CF-23). FK targets for the onboarding columns on `users`.

export const governorates = pgTable('governorates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Single table with an `audience` discriminator ('advertiser' | 'owner') —
// collapses the legacy partial-migration residue (the dead 10 generic rows +
// the separate owner_business_sectors view) into the clean target. Validated
// where written (Commit 3 zod); display_order drives the onboarding picker.
export const businessSectors = pgTable('business_sectors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  audience: text('audience').notNull(),
  displayOrder: integer('display_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Campaign-targeting reference data grouped here per the architect's scope;
// full legacy end-state shape (one clean table now beats an ALTER later).
export const predefinedZones = pgTable('predefined_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  latitude: numeric('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: numeric('longitude', { precision: 11, scale: 8 }).notNull(),
  radius: integer('radius').notNull().default(1000),
  isActive: boolean('is_active').notNull().default(true),
  isHot: boolean('is_hot').notNull().default(false),
  imageUrl: text('image_url'),
  country: text('country').notNull().default('Tunisie'),
  region: text('region'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Governorate = typeof governorates.$inferSelect;
export type NewGovernorate = typeof governorates.$inferInsert;
export type BusinessSector = typeof businessSectors.$inferSelect;
export type NewBusinessSector = typeof businessSectors.$inferInsert;
export type PredefinedZone = typeof predefinedZones.$inferSelect;
export type NewPredefinedZone = typeof predefinedZones.$inferInsert;

// Location lifecycle toward the player/CMS export. Mirrors the users.status enum convention
// (lowercase pgEnum, *_status). The export trigger is owner approval (admin.ts); a location starts
// 'pending' and flips to 'exported' (stamping exported_at) once its approved owner is exported.
export const screenhostExportStatus = pgEnum('screenhost_export_status', [
  'pending',
  'exported',
  // S-T1: a B2 push-on-approval attempt that failed (wedooh unreachable / non-2xx). The boot/
  // interval sweep re-pushes 'pending' and 'failed' rows — wedooh's ingest is UUID-idempotent.
  'failed',
]);

// ── screenhosts (Slice-2) ──────────────────────────────────────
// Screenhost-OWNED coordinate-bearing location (one location = one coordinate = one dot on the
// advertiser map; screen_count is metadata, no screens rows). Numeric lat/lng mirror
// predefined_zones (no PostGIS; zone matching is client-side Haversine).
//
// Replaces the repudiated agent-create `establishments` table (CF-19 P0). This slice REDEFINES the
// shape only — it adds NO write path, read endpoint, or signup capture (those are P2/P3). All new
// columns are nullable scaffolding:
//   - owner_id (was screenhost_id): the owning screenhost; app-enforced not-null arrives in P3.
//   - latitude/longitude are nullable here (populated when the owner/admin supplies coordinates in
//     P3); the range checks still hold — they pass on NULL.
//   - wifi_password_encrypted holds app-layer AES-256-GCM ciphertext (encrypt-not-hash; key from
//     env, provisioned later) — stored as text, no crypto wired this slice.
//   - export_status mirrors the users.status enum convention; the export trigger is owner approval.
// created_by is dropped — the approver is audited on users.validated_by, not here.
export const screenhosts = pgTable(
  'screenhosts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    latitude: numeric('latitude', { precision: 10, scale: 8 }),
    longitude: numeric('longitude', { precision: 11, scale: 8 }),
    // Free metadata, NOT screens rows.
    screenCount: integer('screen_count').notNull().default(0),
    address: text('address'),
    city: text('city'),
    postalCode: text('postal_code'),
    governorateId: uuid('governorate_id').references(() => governorates.id, {
      onDelete: 'set null',
    }),
    zone: text('zone'),
    isActive: boolean('is_active').notNull().default(true),
    ownerId: uuid('owner_id').references(() => users.id),
    wifiSsid: text('wifi_ssid'),
    // App-layer AES-256-GCM ciphertext (encrypt-not-hash); no crypto wired this slice.
    wifiPasswordEncrypted: text('wifi_password_encrypted'),
    exportStatus: screenhostExportStatus('export_status').notNull().default('pending'),
    exportedAt: timestamp('exported_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('screenhosts_owner_id_idx').on(table.ownerId),
    index('screenhosts_is_active_idx').on(table.isActive),
    index('screenhosts_governorate_id_idx').on(table.governorateId),
    index('screenhosts_export_status_idx').on(table.exportStatus),
    check('screenhosts_latitude_range', sql`${table.latitude} >= -90 AND ${table.latitude} <= 90`),
    check(
      'screenhosts_longitude_range',
      sql`${table.longitude} >= -180 AND ${table.longitude} <= 180`,
    ),
    check('screenhosts_screen_count_nonneg', sql`${table.screenCount} >= 0`),
  ],
);

export type Screenhost = typeof screenhosts.$inferSelect;
export type NewScreenhost = typeof screenhosts.$inferInsert;

// ── screenhost_affluence (S-T1 — Edge C1) ──────────────────────────────
// wedooh pushes per (screenhost, day-of-week, hour) audience estimates here via
// POST /api/internal/affluence. The FK is to screenhosts.id — the SAME UUID wedooh holds (it
// received it through the B2 transfer), so a 404 on an unknown id is correct integrity, not a
// lookup gap. Latest-value-wins: the ingest upserts on the (screenhost, day, hour) tuple.
export const screenhostAffluence = pgTable(
  'screenhost_affluence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screenhostId: uuid('screenhost_id')
      .notNull()
      .references(() => screenhosts.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(), // 1=Mon … 7=Sun (wedooh's convention)
    hour: integer('hour').notNull(), // 0–23
    estimatedImpressions: integer('estimated_impressions').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('screenhost_affluence_slot_uq').on(table.screenhostId, table.dayOfWeek, table.hour),
    check(
      'screenhost_affluence_day_range',
      sql`${table.dayOfWeek} >= 1 AND ${table.dayOfWeek} <= 7`,
    ),
    check('screenhost_affluence_hour_range', sql`${table.hour} >= 0 AND ${table.hour} <= 23`),
    check('screenhost_affluence_impressions_nonneg', sql`${table.estimatedImpressions} >= 0`),
  ],
);

export type ScreenhostAffluence = typeof screenhostAffluence.$inferSelect;
export type NewScreenhostAffluence = typeof screenhostAffluence.$inferInsert;

// ── agents + agent_referrals (P1 — agent unique codes + referral linkage) ──
// Each agent user (role screenhost_agent | screencast_agent) owns ONE issued
// referral code, held here in `agents.code`. This is the agent's OWN code and
// is distinct from `users.agent_code` (line ~100), which keeps its meaning: the
// raw value a REFERRED user typed at signup. The agent TYPE is implied by the
// owner's role, so no type column lives here.
//
// agent_referrals is the normalized link from a referred signup to the agent
// whose code resolved. It is written ONLY on a compatible match (role rules:
// screenhost_agent ↔ individual_owner/fleet_owner; screencast_agent ↔
// advertiser, which subsumes 'agency' = advertiser + business_type='agency').
// A non-match or role-incompatible match links NOTHING — the signup still
// succeeds and `users.agent_code` still stores the raw entry for admin
// follow-up. agent_code_used preserves the raw entered value for audit.
// Hub-provisioning status of an agent (FX3). Same value set as screenhost_export_status, kept as a
// distinct enum for the agents domain. 'pending' until the first hub push attempt, then 'exported'
// (synced) or 'failed' (hub unreachable / non-2xx) — surfaced (GET /api/admin/agents) so a hub-down
// at create-time never SILENTLY strands the agent. A successful reset/change re-push self-heals
// 'failed' → 'exported'.
export const agentExportStatus = pgEnum('agent_export_status', ['pending', 'exported', 'failed']);

export const agents = pgTable('agents', {
  // One row per agent user; the PK IS the FK (1:1 with users). ON DELETE CASCADE:
  // deleting the agent user removes its issued code.
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
  exportStatus: agentExportStatus('export_status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentReferrals = pgTable(
  'agent_referrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The referring agent. NO ACTION on delete (the default): a referral is an
    // audit fact and must not vanish if the agent user is removed.
    agentUserId: uuid('agent_user_id')
      .notNull()
      .references(() => users.id),
    // UNIQUE — one referring agent per referred user. ON DELETE CASCADE: the link
    // is meaningless once the referred user is gone.
    referredUserId: uuid('referred_user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Raw entered value (post-normalization is NOT applied here — this is the audit
    // trail of exactly what resolved the match).
    agentCodeUsed: text('agent_code_used').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // P2 reads agents' downlines by agent_user_id.
  (table) => [index('agent_referrals_agent_user_id_idx').on(table.agentUserId)],
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type AgentReferral = typeof agentReferrals.$inferSelect;
export type NewAgentReferral = typeof agentReferrals.$inferInsert;

// ── device sessions (MAP M1) ──────────────────────────────────────────────────────────
// Opaque bearer-token auth for the Android TV app (its WebView/OkHttp stack has no cookie
// jar worth trusting — better-auth's cookie sessions stay web-only). Tokens are random
// 32-byte values handed to the device ONCE and stored here HASHED (sha-256) — a DB leak
// exposes no usable token. Access TTL 12h; refresh TTL 90d; a refresh ROTATES both (the
// old pair dies with the rotation, so a replayed refresh token is a loud failure).
// Namespaced under /api/device/auth/* — /api/auth/* belongs to better-auth.
export const deviceSessions = pgTable(
  'device_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessTokenHash: text('access_token_hash').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    deviceType: text('device_type'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The guard's hot path is hash → row; rotation looks up by refresh hash.
    uniqueIndex('device_sessions_access_token_hash_uq').on(table.accessTokenHash),
    uniqueIndex('device_sessions_refresh_token_hash_uq').on(table.refreshTokenHash),
    index('device_sessions_user_id_idx').on(table.userId),
  ],
);

export type DeviceSession = typeof deviceSessions.$inferSelect;
export type NewDeviceSession = typeof deviceSessions.$inferInsert;

// ── screens (MAP M1 commit 2) ─────────────────────────────────────────────────────────
// One row per physical TV/screen under a screenhost. Rows are GENERATED when the owner is
// APPROVED (admin approve hook + the 0014 backfill for already-approved owners):
// screen_count rows per screenhost, named "Écran 1..N" — screenhosts.screen_count stays
// free metadata; this table is what devices pair against. paired_at/last_seen_at are set
// by the TV app's pair call (M1: is_online is derived later from last_seen_at).
export const screens = pgTable(
  'screens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screenhostId: uuid('screenhost_id')
      .notNull()
      .references(() => screenhosts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    pairedAt: timestamp('paired_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('screens_screenhost_id_idx').on(table.screenhostId)],
);

export type Screen = typeof screens.$inferSelect;
export type NewScreen = typeof screens.$inferInsert;

// ── multi-document model (F-docs Commit 1) ────────────────────────────────────────────
// One row per uploaded document, replacing the single-slot users.*_doc_url columns as the
// READ source. Categories: cin (2 named slots — 1=recto, 2=verso), rne (≤2),
// complementaire (≤10), bank (≤1). Caps are enforced at the route (category-dependent —
// not expressible as a simple CHECK). storage_key holds the MinIO KEY (same bucket):
// new uploads use `<category>/<userId>/<rowId>`; backfilled rows keep the legacy
// `<type>/<userId>` keys verbatim (objects never move). The legacy users columns are
// FROZEN (no writers; dropped in a later cleanup once nothing reads them).
// original_filename/mime_type/size_bytes are nullable: backfilled rows don't know them.
export const documentCategory = pgEnum('document_category', [
  'cin',
  'rne',
  'complementaire',
  'bank',
]);

export const userDocuments = pgTable(
  'user_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: documentCategory('category').notNull(),
    position: smallint('position').notNull(),
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One document per slot — same-slot re-upload REPLACES (route updates the row in place).
    uniqueIndex('user_documents_user_category_position_uq').on(
      table.userId,
      table.category,
      table.position,
    ),
    index('user_documents_user_id_idx').on(table.userId),
    check('user_documents_position_min', sql`${table.position} >= 1`),
  ],
);

export type UserDocument = typeof userDocuments.$inferSelect;
export type NewUserDocument = typeof userDocuments.$inferInsert;

// ── campaigns (C1 — advertiser draft lifecycle) ────────────────────────────
// Greenfield campaign entity. The existing 6-step NewCampaign wizard is Supabase-backed; C1
// builds the Drizzle/PG foundation only (no video, targeting, map, owner-approval, or pricing —
// those land in later lanes and add their own columns/tables). One row per advertiser-created
// campaign; advertiser_id is the creator and the owner-scope key for every read/write.
// status mirrors the lowercase *_status enum convention (users.status, screenhost_export_status):
// draft (advertiser editing) → pending (submitted) → active | rejected. submitted_at stamps the
// draft→pending transition. Approval is BIFURCATED and lives elsewhere — an admin validates the
// VIDEO (validation fields on the later videos table) and screenhost owners approve placements via
// campaign_owner_approvals — so a campaign's activation is DERIVED, not a single campaign-level
// admin validation. Hence there are NO validated_by/at/notes columns on campaigns.
export const campaignStatus = pgEnum('campaign_status', ['draft', 'pending', 'active', 'rejected']);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The advertiser who created the campaign — creator/owner for owner-scoped reads + writes.
    advertiserId: uuid('advertiser_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    campaignType: text('campaign_type').notNull(),
    status: campaignStatus('status').notNull().default('draft'),
    // Nullable while a draft; the route enforces presence at submit time in a later lane.
    startDate: date('start_date'),
    endDate: date('end_date'),
    description: text('description'),
    // Links the campaign to ONE advertiser creative (video|photo). Nullable — a draft has no
    // creative yet. onDelete 'set null': deleting a creative must NOT delete the campaign; it falls
    // back to the no-creative state. content_validation_status is DERIVED from the linked creative
    // at read time (L-spot) — there is NO validation column here (bifurcated approval, see above).
    creativeId: uuid('creative_id').references(() => creatives.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('campaigns_advertiser_id_idx').on(table.advertiserId)],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

// ── creatives (L-spot — advertiser creative library + admin moderation) ─────
// Advertiser-OWNED media library, independent of campaigns (renamed from the #54 `videos` table —
// a campaign's creative is VIDEO OR PHOTO per the screencaster WF spec). An advertiser uploads a
// creative (object stored in MinIO under creatives/<advertiserId>/<creativeId>; the KEY lives in
// storage_key); the ADMIN moderates it (validation_status pending → approved | rejected) via the
// admin creative routes, mirroring the user_documents review pattern. A campaign links ONE creative
// via campaigns.creative_id and its content gate is DERIVED at read time as "is the linked creative
// approved" — there is NO content/validation column on campaigns (bifurcated approval).
// Storage model: store the object KEY and presign on read (house pattern, like user_documents) —
// the file is NOT served from a persisted URL.
// creative_type discriminates VIDEO vs PHOTO. duration_seconds is the diffusion duration: a VIDEO's
// length (≤ 30s) or a PHOTO's chosen slot (∈ {10,20,30}). The numeric bound is enforced in the
// upload route (server-side on the stored value); authoritative video-file probing (ffprobe) is a
// later follow-up — the route accepts a client-asserted duration.
export const creativeType = pgEnum('creative_type', ['video', 'photo']);

export const creativeValidationStatus = pgEnum('creative_validation_status', [
  'pending',
  'approved',
  'rejected',
]);

export const creatives = pgTable(
  'creatives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Owner/uploader — creator and owner-scope key for every read/write.
    advertiserId: uuid('advertiser_id')
      .notNull()
      .references(() => users.id),
    // VIDEO or PHOTO. Default 'video' is a migration backstop only — the upload route always sets it.
    creativeType: creativeType('creative_type').notNull().default('video'),
    // Optional display title; nullable (the FE shows the filename).
    title: text('title'),
    // MinIO object key (creatives/<advertiserId>/<creativeId>); presigned on read. NOT a persisted URL.
    storageKey: text('storage_key').notNull(),
    // Diffusion duration in seconds (video ≤ 30; photo ∈ {10,20,30}). Bound enforced in the route.
    durationSeconds: integer('duration_seconds'),
    // Admin moderation state. Default 'pending' — a fresh upload is unmoderated.
    validationStatus: creativeValidationStatus('validation_status').notNull().default('pending'),
    // Admin-validation audit trio — cross-table FK to the moderating admin; nullable until moderated.
    validatedBy: uuid('validated_by').references(() => users.id),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    validationNotes: text('validation_notes'),
    // Upload metadata — nullable, mirroring user_documents.
    originalFilename: text('original_filename'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('creatives_advertiser_id_idx').on(table.advertiserId),
    index('creatives_validation_status_idx').on(table.validationStatus),
  ],
);

export type Creative = typeof creatives.$inferSelect;
export type NewCreative = typeof creatives.$inferInsert;
