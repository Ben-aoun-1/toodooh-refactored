// Drizzle schema for @toodooh/api.
//
// Phase 1a Commit 3 ships this empty — the migration pipeline is proven
// with a tables-free initial migration (CREATE EXTENSION postgis only).
//
// Phase 1b adds the first table here:
//   export const users = pgTable('users', { ... })  // role enum: advertiser | owner | admin | superadmin
// At that point this file likely splits into a db/schema/ folder.
export {};
