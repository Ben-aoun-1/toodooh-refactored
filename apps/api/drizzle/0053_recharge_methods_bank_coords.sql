CREATE TYPE "public"."recharge_method" AS ENUM('virement', 'bon_de_commande');--> statement-breakpoint
ALTER TYPE "public"."recharge_status" ADD VALUE 'bon_issued';--> statement-breakpoint
ALTER TYPE "public"."recharge_status" ADD VALUE 'bon_returned';--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "bank_rib" text DEFAULT '—' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "bank_iban" text DEFAULT '—' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "bank_bic" text DEFAULT '—' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_config" ADD COLUMN "bank_domiciliation" text DEFAULT '—' NOT NULL;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "method" "recharge_method";--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "bon_key" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "signed_bon_key" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "signed_bon_mime" text;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "signed_bon_deposited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recharges" ADD COLUMN "cancelled_at" timestamp with time zone;