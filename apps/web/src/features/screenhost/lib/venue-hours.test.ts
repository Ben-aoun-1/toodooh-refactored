import { describe, expect, it, vi } from 'vitest';

// The service module builds on apiClient — stubbed: only the pure H2 helpers are under test.
vi.mock('@/lib/api-client', () => ({ apiClient: {} }));

import {
  DELETE_HOURS_CONFIRM,
  HOUR_OPTIONS,
  HOURS_CLEARED_TOAST,
  HOURS_ORDER_HINT,
  HOURS_SAVED_TOAST,
  NO_HOURS_EXPLANATION,
  NO_HOURS_LABEL,
  clearHoursPatch,
  hoursSummary,
  isValidHoursWindow,
  saveHoursPatch,
} from './venue-hours';

// H2 — the owner « Horaires d'ouverture » editor's pure logic + pinned copy (no render harness).
// The selects/validation are H1's, re-exported so signup and this editor can never drift.

describe('hoursSummary (the card render states)', () => {
  it('a set window renders « HH:00 – HH:00 »', () => {
    expect(hoursSummary(8, 22)).toBe('08:00 – 22:00');
    expect(hoursSummary(0, 23)).toBe('00:00 – 23:00');
  });

  it('no hours (either null) renders the null state', () => {
    expect(hoursSummary(null, null)).toBeNull();
    expect(hoursSummary(8, null)).toBeNull();
    expect(hoursSummary(null, 22)).toBeNull();
  });
});

describe('save + clear flows (the PATCH bodies)', () => {
  it('save sends the full pair', () => {
    expect(saveHoursPatch(8, 22)).toEqual({ opening_hour: 8, closing_hour: 22 });
  });

  it('clear sends BOTH null (the API clears-to-no-hours contract)', () => {
    expect(clearHoursPatch()).toEqual({ opening_hour: null, closing_hour: null });
  });
});

describe('validation surfacing (H1 rule, re-exported)', () => {
  it('accepts a valid window, rejects unordered/equal/out-of-range', () => {
    expect(isValidHoursWindow(8, 22)).toBe(true);
    expect(isValidHoursWindow(22, 8)).toBe(false);
    expect(isValidHoursWindow(8, 8)).toBe(false);
    expect(isValidHoursWindow(-1, 22)).toBe(false);
    expect(isValidHoursWindow(8, 24)).toBe(false);
  });

  it('the H1 hour selects are reused — 24 options, 00:00 … 23:00', () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toEqual({ value: 0, label: '00:00' });
    expect(HOUR_OPTIONS[23]).toEqual({ value: 23, label: '23:00' });
  });
});

describe('pinned French copy', () => {
  it('the honest no-hours state + its consequence line', () => {
    expect(NO_HOURS_LABEL).toBe('Aucun horaire défini');
    expect(NO_HOURS_EXPLANATION).toBe(
      'Sans horaires, la heatmap du rapport reste hachurée et le lieu est inéligible aux campagnes.',
    );
  });

  it('the clear confirm repeats the consequence', () => {
    expect(DELETE_HOURS_CONFIRM).toBe(
      'Supprimer les horaires ? Le lieu redeviendra inéligible aux campagnes et sa heatmap restera hachurée.',
    );
  });

  it('the order hint mirrors the API rule; the toasts', () => {
    expect(HOURS_ORDER_HINT).toBe("L'heure d'ouverture doit précéder l'heure de fermeture.");
    expect(HOURS_SAVED_TOAST).toBe('Horaires enregistrés');
    expect(HOURS_CLEARED_TOAST).toBe('Horaires supprimés');
  });
});
