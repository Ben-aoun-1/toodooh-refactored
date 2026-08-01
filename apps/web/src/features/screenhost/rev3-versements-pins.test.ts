import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// REV3 — the source pins. apps/web has no render harness, so what a component renders is asserted
// by scanning it. Comments are stripped first: the headers explain WHY a status is absent, and
// saying so must not be what trips the pin.

const WEB_SRC = join(__dirname, '..', '..');
const FEATURES = join(WEB_SRC, 'features');

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const read = (...p: string[]): string => stripComments(readFileSync(join(FEATURES, ...p), 'utf8'));

const OWNER_SURFACES = [
  ['screenhost', 'components', 'OwnerVersementsSlot.tsx'],
  ['screenhost', 'components', 'OwnerFactureDepositSlot.tsx'],
  ['screenhost', 'pages', 'OwnerFacturesPage.tsx'],
  ['screenhost', 'pages', 'OwnerFactureDetailPage.tsx'],
  ['screenhost', 'services', 'versements.service.ts'],
];

describe('REV3 — §5 still holds: the admin pill is the ONLY status in the product', () => {
  it('no owner surface renders a facture status value', () => {
    for (const parts of OWNER_SURFACES) {
      const src = read(...parts);
      for (const status of ['emise', 'en_verification', 'en_paiement', 'refusee', 'payee']) {
        expect(src).not.toContain(status);
      }
    }
  });

  it('the versements surface shows the four columns, and offers NO action and NO filter', () => {
    const slot = read('screenhost', 'components', 'OwnerVersementsSlot.tsx');
    for (const column of ['Désignation', 'Montant', 'Date', 'Mode de versement']) {
      expect(slot).toContain(column);
    }
    // A versement is a closed fact: nothing to open, nothing in progress, nothing to filter.
    expect(slot).not.toContain('Voir');
    expect(slot).not.toContain('Télécharger');
    expect(slot).not.toContain('<select');
    expect(slot).not.toContain('Filtrer');
  });

  it('the versements section sits BELOW the deposit slot on Mes Revenus', () => {
    const revenue = read('screenhost', 'pages', 'OwnerRevenue.tsx');
    const deposit = revenue.indexOf('<OwnerFactureDepositSlot />');
    const versements = revenue.indexOf('<OwnerVersementsSlot />');
    expect(deposit).toBeGreaterThan(-1);
    expect(versements).toBeGreaterThan(deposit);
    expect(versements).toBeLessThan(revenue.indexOf('Dernières transactions'));
  });

  it('THE ADMIN pill is the exception, and it is admin-side', () => {
    const admin = read('admin', 'pages', 'ScreenhostFactureManagement.tsx');
    expect(admin).toContain('factureStatutChip');
    expect(admin).toContain('Statut');
  });
});

describe('REV3 — no bank coordinates reach any owner-readable surface', () => {
  it('no owner surface references a RIB or an IBAN field', () => {
    for (const parts of OWNER_SURFACES) {
      const src = read(...parts);
      for (const forbidden of ['bank_rib', 'bank_iban', 'bankRib', 'bankIban']) {
        expect(src).not.toContain(forbidden);
      }
    }
    // The mode reaches the screen ONLY as the frozen masked label.
    expect(read('screenhost', 'components', 'OwnerVersementsSlot.tsx')).toContain(
      'mode_label_masked',
    );
  });
});

describe('REV3 — the six facture notification types are all mapped', () => {
  it('three new + three kept, none dropped', () => {
    const hook = readFileSync(
      join(FEATURES, 'screenhost', 'hooks', 'useOwnerNotifications.ts'),
      'utf8',
    );
    for (const type of [
      'screenhost_facture_ready',
      'screenhost_facture_deposited',
      'reversement_statement_ready',
      'screenhost_facture_validated',
      'screenhost_facture_refused',
      'screenhost_facture_paid',
    ]) {
      expect(hook).toContain(type);
    }
  });
});

describe('REV3 — the admin surface is reachable', () => {
  it('the route and the nav entry both exist', () => {
    const app = readFileSync(join(WEB_SRC, 'App.tsx'), 'utf8');
    expect(app).toContain('path="/admin-screenhost-factures"');
    expect(app).toContain('ScreenhostFactureManagement');
    const layout = readFileSync(join(FEATURES, 'admin', 'components', 'AdminLayout.tsx'), 'utf8');
    expect(layout).toContain("navigate('/admin-screenhost-factures')");
    expect(layout).toContain('Factures Screenhost');
  });
});
