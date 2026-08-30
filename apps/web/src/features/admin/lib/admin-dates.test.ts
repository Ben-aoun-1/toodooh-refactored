import { describe, expect, it } from 'vitest';

import { formatAdminDate, formatAdminDateTime } from './admin-dates';

describe('admin-dates', () => {
  it('renders an ISO instant as a French day / day-time', () => {
    // parseISO keeps the local zone; use a date-only + a naive local time so the machine zone
    // cannot move the rendered day.
    expect(formatAdminDate('2026-08-30')).toBe('30/08/2026');
    expect(formatAdminDateTime('2026-08-30T13:05:00')).toBe('30/08/2026 13:05');
  });

  it('renders « — » for an unparsable value instead of « Invalid Date »', () => {
    expect(formatAdminDate('not-a-date')).toBe('—');
    expect(formatAdminDateTime('')).toBe('—');
  });
});
