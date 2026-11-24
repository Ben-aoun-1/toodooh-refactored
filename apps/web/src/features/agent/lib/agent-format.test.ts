import { describe, expect, it } from 'vitest';

import { vfCountAt, vfCountTarget, vfNum, vfPct, vfTnd } from './agent-format';

describe('agent VF formats', () => {
  it('separates thousands with a thin space', () => {
    expect(vfNum(11808)).toBe('11 808');
    expect(vfNum(755)).toBe('755');
  });

  it('writes three decimals only when the amount has decimals', () => {
    expect(vfTnd(12)).toBe('12 TND');
    expect(vfTnd(0)).toBe('0 TND');
    expect(vfTnd(2.48)).toBe('2,480 TND');
    expect(vfTnd(1520.5)).toBe('1 520,500 TND');
    expect(vfTnd(0.0004)).toBe('0 TND');
    expect(vfTnd(null)).toBe('–');
    expect(vfTnd(undefined)).toBe('–');
  });

  it('writes an empty rate as a dash', () => {
    expect(vfPct(80)).toBe('80 %');
    expect(vfPct(null)).toBe('–');
  });

  it('animates only plain positive integers', () => {
    expect(vfCountTarget('11 808')).toBe(11808);
    expect(vfCountTarget('0')).toBeNull();
    expect(vfCountTarget('–')).toBeNull();
    expect(vfCountTarget('2,480 TND')).toBeNull();
  });

  it('eases a counter out from 0 to its value', () => {
    expect(vfCountAt(1000, 0)).toBe('0');
    expect(vfCountAt(1000, 0.5)).toBe('875');
    expect(vfCountAt(1000, 1)).toBe('1 000');
  });
});
