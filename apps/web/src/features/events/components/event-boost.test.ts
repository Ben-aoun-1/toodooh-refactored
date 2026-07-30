import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BOOST_POSITIONING_SUCCESS,
  BOOST_POSITIONING_TITLE,
  FROZEN_AXES_NOTE,
  eventBoostReasonFr,
} from './BoostPositioningModal';

// EV6 — the positioning booster's surface + the route rider, pinned at source level (these pages
// have no render harness — the ev1-pins idiom).

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the booster copies (ONE home)', () => {
  it('names the action, the success and the FROZEN axes', () => {
    expect(BOOST_POSITIONING_TITLE).toBe('Booster le positionnement');
    expect(BOOST_POSITIONING_SUCCESS).toBe(
      'Positionnement boosté — les nouveaux établissements attendent leur accord.',
    );
    expect(FROZEN_AXES_NOTE).toContain('fixés par le match');
    expect(FROZEN_AXES_NOTE).toContain('seules les zones');
  });

  it('speaks every api refusal in French', () => {
    const err = (code: string) => ({ body: { error: code } });
    expect(eventBoostReasonFr(err('NO_ADDITION'))).toContain('au moins une nouvelle zone');
    expect(eventBoostReasonFr(err('ZONE_ALREADY_TARGETED'))).toContain('déjà couverte');
    expect(eventBoostReasonFr(err('BUDGET_EXCEEDS_CMAX'))).toContain(
      'inventaire encore disponible',
    );
    expect(eventBoostReasonFr(err('INSUFFICIENT_BALANCE'))).toContain('Solde insuffisant');
    expect(eventBoostReasonFr(err('NO_ELIGIBLE'))).toContain('Aucun établissement éligible');
    expect(eventBoostReasonFr(err('NOT_BOOSTABLE'))).toContain('à venir ou actif');
    expect(eventBoostReasonFr(err('UNKNOWN'))).toBeNull();
  });
});

describe('the ZONES-ONLY surface', () => {
  const modal = read('./BoostPositioningModal.tsx');

  it('offers zones and a budget — and NO frozen axis control', () => {
    expect(modal).toContain('Zones à ajouter');
    expect(modal).toContain('Budget complémentaire');
    // The three frozen axes never become inputs.
    expect(modal).not.toMatch(/added_category_ids|new_end_date|setNewEndDate|creative/i);
    // The recap shows the match read-only, padlocked.
    expect(modal).toContain('Lock');
    expect(modal).toContain('FROZEN_AXES_NOTE');
  });

  it('EXCLUDES the zones the positioning already covers, and bounds the slider', () => {
    expect(modal).toContain('!existingZoneIds.includes(z.id)');
    expect(modal).toContain('min={CAMPAIGN_BUDGET_FLOOR_TND}');
    expect(modal).toContain('max={Math.max(CAMPAIGN_BUDGET_FLOOR_TND, ceiling)}');
    // The apply is gated on the live ceiling, never on a stale one.
    expect(modal).toContain('amount <= ceiling');
  });

  it('the api wire carries the two inputs only', () => {
    const api = read('../services/event-boost.api.ts');
    expect(api).toContain('added_zone_ids');
    expect(api).toContain('amount_tnd');
    // The frozen axes never become WIRE FIELDS (the file's prose names them to explain the
    // absence, so the pin reads the payload keys, not the comments).
    const payloadKeys = [...api.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]);
    expect(payloadKeys.sort()).toEqual(['added_zone_ids', 'added_zone_ids', 'amount_tnd']);
  });
});

describe('the gating matrix + the rider', () => {
  it('Booster reaches À venir / Active positionings through their OWN modal', () => {
    const page = read('../../campaigns/pages/MyCampaigns.tsx');
    expect(page).toContain('BoostPositioningModal');
    expect(page).toContain('setBoostPositioningTarget');
    // The EV3 blanket hide is gone: the gate is now the status rule, then the binding routes it.
    expect(page).not.toContain('!campaign.event_id && canBoostCampaign');
    expect(page).toContain('canBoostCampaign(campaign.status)');
    // The campaign modal is still mounted beside it, untouched.
    expect(page).toContain('BoostCampaignModal');
  });

  it('THE RIDER: the Événements route + nav admit admin and screenhost_agent', () => {
    const app = read('../../../App.tsx');
    expect(app).toMatch(
      /path="\/admin-events"[\s\S]{0,400}requiredRoles=\{\['superadmin', 'admin', 'screenhost_agent'\]\}/,
    );
    const layout = read('../../admin/components/AdminLayout.tsx');
    expect(layout).toContain(
      "(role === 'superadmin' || role === 'admin' || role === 'screenhost_agent')",
    );
    // …and the guard itself honours a route that NAMES a non-admin role (its hardcoded
    // admin-only gate ran BEFORE requiredRoles and would have bounced the agent).
    const guard = read('../../admin/components/AdminRoute.tsx');
    expect(guard).toContain('explicitlyAllowed');
    expect(guard).toContain('!isAdmin && !explicitlyAllowed');
  });

  it('the settled positioning’s venue lines need NO web change (the E7 panel has no source filter)', () => {
    const queue = read('../../admin/pages/CampaignReviewQueue.tsx');
    // The existing E7 reversement panel reads by campaign id — a positioning IS a campaign row.
    expect(queue).toContain('useCampaignReversements');
    expect(queue).toContain('reversements.lines');
  });
});
