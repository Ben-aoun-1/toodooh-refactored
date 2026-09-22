import { asc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { authPlugin } from '../src/auth/plugin.js';
import { db, sql } from '../src/db/client.js';
import { businessSectors, governorates, userDocuments, users } from '../src/db/schema.js';
import { MAX_DOCUMENT_BYTES, isRowOwnedKey } from '../src/lib/user-documents.js';
import { apiRoutes } from '../src/routes/index.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { type MultipartFile, signupMultipart } from './helpers/signup-multipart.js';

// DOC-CAST1 (Mejri 22/09, ruling A 2026-09-22) — the screencaster (advertiser / agency) signup
// « Documents » step collects the RNE (≤ 2) and the documents complémentaires (≤ 10). They used to
// be lost twice: the web posted JSON, and this route only read an OWNER's `rne` + `bank` parts. The
// screencaster parts now land in user_documents through the owners' storage path, and follow the
// owner volets' policy on this route: a bad MIME → 400 before any account exists, a part over 5 MB
// → 413, a part the kind may not send → ignored, surplus parts of a category → the later ones win
// (one slot: the last part, as a repeated owner volet always did), too many file parts → 413.

const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}));

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const EMAIL = 'caster@example.com';

const file = (filename: string, contentType = 'application/pdf'): MultipartFile => ({
  filename,
  contentType,
  content: Buffer.from(`%PDF-1.4 ${filename}`),
});
const rne = (n: number) => ['rne', file(`rne-${n}.pdf`)] as const;
const complementaire = (n: number) => ['complementaire', file(`comp-${n}.pdf`)] as const;
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('POST /api/signup — screencaster documents (DOC-CAST1)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(authPlugin);
    await app.register(apiRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const profile = async (over: Record<string, unknown> = {}) => {
    const [sector] = await db.select({ id: businessSectors.id }).from(businessSectors).limit(1);
    const [gov] = await db.select({ id: governorates.id }).from(governorates).limit(1);
    return {
      email: EMAIL,
      password: 'a-strong-passw0rd',
      contact_name: 'Test Caster',
      business_name: 'Caster Biz',
      contact_phone: '+21612345678',
      tax_number: '1234567ABC000',
      terms_accepted: true,
      profile_type: 'advertiser',
      business_type: 'local',
      business_sector_id: sector?.id,
      street_address: '12 Rue de Test',
      city: 'Tunis',
      postal_code: '1000',
      governorate_id: gov?.id,
      // HOURS-M1 + SCR-DECL1: an individual_owner carries its hours and its counts.
      ...(over['profile_type'] === 'individual_owner'
        ? { opening_hour: 8, closing_hour: 22, screen_count: 2, room_count: 1 }
        : {}),
      ...over,
    };
  };

  const signup = async (
    over: Record<string, unknown>,
    parts: readonly (readonly [string, MultipartFile])[],
    omit: string[] = [],
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/signup',
      ...signupMultipart(await profile(over), { parts, omit }),
    });

  const docsOf = async (userId: string) =>
    db
      .select()
      .from(userDocuments)
      .where(eq(userDocuments.userId, userId))
      .orderBy(asc(userDocuments.category), asc(userDocuments.position));
  const accountsNamed = async (email: string) =>
    db.select({ id: users.id }).from(users).where(eq(users.email, email));
  const layout = (docs: Awaited<ReturnType<typeof docsOf>>) =>
    docs.map((d) => [d.category, d.position, d.originalFilename]);

  const sessionAs = (id: string, role: string, status: string): void => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id, role, status },
    } as unknown as GetSessionResult);
  };

  it('an advertiser posting RNE ×2 + complémentaire ×1 → 201, all three stored; admin lists them; /api/me says registration', async () => {
    const res = await signup({}, [rne(1), rne(2), complementaire(1)]);
    expect(res.statusCode).toBe(201);
    const userId = res.json<{ userId: string }>().userId;

    const docs = await docsOf(userId);
    expect(layout(docs)).toEqual([
      ['rne', 1, 'rne-1.pdf'],
      ['rne', 2, 'rne-2.pdf'],
      ['complementaire', 1, 'comp-1.pdf'],
    ]);
    // The owners' storage path: row-owned `<category>/<userId>/<rowId>` keys, the real MIME + size.
    for (const d of docs) {
      expect(isRowOwnedKey(d)).toBe(true);
      expect(d.mimeType).toBe('application/pdf');
      expect(d.sizeBytes).toBeGreaterThan(0);
    }

    // Admin « Utilisateurs » reads the same rows — the validation flow needs no change.
    sessionAs('00000000-0000-4000-8000-0000000000ad', 'admin', 'approved');
    const listed = await app.inject({ method: 'GET', url: `/api/admin/users/${userId}/documents` });
    expect(listed.statusCode).toBe(200);
    const grouped = listed.json<{
      documents: Record<string, { position: number; original_filename: string }[]>;
    }>().documents;
    expect(grouped['rne']?.map((d) => d.original_filename)).toEqual(['rne-1.pdf', 'rne-2.pdf']);
    expect(grouped['complementaire']?.map((d) => d.original_filename)).toEqual(['comp-1.pdf']);
    expect(grouped['bank']).toEqual([]);

    // The new (pending) account's own presence flags.
    sessionAs(userId, 'advertiser', 'pending');
    const me = await app.inject({ method: 'GET', url: '/api/me' });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { documents: unknown } }>().user.documents).toEqual({
      registration: true,
      bank: false,
    });
  });

  it('an agency is a screencaster too → the same parts are stored (role advertiser, business_type agency)', async () => {
    const res = await signup({ profile_type: 'agency' }, [rne(1), rne(2), complementaire(1)]);
    expect(res.statusCode).toBe(201);
    const userId = res.json<{ userId: string }>().userId;
    const [u] = await db
      .select({ role: users.role, businessType: users.businessType })
      .from(users)
      .where(eq(users.id, userId));
    expect(u).toEqual({ role: 'advertiser', businessType: 'agency' });
    expect(layout(await docsOf(userId))).toEqual([
      ['rne', 1, 'rne-1.pdf'],
      ['rne', 2, 'rne-2.pdf'],
      ['complementaire', 1, 'comp-1.pdf'],
    ]);
  });

  it('the full caps arrive: RNE ×2 + complémentaires ×10 → positions 1..2 and 1..10 in arrival order', async () => {
    const res = await signup({}, [rne(1), rne(2), ...range(10).map(complementaire)]);
    expect(res.statusCode).toBe(201);
    const docs = await docsOf(res.json<{ userId: string }>().userId);
    expect(layout(docs)).toEqual([
      ['rne', 1, 'rne-1.pdf'],
      ['rne', 2, 'rne-2.pdf'],
      ...range(10).map((n) => ['complementaire', n, `comp-${n}.pdf`]),
    ]);
  });

  it('a screencaster multipart with NO file (« plus tard ») → 201, no document row', async () => {
    const res = await signup({}, []);
    expect(res.statusCode).toBe(201);
    expect(await docsOf(res.json<{ userId: string }>().userId)).toEqual([]);
  });

  it('the JSON path still works for a screencaster → 201, no document row', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/signup', payload: await profile() });
    expect(res.statusCode).toBe(201);
    expect(await docsOf(res.json<{ userId: string }>().userId)).toEqual([]);
  });

  it('a bad MIME on a screencaster part → 400 naming it, NO account, NO row (the owner-volet rule)', async () => {
    const res = await signup({}, [rne(1), ['complementaire', file('notes.txt', 'text/plain')]]);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'INVALID_INPUT',
      fields: [{ field: 'complementaire', reason: 'unsupported content type: text/plain' }],
    });
    expect(await accountsNamed(EMAIL)).toEqual([]);
    expect(await db.select().from(userDocuments)).toEqual([]);
  });

  it('a screencaster part over 5 MB → 413, NO account (the owner-volet rule)', async () => {
    const big: MultipartFile = {
      filename: 'big.pdf',
      contentType: 'application/pdf',
      content: Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0x41),
    };
    const res = await signup({}, [rne(1), ['complementaire', big]]);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
    expect(await accountsNamed(EMAIL)).toEqual([]);
  });

  it('surplus parts of a category are not refused — the LATER ones win, like a repeated owner volet', async () => {
    const res = await signup({}, [rne(1), rne(2), rne(3), ...range(11).map(complementaire)]);
    expect(res.statusCode).toBe(201);
    const docs = await docsOf(res.json<{ userId: string }>().userId);
    expect(layout(docs)).toEqual([
      ['rne', 1, 'rne-2.pdf'],
      ['rne', 2, 'rne-3.pdf'],
      ...range(10).map((n) => ['complementaire', n, `comp-${n + 1}.pdf`]),
    ]);
  });

  it('more file parts than the screencaster limit (caps 12 + 2 headroom) → 413, NO account', async () => {
    const res = await signup({}, [...range(3).map(rne), ...range(12).map(complementaire)]);
    expect(res.statusCode).toBe(413);
    expect(await accountsNamed(EMAIL)).toEqual([]);
  });

  it('a part a screencaster may not send (bank, a stale cin) is IGNORED, like an unknown owner part', async () => {
    const res = await signup({}, [rne(1), ['bank', file('rib.pdf')], ['cin_recto', file('c.pdf')]]);
    expect(res.statusCode).toBe(201);
    expect(layout(await docsOf(res.json<{ userId: string }>().userId))).toEqual([
      ['rne', 1, 'rne-1.pdf'],
    ]);
  });

  it('a duplicate-email screencaster signup attaches NOTHING to the existing account', async () => {
    const first = await signup({}, [rne(1)]);
    expect(first.statusCode).toBe(201);
    const userId = first.json<{ userId: string }>().userId;
    const again = await signup({ tax_number: '7654321XYZ000' }, [rne(9), complementaire(9)]);
    expect(again.statusCode).toBe(201); // anti-enumeration: the generic 201
    expect(layout(await docsOf(userId))).toEqual([['rne', 1, 'rne-1.pdf']]);
  });

  // ── Owners unchanged: one RNE + one RIB volet, the same limits as before DOC-CAST1 ──────────
  it('owner: a complémentaire part is ignored (owners attach rne + bank only)', async () => {
    const res = await signup({ profile_type: 'fleet_owner' }, [complementaire(1)]);
    expect(res.statusCode).toBe(201);
    const docs = await docsOf(res.json<{ userId: string }>().userId);
    expect(docs.map((d) => [d.category, d.position])).toEqual([
      ['rne', 1],
      ['bank', 1],
    ]);
  });

  it('owner: a repeated rne part keeps ONE volet — the last one', async () => {
    const res = await signup({ profile_type: 'individual_owner' }, [rne(2)], ['bank']);
    expect(res.statusCode).toBe(201);
    // The helper's default rne volet (rne.pdf) arrives first; the extra rne-2.pdf supersedes it.
    expect(layout(await docsOf(res.json<{ userId: string }>().userId))).toEqual([
      ['rne', 1, 'rne-2.pdf'],
    ]);
  });

  it('owner: more than 4 file parts → 413, NO account (the owner limit is unchanged)', async () => {
    const res = await signup({ profile_type: 'individual_owner' }, [rne(2), rne(3), rne(4)]);
    expect(res.statusCode).toBe(413);
    expect(await accountsNamed(EMAIL)).toEqual([]);
  });

  it('owner: 4 file parts (rne + bank + 2 stale parts) still sign up', async () => {
    const res = await signup({ profile_type: 'individual_owner' }, [
      ['cin_recto', file('r.pdf')],
      ['cin_verso', file('v.pdf')],
    ]);
    expect(res.statusCode).toBe(201);
    const docs = await docsOf(res.json<{ userId: string }>().userId);
    expect(docs.map((d) => d.category)).toEqual(['rne', 'bank']);
  });
});
