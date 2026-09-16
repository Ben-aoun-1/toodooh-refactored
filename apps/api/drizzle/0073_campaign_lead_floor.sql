-- LEAD-1 (Mejri 15/09 point 1, built 2026-09-16). « Je peux toujours sélectionner la date
-- d'aujourd'hui » — prod ran with campaign_lead_working_days = 0 (a field-test calibration set on
-- 2026-08-05), which collapsed the start floor to TODAY. The platform now never honours a lead
-- below 1 (lib/campaign-dates MIN_CAMPAIGN_LEAD_WORKING_DAYS, the admin PATCH refuses 0); this
-- lifts a stored 0 to 1 so the admin page shows the lead that is actually applied.
UPDATE "dispatch_config" SET "campaign_lead_working_days" = 1 WHERE "campaign_lead_working_days" < 1;
