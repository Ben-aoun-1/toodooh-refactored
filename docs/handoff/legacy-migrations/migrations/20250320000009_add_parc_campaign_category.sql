-- Add 'parc' value to campaign_category enum for Parc TV campaigns
ALTER TYPE campaign_category ADD VALUE IF NOT EXISTS 'parc';
