import { describe, expect, it } from 'vitest';

import { screencasterSignupDocuments } from './signup-documents';

// DOC-CAST1 — the screencaster « Documents » step's picks, as the signup payload carries them.
const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });

describe('screencasterSignupDocuments (DOC-CAST1)', () => {
  const rneFiles = [pdf('rne-1.pdf'), pdf('rne-2.pdf')];
  const complementaireFiles = [pdf('comp-1.pdf')];

  it('carries EVERY pick of an advertiser — not just the first RNE', () => {
    const docs = screencasterSignupDocuments({
      profileType: 'advertiser',
      rneFiles,
      complementaireFiles,
      addLater: false,
    });
    expect(docs.rne_docs?.map((f) => f.name)).toEqual(['rne-1.pdf', 'rne-2.pdf']);
    expect(docs.complementaire_docs?.map((f) => f.name)).toEqual(['comp-1.pdf']);
  });

  it('an agency is a screencaster too', () => {
    const docs = screencasterSignupDocuments({
      profileType: 'agency',
      rneFiles,
      complementaireFiles,
      addLater: false,
    });
    expect(docs.rne_docs).toHaveLength(2);
    expect(docs.complementaire_docs).toHaveLength(1);
  });

  it('« J’ajouterai mes documents plus tard » carries no file, whatever was picked', () => {
    expect(
      screencasterSignupDocuments({
        profileType: 'advertiser',
        rneFiles,
        complementaireFiles,
        addLater: true,
      }),
    ).toEqual({ rne_docs: [], complementaire_docs: [] });
  });

  it('an owner carries none — its volets travel as registration_doc / bank_doc', () => {
    for (const profileType of ['individual_owner', 'fleet_owner'] as const) {
      expect(
        screencasterSignupDocuments({
          profileType,
          rneFiles,
          complementaireFiles,
          addLater: false,
        }),
      ).toEqual({});
    }
  });
});
