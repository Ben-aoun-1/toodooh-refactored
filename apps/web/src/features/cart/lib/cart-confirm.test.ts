import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import { cartKeys } from '../hooks/queryKeys';

import {
  CART_WIDGET_Z_CLASS,
  cartReasonFr,
  parseCartConfirmFailure,
  withCartReasonMessage,
} from './cart-confirm';

// CF-C1 — the confirm-refusal parsing + the stacking/caching pins.

const confirmError = (body: unknown): ApiError =>
  new ApiError({ status: 400, code: 'CART_CONFIRM_FAILED', message: 'failed', body });

describe('parseCartConfirmFailure', () => {
  it('extracts per-item reasons and the solde shortfall', () => {
    const failure = parseCartConfirmFailure(
      confirmError({
        error: 'CART_CONFIRM_FAILED',
        items: [{ campaign_id: 'c1', reason: 'MISSING_CREATIVE' }],
        solde: { balance: 100, required: 350 },
      }),
    );
    expect(failure).not.toBeNull();
    expect(failure?.itemReasons.get('c1')).toBe('MISSING_CREATIVE');
    expect(failure?.solde).toEqual({ balance: 100, required: 350 });
  });

  it('solde-only and items-only payloads both parse', () => {
    const soldeOnly = parseCartConfirmFailure(
      confirmError({ items: [], solde: { balance: 10, required: 20 } }),
    );
    expect(soldeOnly?.itemReasons.size).toBe(0);
    expect(soldeOnly?.solde).toEqual({ balance: 10, required: 20 });
    const itemsOnly = parseCartConfirmFailure(
      confirmError({ items: [{ campaign_id: 'c2', reason: 'NOT_DRAFT' }] }),
    );
    expect(itemsOnly?.itemReasons.get('c2')).toBe('NOT_DRAFT');
    expect(itemsOnly?.solde).toBeNull();
  });

  it('anything else is not a confirm failure', () => {
    expect(parseCartConfirmFailure(new Error('network'))).toBeNull();
    expect(
      parseCartConfirmFailure(new ApiError({ status: 400, code: 'CART_EMPTY', message: 'empty' })),
    ).toBeNull();
    expect(parseCartConfirmFailure(null)).toBeNull();
  });
});

describe('cartReasonFr — every api gate code speaks French', () => {
  it.each([
    'NOT_DRAFT',
    'MISSING_DATES',
    'INVALID_START_DATE',
    'MISSING_CREATIVE',
    'MISSING_BUDGET',
    'BUDGET_BELOW_MINIMUM',
    'BUDGET_EXCEEDS_CMAX',
    'NOT_FOUND',
    // CF-HF3 — the CF-SK1 approved-skip refusal codes were unmapped and said nothing useful.
    'CONTENT_NOT_APPROVED',
    'NO_DURATION',
    'BUDGET_TOO_LOW',
    'INSUFFICIENT_BALANCE',
  ])('%s has a dedicated message', (code) => {
    expect(cartReasonFr(code)).not.toBe(cartReasonFr('SOMETHING_UNKNOWN'));
  });

  it('CPM-3 — a confirm that raced a CPM change asks to confirm again', () => {
    expect(cartReasonFr('CPM_CHANGED')).toBe(
      'Le CPM de cette campagne vient de changer — confirmez de nouveau.',
    );
  });

  it('unknown codes get the generic fallback', () => {
    expect(cartReasonFr('???')).toBe('Cette campagne n’est plus lançable.');
  });
});

describe('withCartReasonMessage — an add refusal reads as its reason (Mariem 04/11)', () => {
  const refusal = (code: string) =>
    new ApiError({
      status: 400,
      code,
      message: "La campagne n'est pas prête pour le panier.",
      body: { error: code },
    });

  it('a known gate code: its French line, the code, status and body kept', () => {
    const out = withCartReasonMessage(refusal('MISSING_CREATIVE'));
    expect(out).toBeInstanceOf(ApiError);
    const err = out as ApiError;
    expect(err.message).toBe('Aucun spot n’est associé à cette campagne.');
    expect(err.code).toBe('MISSING_CREATIVE');
    expect(err.status).toBe(400);
    expect(err.body).toEqual({ error: 'MISSING_CREATIVE' });
  });

  it('an unknown code, or not an api refusal: the error passes through untouched', () => {
    const unknown = refusal('SOMETHING_ELSE');
    expect(withCartReasonMessage(unknown)).toBe(unknown);
    const plain = new Error('réseau');
    expect(withCartReasonMessage(plain)).toBe(plain);
    // An inherited key is no gate code.
    const proto = refusal('toString');
    expect(withCartReasonMessage(proto)).toBe(proto);
  });

  // Every code routes/cart.ts's add gate can answer (cartGateVerdict + the 404) has its line.
  it.each([
    'NOT_DRAFT',
    'MISSING_DATES',
    'INVALID_START_DATE',
    'MISSING_CREATIVE',
    'SPOT_QR_FAILED',
    'MISSING_BUDGET',
    'BUDGET_BELOW_MINIMUM',
    'EVENT_ANNULE',
    'EVENT_MINUTES_STEP',
    'BUDGET_EXCEEDS_CMAX',
    'BUDGET_BELOW_VENUE_MINIMUM',
    'NOT_FOUND',
  ])('the add gate code %s reads as its own reason', (code) => {
    const out = withCartReasonMessage(refusal(code)) as ApiError;
    expect(out.message).not.toBe("La campagne n'est pas prête pour le panier.");
    expect(out.message).toBe(cartReasonFr(code));
  });

  it('DEMO-3 — events are open to demo accounts: the demo refusal is gone', () => {
    expect(cartReasonFr('DEMO_EVENTS_UNAVAILABLE')).toBe('Cette campagne n’est plus lançable.');
  });
});

describe('the stacking + caching pins', () => {
  it('the widget sits BELOW the modal layer (z-40 < z-50 drawers/dialogs < z-[90] bell)', () => {
    expect(CART_WIDGET_Z_CLASS).toBe('z-40');
    const widgetZ = Number(CART_WIDGET_Z_CLASS.replace('z-', ''));
    expect(widgetZ).toBeLessThan(50);
  });

  it('ONE cart cache key — the page and the widget share it by construction', () => {
    expect(cartKeys.read()).toEqual(['cart', 'read']);
    expect(cartKeys.read()).toEqual(cartKeys.read());
  });
});
