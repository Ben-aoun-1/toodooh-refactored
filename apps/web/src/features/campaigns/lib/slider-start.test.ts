import { describe, expect, it } from 'vitest';

import { minutesStartAtMax, sliderStartAtMax } from './slider-start';

describe('sliders start at their maximum', () => {
  it('an unchosen budget starts at the maximum once it is known', () => {
    expect(sliderStartAtMax(null, 36656.8, 0)).toBe(36656.8);
    expect(sliderStartAtMax(null, undefined, 0)).toBeNull();
  });

  it('never overwrites a chosen value', () => {
    expect(sliderStartAtMax(15619, 36656.8, 0)).toBeNull();
  });

  it('zero inventory leaves the slider empty', () => {
    expect(sliderStartAtMax(null, 0, 0)).toBeNull();
  });

  it('minutes start on the largest whole number of seats', () => {
    expect(minutesStartAtMax(null, 9, 2)).toBe(8);
    expect(minutesStartAtMax(null, 7, 1)).toBe(7);
    expect(minutesStartAtMax(null, 1, 2)).toBeNull();
    expect(minutesStartAtMax(4, 9, 2)).toBeNull();
    expect(minutesStartAtMax(null, undefined, 2)).toBeNull();
  });
});
