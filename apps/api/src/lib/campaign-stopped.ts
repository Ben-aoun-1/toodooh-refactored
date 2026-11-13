import { type SQL, isNull } from 'drizzle-orm';

import { campaigns } from '../db/schema.js';

// Mariem 05/11 — a campaign a superadmin stopped (lib/campaign-stop) is out of the owners' hands:
// its shares still waiting for an answer are neither shown, noticed nor decidable any more. ONE
// home for that predicate, read by every owner-facing path on event shares.
export const notStoppedCampaignSql = (): SQL => isNull(campaigns.stoppedAt);
