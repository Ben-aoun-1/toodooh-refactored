-- Mariem 15/11/2026 — « l'agent doit pouvoir répondre à toutes les campagnes reçues par le Host
-- (quotidiennes, événements et Ramadan) » — and the operator's rule of 14/11, « an acceptance
-- should be final », now for match-night shares too. Who answered an event share:
-- decided_by = 'owner' | 'agent' | 'admin' (NULL = not answered, or answered before this
-- migration — read as the owner's), with the user who answered. decided_at already exists.
ALTER TABLE "event_allocations" ADD COLUMN "decided_by" text;
--> statement-breakpoint
ALTER TABLE "event_allocations" ADD COLUMN "decided_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
