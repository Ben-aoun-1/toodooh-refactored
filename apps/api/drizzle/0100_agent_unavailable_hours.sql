-- AGT-HOUR1 (Mariem 26/10 point 2: « tous les calendriers… les heures, pas uniquement les jours »)
-- — an agent blocks single appointment HOURS, not only whole days. Whole days stay in
-- agent_unavailable_days; a day with only some of its slot hours blocked has them here.
CREATE TABLE "agent_unavailable_hours" (
	"agent_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"day" date NOT NULL,
	"hour" integer NOT NULL CHECK ("hour" BETWEEN 0 AND 23),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("agent_user_id", "day", "hour")
);
