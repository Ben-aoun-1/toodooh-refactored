import { describe, expect, it } from 'vitest';

import { userLabel } from '../src/lib/user-label.js';

// ADM-FIX1 (review round) — the label rule is coalesce(business_name, contact_name, email, id).
// Each step's fixture blanks EVERY earlier field, so a test that passes for the wrong reason (an
// earlier field silently winning) is impossible.

const ID = '11111111-1111-1111-1111-111111111111';

describe('userLabel', () => {
  it('prefers a non-blank business_name', () => {
    expect(
      userLabel({
        id: ID,
        businessName: 'Acme SARL',
        contactName: 'Jane Doe',
        email: 'jane@example.com',
      }),
    ).toBe('Acme SARL');
  });

  it('falls through a NULL business_name to contact_name', () => {
    expect(
      userLabel({ id: ID, businessName: null, contactName: 'Jane Doe', email: 'jane@example.com' }),
    ).toBe('Jane Doe');
  });

  it('falls through a BLANK (whitespace-only) business_name to contact_name', () => {
    expect(
      userLabel({
        id: ID,
        businessName: '   ',
        contactName: 'Jane Doe',
        email: 'jane@example.com',
      }),
    ).toBe('Jane Doe');
  });

  it('falls through business_name AND a blank contact_name to email (the bug this pins)', () => {
    expect(
      userLabel({ id: ID, businessName: null, contactName: '  ', email: 'jane@example.com' }),
    ).toBe('jane@example.com');
    expect(
      userLabel({ id: ID, businessName: '', contactName: '', email: 'jane@example.com' }),
    ).toBe('jane@example.com');
  });

  it('falls all the way through to the caller-supplied id when every name AND the email are blank', () => {
    expect(userLabel({ id: ID, businessName: null, contactName: '  ', email: '  ' })).toBe(ID);
    expect(userLabel({ id: ID, businessName: '', contactName: '', email: '' })).toBe(ID);
  });

  it('never returns an empty string', () => {
    const label = userLabel({ id: ID, businessName: null, contactName: '', email: '' });
    expect(label.length).toBeGreaterThan(0);
  });
});
