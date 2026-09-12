-- SUP-1 (Mejri 11/09 point 8, built 2026-09-12). The « Support » and « Prendre rendez-vous » forms
-- toasted « Message envoyé » / « Rendez-vous demandé » and stored NOTHING — no route, no table,
-- nobody told. One row per submission, any authenticated role; the admin handles it from
-- /admin-support and is told by the admin bell (admin_support_message). The support@ mailbox copy
-- rides SUPPORT_MAILBOX when ops create it; until then the row + the bell are the whole channel.
CREATE TYPE "support_kind" AS ENUM ('support', 'appointment');
--> statement-breakpoint
CREATE TYPE "support_status" AS ENUM ('new', 'handled');
--> statement-breakpoint
CREATE TABLE "support_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" "support_kind" NOT NULL,
  "objective" text NOT NULL,
  "other_detail" text,
  "message" text,
  "appointment_date" date,
  "status" "support_status" DEFAULT 'new' NOT NULL,
  "handled_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "handled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_messages_appointment_date_kind" CHECK (("kind" = 'appointment') = ("appointment_date" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "support_messages_status_idx" ON "support_messages" ("status");
--> statement-breakpoint
CREATE INDEX "support_messages_user_id_idx" ON "support_messages" ("user_id");
