-- Préférences de notifications pour l'espace annonceur
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS notify_news_updates boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_reminders_events boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_promotions_offers boolean DEFAULT false;
