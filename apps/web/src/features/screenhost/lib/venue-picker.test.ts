import { describe, expect, it } from 'vitest';

import { venuePickerVisible } from './venue-picker';

// GREEN2 item 5 (ruled) — the picker shows for ANY owner holding 2+ venues; fleet status never
// gates it (the silent venues[0] default was the venue-picker-gap lane's finding).
describe('venuePickerVisible', () => {
  it('hidden at 0 or 1 venue, visible from 2 — regardless of owner type', () => {
    expect(venuePickerVisible(0)).toBe(false);
    expect(venuePickerVisible(1)).toBe(false);
    expect(venuePickerVisible(2)).toBe(true);
    expect(venuePickerVisible(5)).toBe(true);
  });
});
