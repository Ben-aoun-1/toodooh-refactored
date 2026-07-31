CREATE TABLE "user_bank_details_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"changed_by" uuid NOT NULL,
	"before_account_holder" text,
	"before_rib" text,
	"before_iban" text,
	"before_bank_document_id" uuid,
	"after_account_holder" text,
	"after_rib" text,
	"after_iban" text,
	"after_bank_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_bank_details_audit" ADD CONSTRAINT "user_bank_details_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bank_details_audit" ADD CONSTRAINT "user_bank_details_audit_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_bank_details_audit_user_id_idx" ON "user_bank_details_audit" USING btree ("user_id");