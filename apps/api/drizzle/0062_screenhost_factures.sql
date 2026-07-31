CREATE TYPE "public"."screenhost_facture_status" AS ENUM('emise', 'en_verification', 'en_paiement', 'refusee', 'payee');--> statement-breakpoint
ALTER TABLE "screenhost_monthly_statements" RENAME TO "screenhost_factures";--> statement-breakpoint
ALTER TABLE "screenhost_factures" DROP CONSTRAINT "screenhost_monthly_statements_reference_unique";--> statement-breakpoint
ALTER TABLE "screenhost_factures" DROP CONSTRAINT "screenhost_monthly_statements_month_fmt";--> statement-breakpoint
ALTER TABLE "screenhost_factures" DROP CONSTRAINT "screenhost_monthly_statements_screenhost_id_screenhosts_id_fk";
--> statement-breakpoint
DROP INDEX "screenhost_monthly_statements_sh_month_uq";--> statement-breakpoint
ALTER TABLE "screenhost_factures" ADD COLUMN "status" "screenhost_facture_status" DEFAULT 'emise' NOT NULL;--> statement-breakpoint
ALTER TABLE "screenhost_factures" ADD COLUMN "signed_file_key" text;--> statement-breakpoint
ALTER TABLE "screenhost_factures" ADD COLUMN "signed_file_mime" text;--> statement-breakpoint
ALTER TABLE "screenhost_factures" ADD COLUMN "deposited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "screenhost_factures" ADD CONSTRAINT "screenhost_factures_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "screenhost_factures_sh_month_uq" ON "screenhost_factures" USING btree ("screenhost_id","month");--> statement-breakpoint
ALTER TABLE "screenhost_factures" ADD CONSTRAINT "screenhost_factures_reference_unique" UNIQUE("reference");--> statement-breakpoint
ALTER TABLE "screenhost_factures" ADD CONSTRAINT "screenhost_factures_month_fmt" CHECK ("screenhost_factures"."month" ~ '^\d{4}-\d{2}$');--> statement-breakpoint
-- REV2 — THE JULY TIMING RULE. Rows written before this migration are LEGACY-FORMAT: a REL-
-- reference and a relevé PDF whose template printed « Part établissement (50 %) … barème de
-- reversement », i.e. the reversement split disclosed on an owner-facing document. They must not
-- survive as factures, so they are deleted and the next sweep re-emits them properly (FS-, the
-- reversed-direction template, no internals).
--
-- Written as a GUARD, not an assumption. The delete refuses any row that has been deposited or has
-- moved past 'emise'. Right now no such row CAN exist — status/deposited_at are created three
-- statements above — but the guard is the point: if this migration is ever re-run, replayed onto a
-- restored snapshot, or reached by a path nobody predicted, it must never destroy a facture a
-- screenhost has already signed and returned, or one that is being paid.
DELETE FROM "screenhost_factures"
WHERE "reference" LIKE 'REL-%'
  AND "deposited_at" IS NULL
  AND "signed_file_key" IS NULL
  AND "status" = 'emise';
