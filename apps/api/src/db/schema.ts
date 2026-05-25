import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
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
]);

export const userStatus = pgEnum('user_status', ['pending', 'approved', 'rejected']);

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
    registrationDocUrl: text('registration_doc_url'), // RNE — Commit 4 upload
    cinDocUrl: text('cin_doc_url'), // CIN — Commit 4 upload
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
