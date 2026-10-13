-- AGT-5 — the agent appointment calendar (agent specs v1.0 §7): unavailable days, the hub's
-- appointment reasons per agent type (seeded with the specs' initial lists), the appointments
-- with their one-live-request-per-slot guard, and the notification link + appointment ref the
-- bell's actions need.
CREATE TABLE "agent_unavailable_days" (
	"agent_user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_unavailable_days_agent_user_id_day_pk" PRIMARY KEY("agent_user_id","day")
);
--> statement-breakpoint
CREATE TABLE "agent_appointment_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_role" text NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"affiliate_user_id" uuid NOT NULL,
	"screenhost_id" uuid,
	"objective_id" uuid,
	"day" date NOT NULL,
	"hour" integer NOT NULL,
	"message" text,
	"status" text DEFAULT 'en_attente' NOT NULL,
	"proposed_day" date,
	"proposed_hour" integer,
	"cancelled_by" text,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_appointments_status" CHECK ("agent_appointments"."status" in ('en_attente', 'nouvel_horaire', 'confirme', 'annule', 'expire')),
	CONSTRAINT "agent_appointments_hour" CHECK ("agent_appointments"."hour" between 0 and 23)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_unavailable_days" ADD CONSTRAINT "agent_unavailable_days_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD CONSTRAINT "agent_appointments_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD CONSTRAINT "agent_appointments_affiliate_user_id_users_id_fk" FOREIGN KEY ("affiliate_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD CONSTRAINT "agent_appointments_screenhost_id_screenhosts_id_fk" FOREIGN KEY ("screenhost_id") REFERENCES "public"."screenhosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_appointments" ADD CONSTRAINT "agent_appointments_objective_id_agent_appointment_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."agent_appointment_objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_agent_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."agent_appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_appointments_agent_idx" ON "agent_appointments" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "agent_appointments_affiliate_idx" ON "agent_appointments" USING btree ("affiliate_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_appointments_slot_uq" ON "agent_appointments" USING btree ("agent_user_id","day","hour") WHERE "agent_appointments"."status" in ('en_attente', 'nouvel_horaire', 'confirme');--> statement-breakpoint
INSERT INTO "agent_appointment_objectives" ("agent_role", "label", "position") VALUES
	('screencast_agent', 'Découverte de la plateforme', 1),
	('screencast_agent', 'Préparation d''une campagne', 2),
	('screencast_agent', 'Accompagnement sur la création', 3),
	('screencast_agent', 'Lecture des résultats d''une campagne', 4),
	('screencast_agent', 'Autre', 99),
	('screenhost_agent', 'Installation application', 1),
	('screenhost_agent', 'Installation capteur', 2),
	('screenhost_agent', 'Prise en main de mon espace Screenhost', 3),
	('screenhost_agent', 'Accompagnement sur une campagne ou un événement', 4),
	('screenhost_agent', 'Questions sur mes revenus et ma facturation', 5),
	('screenhost_agent', 'Autre', 99);
