import {
  type AnyPgColumn,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
    name: text('name').notNull(),
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
    // Generic nullable contact field — NOT better-auth's phoneNumber plugin
    // column (that plugin uses `phone_number`). If the plugin is adopted
    // later it adds its own columns and coexists with this one.
    phone: text('phone'),
    // timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('users_role_idx').on(table.role), index('users_status_idx').on(table.status)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
