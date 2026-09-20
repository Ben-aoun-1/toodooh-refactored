// ADM-FIX1 — French labels for the raw wire values the admin campaign surfaces used to print as-is
// (`standard` / `event` under a campaign name, `EN_ATTENTE` / `ACCEPTE` / `REFUSE` in the event
// allocations table). Unknown values fall through UNCHANGED rather than being swallowed into a
// wrong label: an operator must be able to see a value the map does not know.

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  standard: 'Standard',
  event: 'Événement',
};

/**
 * The campaign's kind, in French. The BINDING wins: a campaign carrying an `event_id` IS a
 * positioning (EV3), whatever its `campaign_type` string says.
 */
export const campaignTypeLabel = (campaign: {
  campaign_type: string;
  event_id: string | null;
}): string =>
  campaign.event_id !== null
    ? 'Événement'
    : (CAMPAIGN_TYPE_LABELS[campaign.campaign_type] ?? campaign.campaign_type);

// The event_allocations.statut CHECK values (schema: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE') — the
// screenhost's answer to a dispatched positioning.
const EVENT_ALLOCATION_STATUT_LABELS: Record<string, string> = {
  EN_ATTENTE: 'En attente',
  ACCEPTE: 'Acceptée',
  REFUSE: 'Refusée',
};

export const eventAllocationStatutLabel = (statut: string): string =>
  EVENT_ALLOCATION_STATUT_LABELS[statut] ?? statut;
