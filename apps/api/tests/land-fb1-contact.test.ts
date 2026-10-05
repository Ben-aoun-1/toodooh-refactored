import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emailSender } from '../src/auth/auth.js';
import { contactRoutes } from '../src/routes/contact.js';

// LAND-FB1 — POST /api/contact: the landing's contact form and « Prendre rendez-vous » go straight
// to contact@ (no more mailto:). The recipient is NEVER the caller's choice; the route is
// rate-limited per visitor.

const VALID = {
  role: 'Screencaster',
  name: 'Amira Ben Salah',
  email: 'amira@example.com',
  message: 'Je voudrais diffuser pendant la CAN.',
  to: 'attacker@evil.example',
  destinataire: 'attacker@evil.example',
};

describe('LAND-FB1 — POST /api/contact', () => {
  let app: ReturnType<typeof Fastify>;
  let ip = 0;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(contactRoutes);
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const post = (payload: Record<string, unknown>, realIp?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/contact',
      headers: { 'x-real-ip': realIp ?? `10.1.0.${(ip += 1)}` },
      payload,
    });

  it('emails contact@ with the visitor as reply-to — never a caller-supplied recipient', async () => {
    const send = vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm1' });
    const res = await post(VALID);
    expect(res.statusCode).toBe(201);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0]?.[0];
    expect(mail?.to).toBe('contact@too-dooh.com');
    expect(mail?.replyTo).toBe('amira@example.com');
    expect(mail?.subject).toBe('[Screencaster] Message depuis le site Toodooh');
    expect(mail?.text).toContain('Nom : Amira Ben Salah');
    expect(mail?.text).toContain('Je voudrais diffuser pendant la CAN.');
    expect(JSON.stringify(mail)).not.toContain('attacker@evil.example');
  });

  it('labels a « Prendre rendez-vous » request and accepts a missing name', async () => {
    const send = vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm1' });
    const res = await post({
      role: 'Screenhost',
      kind: 'rendez-vous',
      email: VALID.email,
      message: VALID.message,
    });
    expect(res.statusCode).toBe(201);
    const mail = send.mock.calls[0]?.[0];
    expect(mail?.subject).toBe('[Screenhost] Demande de rendez-vous depuis le site Toodooh');
    expect(mail?.text).toContain('Nom : Non renseigné');
  });

  it('escapes HTML in the html body', async () => {
    const send = vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm1' });
    await post({ ...VALID, message: '<script>alert(1)</script>' });
    expect(send.mock.calls[0]?.[0]?.html).toContain('&lt;script&gt;');
    expect(send.mock.calls[0]?.[0]?.html).not.toContain('<script>');
  });

  it('rejects a missing role, a bad email or an empty message — and sends nothing', async () => {
    const send = vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm1' });
    const role = await post({ ...VALID, role: 'Autre' });
    expect(role.statusCode).toBe(400);
    expect(role.json()).toMatchObject({ fields: [{ field: 'role' }] });
    const email = await post({ ...VALID, email: 'not-an-email' });
    expect(email.json()).toMatchObject({ fields: [{ field: 'email' }] });
    const msg = await post({ ...VALID, message: '   ' });
    expect(msg.json()).toMatchObject({ fields: [{ field: 'message' }] });
    expect((await post({ ...VALID, kind: 'spam' })).statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 502 when the mail server fails (the landing then shows its retry message)', async () => {
    vi.spyOn(emailSender, 'send').mockResolvedValue({ error: 'smtp down' });
    expect((await post(VALID)).statusCode).toBe(502);
  });

  it('rate-limits per visitor (X-Real-IP): the 6th message within the hour is refused', async () => {
    vi.spyOn(emailSender, 'send').mockResolvedValue({ messageId: 'm1' });
    for (let i = 0; i < 5; i += 1) {
      expect((await post(VALID, '192.0.2.17')).statusCode).toBe(201);
    }
    expect((await post(VALID, '192.0.2.17')).statusCode).toBe(429);
    expect((await post(VALID, '192.0.2.18')).statusCode).toBe(201);
  });
});
