-- PISTES-V2 (operator 2026-10-12) — the S07 Piste 02 « Repérez vos angles morts », generated ONCE
-- per completed month and stored: the page and the PDF show the stored piste of the last complete
-- month, and the rows are the history the next month's generation rotates on (lever family,
-- title, créneaux cités — spec §9.8). hypothese_formulee is internal traceability, never shown.
CREATE TABLE "screenhost_pistes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screenhost_id" uuid NOT NULL,
	"month" text NOT NULL,
	"statut" text NOT NULL,
	"titre" text,
	"corps" text NOT NULL,
	"famille_levier" text,
	"creneaux_cites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hypothese_formulee" text,
	"confiance" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenhost_pistes_month_fmt" CHECK ("screenhost_pistes"."month" ~ '^\d{4}-\d{2}$'),
	CONSTRAINT "screenhost_pistes_statut" CHECK ("screenhost_pistes"."statut" IN ('genere', 'degrade', 'insuffisant')),
	CONSTRAINT "screenhost_pistes_famille" CHECK ("screenhost_pistes"."famille_levier" IS NULL OR "screenhost_pistes"."famille_levier" ~ '^[A-H]$'),
	CONSTRAINT "screenhost_pistes_confiance" CHECK ("screenhost_pistes"."confiance" IS NULL OR "screenhost_pistes"."confiance" IN ('haute', 'moyenne', 'faible'))
);
--> statement-breakpoint
ALTER TABLE "screenhost_pistes" ADD CONSTRAINT "screenhost_pistes_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "screenhost_pistes_sh_month_uq" ON "screenhost_pistes" USING btree ("screenhost_id","month");
