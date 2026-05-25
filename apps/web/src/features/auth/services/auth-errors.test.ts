import { describe, expect, it } from 'vitest';

import { ApiError, type ApiErrorField } from '@/lib/api-client';

import { apiErrorMessage } from './auth-errors';

const err = (code: string, fields?: ApiErrorField[]) =>
  new ApiError({ status: 400, code, message: 'raw', fields });

describe('apiErrorMessage', () => {
  it('maps EMAIL_NOT_VERIFIED to a verify-first message (NOT the generic fallback)', () => {
    const msg = apiErrorMessage(err('EMAIL_NOT_VERIFIED'));
    expect(msg).toMatch(/vérifier votre adresse email/i);
    expect(msg).not.toMatch(/réessayer dans quelques instants/);
  });

  it('maps known codes to distinct French messages', () => {
    expect(apiErrorMessage(err('INVALID_CREDENTIALS'))).toBe('Email ou mot de passe incorrect.');
    expect(apiErrorMessage(err('UNAUTHENTICATED'))).toMatch(/session a expiré/i);
    expect(apiErrorMessage(err('TAX_NUMBER_TAKEN'))).toMatch(/matricule fiscal/i);
    expect(apiErrorMessage(err('PAYLOAD_TOO_LARGE'))).toMatch(/5 Mo/);
    expect(apiErrorMessage(err('STORAGE_ERROR'))).toMatch(/stockage/i);
    expect(apiErrorMessage(err('INVALID_TOKEN'))).toMatch(/lien/i);
    expect(apiErrorMessage(err('NETWORK'))).toMatch(/connexion/i);
  });

  it('includes the first field in an INVALID_INPUT message', () => {
    const msg = apiErrorMessage(err('INVALID_INPUT', [{ field: 'email', reason: 'requis' }]));
    expect(msg).toContain('email');
    expect(msg).toContain('requis');
  });

  it('falls back to a generic message for unknown codes and non-ApiError values', () => {
    expect(apiErrorMessage(err('SOMETHING_NEW'))).toMatch(/réessayer dans quelques instants/);
    expect(apiErrorMessage(new Error('boom'))).toMatch(/réessayer dans quelques instants/);
    expect(apiErrorMessage('nope')).toMatch(/réessayer dans quelques instants/);
  });
});
