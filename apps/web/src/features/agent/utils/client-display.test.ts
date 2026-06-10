import { describe, expect, it } from 'vitest';

import type {
  AgentClient,
  AgentClientScreenhost,
} from '@/features/agent/services/agent-clients.service';

import {
  clientDetailRows,
  clientDisplayName,
  profileTypeLabel,
  screenhostDetailRows,
  statusLabel,
  toReferenceLookup,
} from './client-display';

const baseClient: AgentClient = {
  id: 'c1',
  email: 'owner@example.tn',
  email_verified: true,
  role: 'screen_owner',
  status: 'approved',
  onboarding_completed: true,
  profile_type: 'individual_owner',
  contact_name: 'Ali Ben Salah',
  business_name: 'Café El Medina',
  business_type: null,
  tax_number: '1234567/A',
  contact_phone: '+216 20 123 456',
  fonction: 'Gérant',
  business_sector_id: 'sec-1',
  street_address: '12 rue de Marseille',
  city: 'Tunis',
  postal_code: '1001',
  governorate_id: 'gov-1',
  zone: 'Centre ville',
  agent_code_used: 'AGT-SH-0001',
  created_at: '2026-05-01T10:00:00.000Z',
  screenhosts: [],
};

const baseLocation: AgentClientScreenhost = {
  id: 'l1',
  name: 'Café El Medina — salle',
  latitude: '36.80000000',
  longitude: '10.18000000',
  screen_count: 2,
  address: '12 rue de Marseille',
  city: 'Tunis',
  postal_code: '1001',
  governorate_id: 'gov-1',
  zone: 'Centre ville',
  wifi_ssid: 'Medina-Guest',
  is_active: true,
  created_at: '2026-05-02T09:00:00.000Z',
};

const governorates = toReferenceLookup([{ id: 'gov-1', name: 'Tunis' }]);
const sectors = toReferenceLookup([{ id: 'sec-1', name: 'Restauration' }]);

const rowValue = (rows: { label: string; value: string }[], label: string): string | undefined =>
  rows.find((r) => r.label === label)?.value;

describe('clientDetailRows', () => {
  it('renders every present payload field, tax_number included', () => {
    const rows = clientDetailRows(baseClient, governorates, sectors);
    expect(rowValue(rows, 'Email')).toBe('owner@example.tn');
    expect(rowValue(rows, 'Email vérifié')).toBe('Oui');
    expect(rowValue(rows, 'Inscription complétée')).toBe('Oui');
    expect(rowValue(rows, 'Contact')).toBe('Ali Ben Salah');
    expect(rowValue(rows, 'Téléphone')).toBe('+216 20 123 456');
    expect(rowValue(rows, 'Fonction')).toBe('Gérant');
    expect(rowValue(rows, 'Matricule fiscal')).toBe('1234567/A');
    expect(rowValue(rows, 'Secteur d’activité')).toBe('Restauration');
    expect(rowValue(rows, 'Adresse')).toBe('12 rue de Marseille, 1001 Tunis');
    expect(rowValue(rows, 'Gouvernorat')).toBe('Tunis');
    expect(rowValue(rows, 'Zone')).toBe('Centre ville');
    expect(rowValue(rows, 'Code agent utilisé')).toBe('AGT-SH-0001');
    expect(rowValue(rows, 'Inscrit le')).toBe('1 mai 2026');
  });

  it('omits rows for absent values instead of rendering them empty', () => {
    const sparse: AgentClient = {
      ...baseClient,
      tax_number: null,
      contact_phone: null,
      fonction: null,
      business_sector_id: null,
      street_address: null,
      city: null,
      postal_code: null,
      governorate_id: null,
      zone: null,
    };
    const labels = clientDetailRows(sparse, governorates, sectors).map((r) => r.label);
    expect(labels).not.toContain('Matricule fiscal');
    expect(labels).not.toContain('Téléphone');
    expect(labels).not.toContain('Fonction');
    expect(labels).not.toContain('Secteur d’activité');
    expect(labels).not.toContain('Adresse');
    expect(labels).not.toContain('Gouvernorat');
    expect(labels).not.toContain('Zone');
    // The always-present fields survive.
    expect(labels).toContain('Email');
    expect(labels).toContain('Code agent utilisé');
  });

  it('never derives a document row — documents are absent by API design', () => {
    const labels = clientDetailRows(baseClient, governorates, sectors).map((r) =>
      r.label.toLowerCase(),
    );
    expect(labels.some((l) => l.includes('document'))).toBe(false);
  });

  it('omits the reference rows when the id is unresolvable (raw UUID never shown)', () => {
    const rows = clientDetailRows(baseClient, toReferenceLookup([]), toReferenceLookup([]));
    expect(rowValue(rows, 'Gouvernorat')).toBeUndefined();
    expect(rowValue(rows, 'Secteur d’activité')).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain('gov-1');
    expect(JSON.stringify(rows)).not.toContain('sec-1');
  });
});

describe('screenhostDetailRows', () => {
  it('renders the location fields, wifi_ssid included, never a password field', () => {
    const rows = screenhostDetailRows(baseLocation, governorates);
    expect(rowValue(rows, 'Adresse')).toBe('12 rue de Marseille, 1001 Tunis');
    expect(rowValue(rows, 'Gouvernorat')).toBe('Tunis');
    expect(rowValue(rows, 'Coordonnées')).toBe('36.80000000, 10.18000000');
    expect(rowValue(rows, 'Nombre d’écrans')).toBe('2');
    expect(rowValue(rows, 'WiFi (SSID)')).toBe('Medina-Guest');
    expect(rows.map((r) => r.label.toLowerCase()).some((l) => l.includes('mot de passe'))).toBe(
      false,
    );
  });

  it('omits wifi and coordinates when absent', () => {
    const labels = screenhostDetailRows(
      { ...baseLocation, wifi_ssid: null, latitude: null, longitude: null },
      governorates,
    ).map((r) => r.label);
    expect(labels).not.toContain('WiFi (SSID)');
    expect(labels).not.toContain('Coordonnées');
  });
});

describe('labels', () => {
  it('maps profile types to the admin-consistent French labels', () => {
    expect(profileTypeLabel('individual_owner')).toBe('Propriétaire Individuel');
    expect(profileTypeLabel('fleet_owner')).toBe('Propriétaire Flotte');
    expect(profileTypeLabel('advertiser')).toBe('Annonceur');
    expect(profileTypeLabel('agency')).toBe('Agence');
    expect(profileTypeLabel(null)).toBe('Inconnu');
  });

  it('maps statuses and falls back to the raw value', () => {
    expect(statusLabel('pending')).toBe('En attente');
    expect(statusLabel('approved')).toBe('Approuvé');
    expect(statusLabel('rejected')).toBe('Rejeté');
    expect(statusLabel('archived')).toBe('archived');
  });

  it('falls back business_name → contact_name → email for the card title', () => {
    expect(clientDisplayName(baseClient)).toBe('Café El Medina');
    expect(clientDisplayName({ ...baseClient, business_name: null })).toBe('Ali Ben Salah');
    expect(clientDisplayName({ ...baseClient, business_name: null, contact_name: null })).toBe(
      'owner@example.tn',
    );
  });
});
