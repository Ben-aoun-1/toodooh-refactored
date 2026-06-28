-- Add EN_ATTENTE to dispatch_acceptation AND make it the column default, transaction-safely.
-- drizzle-kit's default emit (`ALTER TYPE ... ADD VALUE 'EN_ATTENTE'` + `SET DEFAULT 'EN_ATTENTE'`)
-- trips Postgres's "unsafe use of new value" when both statements run in ONE transaction against a
-- DB where the enum type was committed by an EARLIER transaction (i.e. any already-migrated env —
-- prod). drizzle runs all pending migrations in a single transaction, so we instead RECREATE the
-- type: a type created within the current transaction may have its values used in that same
-- transaction. Result is identical on a fresh DB and an incrementally-migrated one.
-- dispatch_acceptation is used by exactly one column (campaign_dispatch_allocation.statut_acceptation).
ALTER TABLE "campaign_dispatch_allocation" ALTER COLUMN "statut_acceptation" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."dispatch_acceptation" RENAME TO "dispatch_acceptation_old";--> statement-breakpoint
CREATE TYPE "public"."dispatch_acceptation" AS ENUM('EN_ATTENTE', 'ACCEPTE', 'REFUSE');--> statement-breakpoint
ALTER TABLE "campaign_dispatch_allocation" ALTER COLUMN "statut_acceptation" SET DATA TYPE "public"."dispatch_acceptation" USING "statut_acceptation"::text::"public"."dispatch_acceptation";--> statement-breakpoint
ALTER TABLE "campaign_dispatch_allocation" ALTER COLUMN "statut_acceptation" SET DEFAULT 'EN_ATTENTE';--> statement-breakpoint
DROP TYPE "public"."dispatch_acceptation_old";
