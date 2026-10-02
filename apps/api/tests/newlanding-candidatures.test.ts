import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emailSender } from '../src/auth/auth.js';
import { sniffCv } from '../src/lib/candidature.js';
import { candidaturesRoutes } from '../src/routes/candidatures.js';

// NEWLANDING-1 ruling 2A — POST /api/candidatures: the landing's Carrières forms. The CV is sniffed
// from its bytes, the recipient is NEVER the caller's choice, and the route is rate-limited.

const BOUNDARY = '----toodoohcandidature';
const PDF = Buffer.from('%PDF-1.4\n%fake cv\n');

const multipartBody = (fields: Record<string, string>, file?: { name: string; bytes: Buffer }) => {
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="cv"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      file.bytes,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
};

const VALID = {
  programme: 'Screencast Agent',
  name: 'Amira Ben Salah',
  email: 'amira@example.com',
  phone: '+216 20 123 456',
  city: 'Tunis',
  xp: '5 à 10 ans',
  q: 'Je connais plusieurs agences à Tunis.',
  linkedin: '',
  destinataire: 'attacker@evil.example',
};

describe('NEWLANDING-1 — POST /api/candidatures', () => {
  let app: ReturnType<typeof Fastify>;
  let ip = 0;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(candidaturesRoutes);
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const post = (
    fields: Record<string, string>,
    file?: { name: string; bytes: Buffer },
    realIp?: string,
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/candidatures',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        'x-real-ip': realIp ?? `10.0.0.${(ip += 1)}`,
      },
      payload: multipartBody(fields, file),
    });

  it('emails HR with the CV attached — never to the caller-supplied destinataire', async () => {
    const send = vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm1' });
    const res = await post(VALID, { name: 'cv.pdf', bytes: PDF });
    expect(res.statusCode).toBe(201);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0]?.[0];
    expect(mail?.to).toBe('hr@too-dooh.com');
    expect(mail?.replyTo).toBe('amira@example.com');
    expect(mail?.subject).toBe('[Candidature Screencast Agent] Amira Ben Salah');
    expect(mail?.text).toContain('Je connais plusieurs agences');
    expect(mail?.attachments).toEqual([
      { filename: 'CV - Amira Ben Salah.pdf', content: PDF, contentType: 'application/pdf' },
    ]);
    expect(JSON.stringify(mail)).not.toContain('attacker@evil.example');
  });

  it('rejects a missing CV, a non-PDF/Word CV and an invalid field — and sends nothing', async () => {
    const send = vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm1' });
    expect((await post(VALID)).statusCode).toBe(400);
    const exe = await post(VALID, { name: 'cv.pdf', bytes: Buffer.from('MZ\x90\x00binary') });
    expect(exe.statusCode).toBe(400);
    expect(exe.json()).toMatchObject({ fields: [{ field: 'cv' }] });
    const bad = await post({ ...VALID, email: 'not-an-email' }, { name: 'cv.pdf', bytes: PDF });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ fields: [{ field: 'email' }] });
    const prog = await post({ ...VALID, programme: 'Autre' }, { name: 'cv.pdf', bytes: PDF });
    expect(prog.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a CV over 5 MB', async () => {
    vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm1' });
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await post(VALID, { name: 'cv.pdf', bytes: big })).statusCode).toBe(413);
  });

  it('answers 502 when the mail server fails (the landing then shows its retry message)', async () => {
    vi.spyOn(emailSender, 'send').mockResolvedValue({ error: 'smtp down' });
    expect((await post(VALID, { name: 'cv.pdf', bytes: PDF })).statusCode).toBe(502);
  });

  it('rate-limits per visitor (X-Real-IP): the 6th application within the hour is refused', async () => {
    vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm1' });
    for (let i = 0; i < 5; i += 1) {
      expect((await post(VALID, { name: 'cv.pdf', bytes: PDF }, '192.0.2.7')).statusCode).toBe(201);
    }
    expect((await post(VALID, { name: 'cv.pdf', bytes: PDF }, '192.0.2.7')).statusCode).toBe(429);
    // Another visitor is unaffected.
    expect((await post(VALID, { name: 'cv.pdf', bytes: PDF }, '192.0.2.8')).statusCode).toBe(201);
  });
});

describe('sniffCv — the type comes from the bytes', () => {
  it('recognises PDF, legacy Word and DOCX; rejects the rest', () => {
    expect(sniffCv(PDF, 'x.bin')).toBe('pdf');
    expect(sniffCv(Buffer.from('d0cf11e0a1b11ae100', 'hex'), 'cv.doc')).toBe('doc');
    expect(sniffCv(Buffer.from('504b030400', 'hex'), 'cv.docx')).toBe('docx');
    expect(sniffCv(Buffer.from('504b030400', 'hex'), 'archive.zip')).toBeNull();
    expect(sniffCv(Buffer.from('GIF89a'), 'cv.pdf')).toBeNull();
  });
});
