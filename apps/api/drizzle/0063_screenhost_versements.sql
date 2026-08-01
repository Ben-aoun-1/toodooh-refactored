CREATE TYPE "public"."screenhost_facture_action" AS ENUM('valider', 'refuser', 'marquer_payee', 'paper_payee');--> statement-breakpoint
CREATE TABLE "screenhost_facture_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facture_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" "screenhost_facture_action" NOT NULL,
	"motif" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screenhost_versements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facture_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"designation" text NOT NULL,
	"montant_ttc" numeric(14, 4) NOT NULL,
	"mode_label_masked" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "screenhost_versements_facture_id_unique" UNIQUE("facture_id")
);
--> statement-breakpoint
ALTER TABLE "screenhost_factures" ADD COLUMN "refusal_motif" text;--> statement-breakpoint
ALTER TABLE "screenhost_facture_actions" ADD CONSTRAINT "screenhost_facture_actions_facture_id_screenhost_factures_id_fk" FOREIGN KEY ("facture_id") REFERENCES "public"."screenhost_factures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenhost_facture_actions" ADD CONSTRAINT "screenhost_facture_actions_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenhost_versements" ADD CONSTRAINT "screenhost_versements_facture_id_screenhost_factures_id_fk" FOREIGN KEY ("facture_id") REFERENCES "public"."screenhost_factures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenhost_versements" ADD CONSTRAINT "screenhost_versements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenhost_versements" ADD CONSTRAINT "screenhost_versements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screenhost_facture_actions_facture_id_idx" ON "screenhost_facture_actions" USING btree ("facture_id");--> statement-breakpoint
CREATE INDEX "screenhost_versements_user_id_idx" ON "screenhost_versements" USING btree ("user_id");