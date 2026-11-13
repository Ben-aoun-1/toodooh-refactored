-- DISP-TOURS Q1 (Mariem, 03/11/2026: « ok ») — a standard campaign is frozen and its places
-- reserved at « Lancer » even while its spot awaits the admin's validation. Its allocations wait
-- as RESERVE: they hold their hours (the occupancy counts every status but REFUSE) yet are not
-- proposed to the owners — no owner sees, nor is told of, a campaign whose spot is not validated.
-- The validation turns them EN_ATTENTE (and tells each owner); a refusal deletes the plan.
-- The value is only ADDED here, never used in this run (Postgres 55P04).
ALTER TYPE "public"."dispatch_acceptation" ADD VALUE IF NOT EXISTS 'RESERVE';
