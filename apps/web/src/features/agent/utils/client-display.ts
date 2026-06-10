import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

import type {
  AgentClient,
  AgentClientScreenhost,
} from '@/features/agent/services/agent-clients.service';

/**
 * P2 — pure view-model for the referred-clients list. The display rule is "show everything
 * GET /api/agent/clients returns" (tax_number and wifi_ssid included when present); rows for
 * absent values are omitted rather than rendered empty. Documents are absent from the payload by
 * API design — there is deliberately no document row here. Kept DOM-free so the rendering logic
 * is unit-testable under the web suite's node environment.
 */
export interface DisplayRow {
  label: string;
  value: string;
}

/** Resolves a governorate/sector UUID to its display name. */
export type ReferenceLookup = ReadonlyMap<string, string>;

const PROFILE_TYPE_LABELS: Record<string, string> = {
  individual_owner: 'Propriétaire Individuel',
  fleet_owner: 'Propriétaire Flotte',
  advertiser: 'Annonceur',
  agency: 'Agence',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  approved: 'Approuvé',
  rejected: 'Rejeté',
};

export function profileTypeLabel(profileType: string | null): string {
  return (profileType !== null && PROFILE_TYPE_LABELS[profileType]) || 'Inconnu';
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Card title: business name, falling back to contact name, then email. */
export function clientDisplayName(client: AgentClient): string {
  return client.business_name ?? client.contact_name ?? client.email;
}

export function formatClientDate(isoDate: string): string {
  return format(parseISO(isoDate), 'd MMMM yyyy', { locale: fr });
}

const push = (rows: DisplayRow[], label: string, value: string | null | undefined): void => {
  if (value !== null && value !== undefined && value !== '') rows.push({ label, value });
};

const yesNo = (value: boolean): string => (value ? 'Oui' : 'Non');

/** "street, postal code city" from whichever address parts are present. */
const composeAddress = (
  street: string | null,
  postalCode: string | null,
  city: string | null,
): string | null => {
  const locality = [postalCode, city].filter(Boolean).join(' ');
  const full = [street, locality].filter(Boolean).join(', ');
  return full || null;
};

/**
 * The label/value rows of one client card — every payload field that is present, in display
 * order. `governorates`/`sectors` resolve the reference UUIDs to names (raw id is never shown;
 * an unresolvable id falls back to omission, matching the absent-value rule).
 */
export function clientDetailRows(
  client: AgentClient,
  governorates: ReferenceLookup,
  sectors: ReferenceLookup,
): DisplayRow[] {
  const rows: DisplayRow[] = [];
  push(rows, 'Email', client.email);
  push(rows, 'Email vérifié', yesNo(client.email_verified));
  push(rows, 'Inscription complétée', yesNo(client.onboarding_completed));
  push(rows, 'Contact', client.contact_name);
  push(rows, 'Téléphone', client.contact_phone);
  push(rows, 'Fonction', client.fonction);
  push(rows, 'Matricule fiscal', client.tax_number);
  push(
    rows,
    'Secteur d’activité',
    client.business_sector_id !== null ? sectors.get(client.business_sector_id) : null,
  );
  push(rows, 'Adresse', composeAddress(client.street_address, client.postal_code, client.city));
  push(
    rows,
    'Gouvernorat',
    client.governorate_id !== null ? governorates.get(client.governorate_id) : null,
  );
  push(rows, 'Zone', client.zone);
  push(rows, 'Code agent utilisé', client.agent_code_used);
  push(rows, 'Inscrit le', formatClientDate(client.created_at));
  return rows;
}

/** The label/value rows of one screenhost (location) block — wifi password is never in the payload. */
export function screenhostDetailRows(
  location: AgentClientScreenhost,
  governorates: ReferenceLookup,
): DisplayRow[] {
  const rows: DisplayRow[] = [];
  push(rows, 'Adresse', composeAddress(location.address, location.postal_code, location.city));
  push(
    rows,
    'Gouvernorat',
    location.governorate_id !== null ? governorates.get(location.governorate_id) : null,
  );
  push(rows, 'Zone', location.zone);
  if (location.latitude !== null && location.longitude !== null) {
    push(rows, 'Coordonnées', `${location.latitude}, ${location.longitude}`);
  }
  push(rows, 'Nombre d’écrans', String(location.screen_count));
  push(rows, 'WiFi (SSID)', location.wifi_ssid);
  push(rows, 'Ajouté le', formatClientDate(location.created_at));
  return rows;
}

/** Builds the id→name lookup from a reference list (governorates / business sectors). */
export function toReferenceLookup(
  items: ReadonlyArray<{ id: string; name: string }> | undefined,
): ReferenceLookup {
  return new Map((items ?? []).map((item) => [item.id, item.name]));
}
