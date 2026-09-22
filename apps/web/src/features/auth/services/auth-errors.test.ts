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

  // DOC-CAST1 — the signup route refuses a part COUNT with its own code. It used to borrow
  // PAYLOAD_TOO_LARGE, telling a user who sent fifteen small files that one weighed over 5 Mo.
  it('TOO_MANY_FILES speaks of the number of documents, never of 5 Mo', () => {
    const msg = apiErrorMessage(err('TOO_MANY_FILES'));
    expect(msg).toMatch(/Trop de documents/i);
    expect(msg).not.toMatch(/5 Mo/);
    expect(msg).not.toMatch(/réessayer dans quelques instants/);
  });

  // DOC-CAST1 — nginx answers its OWN HTML 413 when the whole multipart signup body exceeds
  // client_max_body_size, so toApiError finds no `error` field and falls back to 'UNKNOWN'. The
  // generic « réessayez dans quelques instants » would invite a retry that can never succeed.
  it('a bodiless 413 (the reverse proxy, not the API) names the documents, not a generic retry', () => {
    const proxied = new ApiError({ status: 413, code: 'UNKNOWN', message: '' });
    const msg = apiErrorMessage(proxied);
    expect(msg).toMatch(/documents sont trop volumineux/i);
    expect(msg).not.toMatch(/réessayer dans quelques instants/);
  });

  // ... while a 413 the API itself wrote keeps its own, more precise wording.
  it('a coded 413 still uses its own message', () => {
    const coded = new ApiError({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: '' });
    expect(apiErrorMessage(coded)).toMatch(/5 Mo/);
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
