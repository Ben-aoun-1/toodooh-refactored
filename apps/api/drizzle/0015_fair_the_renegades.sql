CREATE TYPE "public"."document_category" AS ENUM('cin', 'rne', 'complementaire', 'bank');--> statement-breakpoint
CREATE TABLE "user_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "document_category" NOT NULL,
	"position" smallint NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text,
	"mime_type" text,
	"size_bytes" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_documents_position_min" CHECK ("user_documents"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_documents_user_category_position_uq" ON "user_documents" USING btree ("user_id","category","position");--> statement-breakpoint
CREATE INDEX "user_documents_user_id_idx" ON "user_documents" USING btree ("user_id");--> statement-breakpoint
-- BACKFILL (same migration — F-docs Commit 1): every populated single-slot users column
-- becomes a user_documents row at position 1, keeping the EXISTING storage key verbatim —
-- no MinIO objects move. original_filename/mime_type/size_bytes stay NULL (the legacy
-- columns never recorded them). The users columns are KEPT and FROZEN (readers move to
-- this table now; the columns drop in a later cleanup). Idempotent: ON CONFLICT on the
-- (user_id, category, position) unique index no-ops on re-run.
INSERT INTO "user_documents" ("user_id", "category", "position", "storage_key")
SELECT "id", 'cin'::"document_category", 1, "cin_doc_url" FROM "users" WHERE "cin_doc_url" IS NOT NULL
UNION ALL
SELECT "id", 'rne'::"document_category", 1, "registration_doc_url" FROM "users" WHERE "registration_doc_url" IS NOT NULL
UNION ALL
SELECT "id", 'bank'::"document_category", 1, "bank_doc_url" FROM "users" WHERE "bank_doc_url" IS NOT NULL
ON CONFLICT ("user_id", "category", "position") DO NOTHING;
