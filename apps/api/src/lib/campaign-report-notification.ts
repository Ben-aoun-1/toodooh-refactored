import type { NewNotification } from '../db/schema.js';

// SC-P epic 2 (US-2.1) — « Votre rapport de clôture de la campagne « X » est prêt ». PURE builder
// returning the insert value (the house idiom: producers db.insert(notifications) themselves).
// Inserted by BOTH settlement paths right after their reconciliation row commits — the clôture
// IS the reconciliation, so the report is ready the instant the row exists. The web bell routes
// this type to « Mes performances » in Campaign mode (actionFor → /my-performance?campaign=id).

export const CAMPAIGN_REPORT_READY_TYPE = 'campaign_report_ready';

export const campaignReportReadyTitle = (campaignName: string): string =>
  `Votre rapport de clôture de la campagne « ${campaignName} » est prêt`;

export const CAMPAIGN_REPORT_READY_BODY =
  'Consultez son analyse détaillée dans « Mes performances » : impressions générées, établissements diffuseurs, heures de diffusion et profil de l’audience.';

/** The screencaster's row for one clôture — insert value for db.insert(notifications). */
export const campaignReportReadyNotification = (campaign: {
  id: string;
  name: string;
  advertiserId: string;
}): NewNotification => ({
  userId: campaign.advertiserId,
  type: CAMPAIGN_REPORT_READY_TYPE,
  title: campaignReportReadyTitle(campaign.name),
  body: CAMPAIGN_REPORT_READY_BODY,
  campaignId: campaign.id,
});
