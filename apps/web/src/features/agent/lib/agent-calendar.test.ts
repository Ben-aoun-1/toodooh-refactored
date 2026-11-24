import { describe, expect, it } from 'vitest';

import {
  CAL_HOURS,
  dayCellClass,
  hourChipState,
  hourToggleMakesAvailable,
  monthTitle,
  selectionLabel,
} from './agent-calendar';

const view = {
  unavailable: ['2026-11-20'],
  unavailable_hours: [
    { day: '2026-11-21', hour: 9 },
    { day: '2026-11-21', hour: 14 },
  ],
};

describe('AGENT-VF — the agent calendar', () => {
  it('offers every hour of the day', () => {
    expect(CAL_HOURS).toHaveLength(24);
    expect(CAL_HOURS[0]).toBe(0);
    expect(CAL_HOURS[23]).toBe(23);
  });

  it('marks an hour off when blocked on every selected day, mix on some', () => {
    expect(hourChipState(view, ['2026-11-20'], 3)).toBe('off');
    expect(hourChipState(view, ['2026-11-20', '2026-11-21'], 9)).toBe('off');
    expect(hourChipState(view, ['2026-11-20', '2026-11-21'], 10)).toBe('mix');
    expect(hourChipState(view, ['2026-11-21', '2026-11-22'], 9)).toBe('mix');
    expect(hourChipState(view, ['2026-11-22'], 9)).toBe('free');
    expect(hourChipState(view, [], 9)).toBe('free');
  });

  it('frees an hour only when it is blocked on every selected day', () => {
    expect(hourToggleMakesAvailable(view, ['2026-11-20', '2026-11-21'], 9)).toBe(true);
    expect(hourToggleMakesAvailable(view, ['2026-11-20', '2026-11-21'], 10)).toBe(false);
    expect(hourToggleMakesAvailable(view, ['2026-11-22'], 9)).toBe(false);
  });

  it('labels the selection and the month', () => {
    expect(selectionLabel(['2026-11-20'])).toBe('20/11/2026');
    expect(selectionLabel(['2026-11-20', '2026-11-21'])).toBe('2 jours sélectionnés');
    expect(monthTitle('2026-11')).toBe('Novembre 2026');
  });

  it('draws each day by its state', () => {
    const sel = ['2026-11-21'];
    expect(dayCellClass(view, '2026-11-10', '2026-11-14', sel)).toBe('d past');
    expect(dayCellClass(view, '2026-11-14', '2026-11-14', sel)).toBe('d today');
    expect(dayCellClass(view, '2026-11-20', '2026-11-14', sel)).toBe('d off');
    expect(dayCellClass(view, '2026-11-21', '2026-11-14', sel)).toBe('d part sel');
    expect(dayCellClass(view, '2026-11-22', '2026-11-14', sel)).toBe('d');
  });
});
