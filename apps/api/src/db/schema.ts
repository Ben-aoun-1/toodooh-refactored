import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
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
// Venue tier — REUSED by both a campaign's targeting line (campaign_targeting.class) and a
// screenhost's own class (L-inv eligibility), so a targeting line's class matches a venue's class.
export const targetingClass = pgEnum('targeting_class', ['populaire', 'moyen', 'premium']);

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
    // ── L-inv eligibility (per-venue dispatch inputs for L-disp) ─────────────
    // Per-venue category for matching L-target's category lines. A fleet owner has mixed venues, so
    // this is the venue's OWN sector (not the owner's). FK → business_sectors (owner-audience,
    // validated in the admin route); nullable until an admin sets it.
    businessSectorId: uuid('business_sector_id').references(() => businessSectors.id, {
      onDelete: 'set null',
    }),
    // Venue tier — reuses targeting_class so a targeting line's class matches the venue's class.
    class: targetingClass('class'),
    // CF-Z1 — the venue's predefined zone (FK → zones). Backfilled AND defaulted to Grand Tunis
    // by mig 0040 (signup untouched — the column default carries new venues). Distinct from the
    // legacy free-text `zone` address field above.
    zoneId: uuid('zone_id')
      .references(() => zones.id)
      .default(sql`'2c8e5a1e-4b7d-4f3a-9c6e-1a2b3c4d5e6f'::uuid`),
    // Broadcast operating hours — V1 = one daily window [opening_hour, closing_hour); nullable until
    // set. Per-weekday hours + overnight (closing ≤ opening) semantics are deferred to L-disp.
    openingHour: integer('opening_hour'),
    closingHour: integer('closing_hour'),
    // Broadcast capacity (concurrent spot slots) the dispatcher allocates against; nullable until set.
    broadcastCapacity: integer('broadcast_capacity'),
    // SPS — Screenhost Priority Score (qualité/fiabilité), 0–100. NEUTRAL default 50 for every row;
    // the real computation (TxActivité/TxRespect from proof-of-play) is DEFERRED to L-playout, so in
    // V1 all rows tie on SPS and L-disp falls to the ancienneté tiebreak (correct for V1).
    sps: numeric('sps', { precision: 5, scale: 2 }).notNull().default('50'),
    // ── Lane D demographics — the assigned class's audience ratios (hub-owned) ──
    // Six nullable percentages (0–100; numeric(5,2) like sps), null = never synced. Column names
    // mirror the hub's ratio fields verbatim — they are the C3 wire vocabulary. Written ONLY by
    // the C3 ingest (internal.ts): ratios come from the hub catalog, never from a toodooh admin
    // form, so the shared buildEligibilityPatch has no ratios surface.
    genderMalePct: numeric('gender_male_pct', { precision: 5, scale: 2 }),
    genderFemalePct: numeric('gender_female_pct', { precision: 5, scale: 2 }),
    age17To30Pct: numeric('age_17_30_pct', { precision: 5, scale: 2 }),
    age31To45Pct: numeric('age_31_45_pct', { precision: 5, scale: 2 }),
    age46To60Pct: numeric('age_46_60_pct', { precision: 5, scale: 2 }),
    age60PlusPct: numeric('age_60_plus_pct', { precision: 5, scale: 2 }),
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
    // L-disp filters the eligible pool by venue category — index it.
    index('screenhosts_business_sector_id_idx').on(table.businessSectorId),
    check('screenhosts_latitude_range', sql`${table.latitude} >= -90 AND ${table.latitude} <= 90`),
    check(
      'screenhosts_longitude_range',
      sql`${table.longitude} >= -180 AND ${table.longitude} <= 180`,
    ),
    check('screenhosts_screen_count_nonneg', sql`${table.screenCount} >= 0`),
    check(
      'screenhosts_opening_hour_range',
      sql`${table.openingHour} IS NULL OR (${table.openingHour} >= 0 AND ${table.openingHour} <= 23)`,
    ),
    check(
      'screenhosts_closing_hour_range',
      sql`${table.closingHour} IS NULL OR (${table.closingHour} >= 0 AND ${table.closingHour} <= 23)`,
    ),
    check(
      'screenhosts_broadcast_capacity_pos',
      sql`${table.broadcastCapacity} IS NULL OR ${table.broadcastCapacity} > 0`,
    ),
    check('screenhosts_sps_range', sql`${table.sps} >= 0 AND ${table.sps} <= 100`),
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

// Monthly screenhost stats — the ACTUAL monthly audience the hub pushes (operator ruling: real
// monthly figures, NOT toodooh's rolling weekly affluence average). One row per (screenhost, month);
// the owner downloads a branded PDF report from it. UNIQUE(screenhost, month) → latest-value-wins
// upsert via POST /api/internal/monthly-stats (mirrors the affluence ingest).
export interface MonthlyStatsDaily {
  date: string; // YYYY-MM-DD
  audience: number;
}

export const screenhostMonthlyStats = pgTable(
  'screenhost_monthly_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screenhostId: uuid('screenhost_id')
      .notNull()
      .references(() => screenhosts.id, { onDelete: 'cascade' }),
    month: text('month').notNull(), // 'YYYY-MM'
    totalAudience: integer('total_audience').notNull(),
    daily: jsonb('daily').$type<MonthlyStatsDaily[]>().notNull(), // [{date, audience}] per calendar day
    peakDayOfWeek: integer('peak_day_of_week').notNull(), // 1=Mon … 7=Sun
    peakHour: integer('peak_hour').notNull(), // 0–23
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('screenhost_monthly_stats_sh_month_uq').on(table.screenhostId, table.month),
    check('screenhost_monthly_stats_month_fmt', sql`${table.month} ~ '^\\d{4}-\\d{2}$'`),
    check(
      'screenhost_monthly_stats_peak_dow_range',
      sql`${table.peakDayOfWeek} >= 1 AND ${table.peakDayOfWeek} <= 7`,
    ),
    check(
      'screenhost_monthly_stats_peak_hour_range',
      sql`${table.peakHour} >= 0 AND ${table.peakHour} <= 23`,
    ),
    check('screenhost_monthly_stats_total_nonneg', sql`${table.totalAudience} >= 0`),
  ],
);

export type ScreenhostMonthlyStats = typeof screenhostMonthlyStats.$inferSelect;
export type NewScreenhostMonthlyStats = typeof screenhostMonthlyStats.$inferInsert;

// Stored monthly report artifacts (R1) — one MinIO PDF per (screenhost, month), written by the
// month-end job (reports/<screenhostId>/<YYYY-MM>.pdf); GET /:id/monthly-report serves the stored
// artifact through the api (owner-auth). UNIQUE(screenhost, month) is the job's idempotency lock:
// a second tick (or a concurrent one) can never double-generate a month.
export const screenhostMonthlyReports = pgTable(
  'screenhost_monthly_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screenhostId: uuid('screenhost_id')
      .notNull()
      .references(() => screenhosts.id, { onDelete: 'cascade' }),
    month: text('month').notNull(), // 'YYYY-MM'
    storageKey: text('storage_key').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('screenhost_monthly_reports_sh_month_uq').on(table.screenhostId, table.month),
    check('screenhost_monthly_reports_month_fmt', sql`${table.month} ~ '^\\d{4}-\\d{2}$'`),
  ],
);

export type ScreenhostMonthlyReport = typeof screenhostMonthlyReports.$inferSelect;
export type NewScreenhostMonthlyReport = typeof screenhostMonthlyReports.$inferInsert;

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
// CF-S1 — upcoming/completed become STORED statuses (spec §3.1/3.2): admin approval routes by
// start date (future → upcoming), the lifecycle job flips upcoming→active→completed daily.
export const campaignStatus = pgEnum('campaign_status', [
  'draft',
  'pending',
  'upcoming',
  'active',
  'rejected',
  'completed',
]);

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
    // Advertiser's INDICATIVE budget (TND) from the interim manual cart — NOT the engine inputs. The
    // admin sees it in the review queue and derives i_cible/cpm/s/t at activation (the activation
    // endpoint is unchanged). Nullable; L-price replaces the manual cart with the real cursor.
    requestedBudget: numeric('requested_budget', { precision: 12, scale: 2 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // CF-S1 — the J-3 draft reminder stamp (one reminder per draft; NEVER an auto-delete).
    draftReminderSentAt: timestamp('draft_reminder_sent_at', { withTimezone: true }),
    // Admin moderation audit (activation wiring). activated_at/by stamp the admin approval that flips
    // pending → active (and triggers dispatch); rejected_at/reject_reason stamp a pending → rejected.
    // All nullable — only one branch is ever taken, and a draft/pending campaign has neither set.
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    activatedBy: uuid('activated_by').references(() => users.id),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
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

// ── campaign_targeting (L-target — category × class audience lines) ──────────
// The screencaster builds targeting LINE BY LINE (WS-screencaster spec): each line = a venue
// CATEGORY × a CLASS. category_id references the OWNER business sectors (audience='owner') — the
// venue types a screen sits in; class is the venue tier. ALL ("toutes") is represented as NULL on
// either axis: category_id NULL = all categories, class NULL = all classes, and the NULL/NULL line
// = "tout le réseau" (target everything). The UNIQUE index uses NULLS NOT DISTINCT (PG15+) so NULL
// counts as a value — a line can appear at most once (dedup). Deleting a campaign cascades its lines.
// (the targeting_class enum is declared above screenhosts — it is shared by the venue's class column.)

// ── CF-Z1 — Zones V1 (Grand Tunis) ──────────────────────────────────────────────────────────────
// Predefined geographic zones (VF US-2.1). V1 seeds ONE row ('Grand Tunis', mig 0040) and both
// backfills and DEFAULTS screenhosts.zone_id to it, so today's eligibility behavior is unchanged.
// Future zones arrive as rows (predefined list or map picking — operator decision pending).
// NOTE: screenhosts.zone (free text, signup address sub-form) is UNRELATED legacy — never an FK.
export const zones = pgTable('zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A campaign's targeted zones (replace-set like campaign_targeting). NO rows = whole network on
// the zone criterion (VF US-2.1).
export const campaignZones = pgTable(
  'campaign_zones',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => zones.id),
  },
  (table) => [unique('campaign_zones_pair_unique').on(table.campaignId, table.zoneId)],
);

export const campaignTargeting = pgTable(
  'campaign_targeting',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    // NULL = "toutes les catégories" (ALL). Otherwise an owner business sector (validated in the route).
    categoryId: uuid('category_id').references(() => businessSectors.id),
    // NULL = "toutes les classes" (ALL).
    class: targetingClass('class'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Dedup: one line per (campaign, category, class). NULLS NOT DISTINCT → NULL (ALL) is a value,
    // so e.g. two "Restaurant · toutes classes" lines collide. Backs the server-side 409 dedup check.
    unique('campaign_targeting_line_uq')
      .on(table.campaignId, table.categoryId, table.class)
      .nullsNotDistinct(),
    index('campaign_targeting_campaign_id_idx').on(table.campaignId),
  ],
);

export type CampaignTargeting = typeof campaignTargeting.$inferSelect;
export type NewCampaignTargeting = typeof campaignTargeting.$inferInsert;

// ── dispatch config (L-disp — the calibratable thresholds, wired once) ───────
// Singleton row holding the POC-calibratable thresholds (Youssef's spec §2). S_min and G_jour are
// DERIVED at dispatch time (S_min = seuil_diffusable × CPM ÷ 1000; G_jour = g_mois ÷ jours_actifs)
// and snapshotted onto each plan — NEVER stored denormalized here (they can't drift). F=300s is a
// constant per the spec but kept here so it's wired, not hardcoded in the algorithm.
export const dispatchConfig = pgTable(
  'dispatch_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Singleton guard — a unique constant column ⇒ at most one config row.
    singleton: boolean('singleton').notNull().default(true),
    // SUPERSEDED on the dispatch path (E3, Mariem 2026-07-15): the anti-miette seuil is now
    // VALUE-based — seuilImpressions(cpm) = S_MIN_TND × 1000 ÷ CPM. This column no longer feeds
    // dispatch; it stays for the admin config surface (removal banked).
    seuilDiffusable: integer('seuil_diffusable').notNull(), // min impressions worth airing
    gMois: numeric('g_mois', { precision: 12, scale: 2 }).notNull(), // monthly SH dignity target (TND)
    joursActifs: integer('jours_actifs').notNull(), // divisor for G_jour = g_mois / jours_actifs
    rMinEfficace: integer('r_min_efficace').notNull(), // reps/hr floor (efficient cadence)
    fMaxSeconds: integer('f_max_seconds').notNull().default(300), // F — hourly broadcast cap (s)
    // Admin-editable CPM (TND per 1000 impressions). Used to DERIVE a campaign's I_cible at
    // activation (operator ruling: 15 standard / 30 events). Editable via PATCH
    // /api/admin/dispatch-config; event campaigns price at event_cpm_tnd, all others at
    // standard_cpm_tnd. NOT denormalized onto a plan until it freezes (each plan snapshots cpm).
    standardCpmTnd: numeric('standard_cpm_tnd', { precision: 10, scale: 3 })
      .notNull()
      .default('15.000'),
    eventCpmTnd: numeric('event_cpm_tnd', { precision: 10, scale: 3 }).notNull().default('30.000'),
    // E1 (VF) — the attention index T by spot duration bucket (≤10s / ≤20s / ≤30s). Facturable
    // capacity = Ai × Hi × R × T from E1 on; the planning back-conversion divides by the SAME T.
    // Admin-editable within (0, 1] and t_10s ≤ t_20s ≤ t_30s (a longer spot holds attention
    // better, VF legend). Defaults are the VF canonical 0,60/0,70/0,80.
    t10s: numeric('t_10s', { precision: 4, scale: 2 }).notNull().default('0.60'),
    t20s: numeric('t_20s', { precision: 4, scale: 2 }).notNull().default('0.70'),
    t30s: numeric('t_30s', { precision: 4, scale: 2 }).notNull().default('0.80'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('dispatch_config_singleton_uq').on(table.singleton)],
);

export type DispatchConfig = typeof dispatchConfig.$inferSelect;

// ── frozen dispatch plan (L-disp A.7 — PlanDiffusion, irrevocable) ───────────
// One plan per campaign (unique campaign_id). Snapshots the inputs (I_cible/CPM/S/T) + the wired
// seuils (seuil_diffusable, S_min, G_jour, F, R_min_efficace) at build time, plus the OUTPUTS of
// SÉLECTION + validation (couvert, N_min, N_max, N retained) and the two clôture flags.
// EN_ATTENTE is the NEW default (allocations await the screenhost owner's accept/reject before they
// can air): the playout airability gate already requires ACCEPTE, so EN_ATTENTE/REFUSE simply don't
// air. EN_ATTENTE is listed FIRST (not appended) so drizzle-kit emits a transaction-safe enum
// recreate (rename-old + create-new + alter-column + drop-old) rather than an `ALTER TYPE ... ADD
// VALUE` + `SET DEFAULT <new value>` pair — the latter trips Postgres's "unsafe use of new value"
// when both run in one transaction against an already-migrated DB (drizzle runs all pending
// migrations in a single transaction).
export const dispatchAcceptation = pgEnum('dispatch_acceptation', [
  'EN_ATTENTE',
  'ACCEPTE',
  'REFUSE',
]);

export type DispatchAcceptation = (typeof dispatchAcceptation.enumValues)[number];

export const campaignDispatchPlan = pgTable(
  'campaign_dispatch_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    // Frozen inputs (pricing supplies I_cible/CPM/S/T later; synthetic for now).
    iCible: integer('i_cible').notNull(),
    cpm: numeric('cpm', { precision: 10, scale: 3 }).notNull(),
    sSpotSeconds: integer('s_spot_seconds').notNull(),
    tTierCoef: numeric('t_tier_coef', { precision: 4, scale: 3 }).notNull(),
    // Wired-seuils snapshot (A.7) — what this plan was built against. E3 (amendment): since E3
    // seuil_diffusable snapshots the DERIVED value-based threshold seuilImpressions(cpm) — still
    // exactly "the min impressions worth airing for THIS plan" — no longer the config value.
    seuilDiffusable: integer('seuil_diffusable').notNull(),
    sMin: numeric('s_min', { precision: 14, scale: 4 }).notNull(),
    gJour: numeric('g_jour', { precision: 14, scale: 4 }).notNull(),
    fMaxSeconds: integer('f_max_seconds').notNull(),
    rMinEfficace: integer('r_min_efficace').notNull(),
    // Outputs.
    couvert: integer('couvert').notNull(),
    nMin: integer('n_min').notNull(),
    nMax: integer('n_max').notNull(),
    nRetenus: integer('n_retenus').notNull(),
    isPartial: boolean('is_partial').notNull().default(false), // clôture 1 (advertiser alert)
    isTooThin: boolean('is_too_thin').notNull().default(false), // clôture 2 (renvoi curseur)
    // E3 (amendment) — the sub-seuil uncovered remainder, STORED (« stocké ») in facturable
    // impressions for the redispatch (E6) to add to its own remaining loss. Fed at freeze time
    // (buildPlan.reliquatStocke) and grown by the refusal cascade's sub-seuil shortfalls.
    reliquatStocke: integer('reliquat_stocke').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('campaign_dispatch_plan_campaign_uq').on(table.campaignId)],
);

export type CampaignDispatchPlan = typeof campaignDispatchPlan.$inferSelect;

// A.7 créneau — one broadcastable (date, hour) with planned reps + potential impressions. Stored as
// JSON per allocation (the frozen plan is written once + read back whole; no per-créneau querying).
export interface DispatchCreneau {
  date: string; // ISO calendar date YYYY-MM-DD
  hour: number; // 0–23
  reps: number; // R_i for the hour
  impressions: number; // potential impressions for the slot (affluence × reps)
}

export const campaignDispatchAllocation = pgTable(
  'campaign_dispatch_allocation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => campaignDispatchPlan.id, { onDelete: 'cascade' }),
    screenhostId: uuid('screenhost_id')
      .notNull()
      .references(() => screenhosts.id),
    iiPotentiel: integer('ii_potentiel').notNull(), // a_i — impressions allocated to this SH
    rI: integer('r_i').notNull(), // reps/hr planned at this SH
    revenuPrevisionnel: numeric('revenu_previsionnel', { precision: 14, scale: 4 }).notNull(),
    statutAcceptation: dispatchAcceptation('statut_acceptation').notNull().default('EN_ATTENTE'),
    creneaux: jsonb('creneaux').$type<DispatchCreneau[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campaign_dispatch_allocation_plan_sh_uq').on(table.planId, table.screenhostId),
    index('campaign_dispatch_allocation_plan_id_idx').on(table.planId),
    index('campaign_dispatch_allocation_screenhost_id_idx').on(table.screenhostId),
  ],
);

export type CampaignDispatchAllocation = typeof campaignDispatchAllocation.$inferSelect;

// ── redispatch rounds (E6 — the rattrapage audit trail) ──────────────────────
// One row per EXECUTED rattrapage round (a round is only recorded when it changed state: placed
// volume and/or consumed stored reliquat). The ledger makes the detector STATELESS: net missed =
// gross missed − Σ prior rounds' missed-sourced placements (placed_fact − reliquat_consumed_fact),
// so a re-tick with no new proofs never double-counts. Also E4's future TxActivité input.
// Facturable integers throughout (the plan's billing unit); the physical per-SH detail lives in
// the JSONB snapshots.
export interface RedispatchMissedFrom {
  screenhost_id: string;
  slots: number; // elapsed-undelivered slot count at round time
  imp_physical: number; // Σ physical impressions of those slots
}

export interface RedispatchPlacedTo {
  screenhost_id: string;
  added_fact: number; // facturable share placed onto this screenhost this round
  merged: boolean; // true = absorbed into an existing allocation (re-consent), false = new row
}

export const campaignRedispatchRounds = pgTable(
  'campaign_redispatch_rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => campaignDispatchPlan.id, { onDelete: 'cascade' }),
    roundTs: timestamp('round_ts', { withTimezone: true }).notNull().defaultNow(),
    // Stored-reliquat facturable volume this round consumed (reliquat-FIRST attribution: a
    // placement consumes the stored crumb before the missed volume, so the crumb rides the first
    // material round; placed_fact − reliquat_consumed_fact = the missed-sourced placement the NET
    // reconciliation deducts).
    reliquatConsumedFact: integer('reliquat_consumed_fact').notNull().default(0),
    missedFact: integer('missed_fact').notNull(), // NET missed facturable targeted this round
    missedFrom: jsonb('missed_from').$type<RedispatchMissedFrom[]>().notNull(),
    placedFact: integer('placed_fact').notNull(),
    placedTo: jsonb('placed_to').$type<RedispatchPlacedTo[]>().notNull(),
    residualFact: integer('residual_fact').notNull(), // V − placed (waits for reconcile / later ticks)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('campaign_redispatch_rounds_campaign_id_idx').on(table.campaignId)],
);

export type CampaignRedispatchRound = typeof campaignRedispatchRounds.$inferSelect;

// ── recharges + wallet (L-wallet — manual/offline top-up) ───────────────────
// A screencaster (the `advertiser` role) tops up their wallet by BANK TRANSFER — there is NO online
// gateway (operator ruling 2026-06-27, "fake money"/manual). The flow: POST /api/recharges creates a
// PENDING recharge + a human invoice `reference`, and a FACTURE (invoice PDF) becomes downloadable;
// the advertiser wires the amount; an ADMIN confirms receipt (→ 'confirmed', crediting the balance)
// or rejects it (→ 'rejected', with a reason). status mirrors the lowercase *_status enum convention.
//
// The wallet BALANCE is DERIVED, not stored — it is SUM(amount_tnd) over the caller's 'confirmed'
// recharges. There is deliberately NO wallet_balance row: the recharges ledger is the single source
// of truth, so the idempotent admin re-confirm can never double-credit (re-confirming an already-
// confirmed row is a no-op on the SUM). DEBITS (campaign spend) need pricing and are DEFERRED — the
// balance seam is credited(confirmed) − debited(0 today); a future debit ledger subtracts its own
// SUM at the same point (lib/recharges.ts walletBalance). confirmed_by/at audit the confirming admin.
export const rechargeStatus = pgEnum('recharge_status', ['pending', 'confirmed', 'rejected']);

export const recharges = pgTable(
  'recharges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The topping-up advertiser (screencaster) — creator and owner-scope key for every read/write.
    advertiserId: uuid('advertiser_id')
      .notNull()
      .references(() => users.id),
    // Amount in Tunisian dinars; money-adjacent → numeric (exact), never float. The route validates
    // > 0 with at most 2 decimals; the CHECK is DB-level defense-in-depth. SUM(...) stays exact.
    amountTnd: numeric('amount_tnd', { precision: 12, scale: 2 }).notNull(),
    status: rechargeStatus('status').notNull().default('pending'),
    // Human invoice reference printed on the facture (derived from the id at creation, FCT-XXXXXXXX).
    // UNIQUE — it is the advertiser-facing handle the operator reconciles a bank transfer against.
    reference: text('reference').notNull().unique(),
    // Admin confirm/reject audit. confirmed_by/at are stamped on confirm; reject_reason on reject.
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('recharges_advertiser_id_idx').on(table.advertiserId),
    index('recharges_status_idx').on(table.status),
    check('recharges_amount_positive', sql`${table.amountTnd} > 0`),
  ],
);

export type Recharge = typeof recharges.$inferSelect;
export type NewRecharge = typeof recharges.$inferInsert;

// ── proof_of_play (L-playout — the proof-of-play / billing substrate) ────────
// The TV player reports VIDEO_STARTED / VIDEO_ENDED over the screen WebSocket; each is resolved to
// its (campaign, creative) for the screen's screenhost and recorded here. VIDEO_ENDED carries
// played_duration_ms — the binary "it aired" proof the spec values for L-redisp reconciliation.
// video_id_as_sent is the playlist entry id we sent the player (V1 = the campaign id). event_ts is
// the player's client timestamp (nullable); received_at is server-stamped.
export const proofOfPlayEvent = pgEnum('proof_of_play_event', ['VIDEO_STARTED', 'VIDEO_ENDED']);

export const proofOfPlay = pgTable(
  'proof_of_play',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // ON DELETE RESTRICT on every FK: proof_of_play is BILLING EVIDENCE — deleting a screen /
    // screenhost / campaign / creative must NOT destroy the proof it aired. The referenced row can't
    // be deleted while proof exists (retain-as-evidence; a real teardown archives proof first).
    screenId: uuid('screen_id')
      .notNull()
      .references(() => screens.id, { onDelete: 'restrict' }),
    screenhostId: uuid('screenhost_id')
      .notNull()
      .references(() => screenhosts.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    creativeId: uuid('creative_id')
      .notNull()
      .references(() => creatives.id, { onDelete: 'restrict' }),
    videoIdAsSent: text('video_id_as_sent').notNull(),
    eventType: proofOfPlayEvent('event_type').notNull(),
    playedDurationMs: integer('played_duration_ms'), // null for VIDEO_STARTED; set on VIDEO_ENDED
    eventTs: timestamp('event_ts', { withTimezone: true }), // player client timestamp (nullable)
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('proof_of_play_screenhost_id_idx').on(table.screenhostId),
    index('proof_of_play_campaign_id_idx').on(table.campaignId),
    index('proof_of_play_screen_id_idx').on(table.screenId),
    check(
      'proof_of_play_duration_nonneg',
      sql`${table.playedDurationMs} IS NULL OR ${table.playedDurationMs} >= 0`,
    ),
  ],
);

export type ProofOfPlay = typeof proofOfPlay.$inferSelect;

// ── reconciliation + the money ledger (L-redisp, Youssef §B) ─────────────────
// At campaign clôture, reconcile what the frozen plan PROMISED vs what proof_of_play shows actually
// AIRED: value the shortfall (manquement) on the POTENTIAL, settle the Screencaster wallet, and
// record each Screenhost's earnings. ONE campaign_reconciliation row per campaign (unique) — that
// uniqueness is the idempotency guard: a re-reconcile 409s and can never double-debit/refund/pay.
//
// VALUATION (V1): delivery is measured by RATIO, not per-créneau time-match — the V1 player LOOPS the
// playlist (no per-créneau scheduling) and proof event_ts is a nullable client clock, so a proof
// can't be safely attributed to a specific planned (date,hour). delivery_ratio = min(1,
// delivered_plays / expected_plays) applied to ii_potentiel. delivered_plays = VIDEO_ENDED proofs for
// (campaign, screenhost); expected_plays = Σ créneau.reps. See lib/reconcile/valuation.ts.
//
// MONEY (V1 = bill-the-delivered, B.4): p_perte = manquement_imp × cpm/1000; refund = p_perte ≥ s_min
// ? p_perte : 0 (a sub-S_min gap is RÉUSSIE, NOT refunded — negligible by design); spend = budget −
// refund where budget = expected_imp × cpm/1000. The wallet nets spend (credited − Σ spend). Snapshot
// cpm + s_min come from campaign_dispatch_plan — never recomputed. NO pre-debit at activation (the
// reserve-vs-bill decision is pricing-coupled — flagged, deferred).
export const reconciliationStatus = pgEnum('reconciliation_status', ['reussie', 'partial']);

export const campaignReconciliation = pgTable('campaign_reconciliation', {
  id: uuid('id').primaryKey().defaultRandom(),
  // One reconciliation per campaign — UNIQUE → idempotent (re-reconcile 409s, no double settle).
  campaignId: uuid('campaign_id')
    .notNull()
    .unique()
    .references(() => campaigns.id, { onDelete: 'restrict' }),
  expectedImp: integer('expected_imp').notNull(), // Σ ii_potentiel (promised potential)
  deliveredImp: integer('delivered_imp').notNull(), // Σ per-SH delivered (ratio × ii_potentiel)
  manquementImp: integer('manquement_imp').notNull(), // expected − delivered
  pPerteTnd: numeric('p_perte_tnd', { precision: 14, scale: 4 }).notNull(), // manquement × cpm/1000
  refundTnd: numeric('refund_tnd', { precision: 14, scale: 4 }).notNull(), // p_perte ≥ s_min ? p_perte : 0
  spendTnd: numeric('spend_tnd', { precision: 14, scale: 4 }).notNull(), // budget − refund (the net debit)
  status: reconciliationStatus('status').notNull(),
  reconciledBy: uuid('reconciled_by').references(() => users.id), // the admin who triggered
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignReconciliation = typeof campaignReconciliation.$inferSelect;

// Per-(campaign, screenhost) payout breakdown: delivered vs expected + the earnings PAYABLE (its
// delivered_imp × cpm/1000 — NOTHING on the undiffused part). The actual bank payout is manual/ops;
// this only RECORDS the payable.
export const campaignScreenhostPayout = pgTable(
  'campaign_screenhost_payout',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reconciliationId: uuid('reconciliation_id')
      .notNull()
      .references(() => campaignReconciliation.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    screenhostId: uuid('screenhost_id')
      .notNull()
      .references(() => screenhosts.id, { onDelete: 'restrict' }),
    expectedImp: integer('expected_imp').notNull(), // ii_potentiel
    deliveredImp: integer('delivered_imp').notNull(),
    earningsTnd: numeric('earnings_tnd', { precision: 14, scale: 4 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campaign_screenhost_payout_recon_sh_uq').on(
      table.reconciliationId,
      table.screenhostId,
    ),
    index('campaign_screenhost_payout_screenhost_id_idx').on(table.screenhostId),
  ],
);

export type CampaignScreenhostPayout = typeof campaignScreenhostPayout.$inferSelect;

// ── notifications (in-app notification ledger) ───────────────────────────────
// A per-user notification feed (greenfield — NOT the parked feat/remaining-gaps backend). Rows are
// created server-side by producers (e.g. the dispatch producer notifies each allocated screenhost
// owner "Campagne en attente de votre acceptation"); the owner/advertiser bell reads them via
// GET /api/notifications (session-user-scoped) and marks them read via POST /:id/read (sets
// read_at). `type` is a free-text discriminator the FE maps to an icon/label — kept un-enumerated
// so new producers add types without a migration. campaign_id is nullable (not every notification
// is campaign-bound); ON DELETE set null preserves the notification record if its campaign is
// removed. user_id cascade: a deleted user's notifications go with them. Indexed on user_id (the
// only query axis — the feed read filters by the session user).
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notifications_user_id_idx').on(table.userId)],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
