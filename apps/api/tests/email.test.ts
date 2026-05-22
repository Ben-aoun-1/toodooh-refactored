import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SmtpEmailSender } from '../src/email/smtp-sender.js';
import { verificationEmailPlainText, verificationEmailTemplate } from '../src/email/template.js';
import { env } from '../src/env.js';

// nodemailer is mocked — no real SMTP connection (Q1: no external network in CI;
// ethereal createTestAccount is a network call, so it's local-only).
const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  return { sendMailMock, createTransportMock: vi.fn(() => ({ sendMail: sendMailMock })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));

describe('SmtpEmailSender', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    createTransportMock.mockClear();
  });

  it('returns { messageId } on a successful send', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'msg-123' });
    const sender = new SmtpEmailSender(env);
    const result = await sender.send({ to: 'x@y.com', subject: 'S', html: '<b>h</b>' });
    expect(result).toEqual({ messageId: 'msg-123' });
  });

  it('returns { error } and never throws when sendMail rejects', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));
    const sender = new SmtpEmailSender(env);
    const result = await sender.send({ to: 'x@y.com', subject: 'S', html: '<b>h</b>' });
    expect(result).toEqual({ error: 'smtp down' });
  });

  it('creates the transport with the configured host/secure/auth', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'm' });
    const sender = new SmtpEmailSender(env);
    await sender.send({ to: 'x@y.com', subject: 'S', html: 'h' });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: env.SMTP_HOST,
        secure: env.SMTP_SECURE,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      }),
    );
  });
});

describe('verification email template', () => {
  it('HTML renders the greeting, the verification link, and the CTA button', () => {
    const html = verificationEmailTemplate({
      name: 'Bob',
      verificationUrl: 'http://x/verify?token=t',
      role: 'advertiser',
    });
    expect(html).toContain('Bonjour <strong>Bob</strong>');
    expect(html).toContain('href="http://x/verify?token=t"');
    expect(html).toContain('Valider mon inscription');
    expect(html).toContain('#76E6AB');
  });

  it('plain text renders the name, URL, and tagline without HTML tags', () => {
    const text = verificationEmailPlainText({
      name: 'Bob',
      verificationUrl: 'http://x/verify?token=t',
      role: 'advertiser',
    });
    expect(text).toContain('Bob');
    expect(text).toContain('http://x/verify?token=t');
    expect(text).toContain('Toodooh, jump into smarter advertising');
    expect(text).not.toContain('<');
  });

  it('advertiser role → "annonceur" + advertiser next-steps, no screenhost copy', () => {
    const html = verificationEmailTemplate({
      name: 'A',
      verificationUrl: 'http://x',
      role: 'advertiser',
    });
    expect(html).toContain('compte annonceur');
    expect(html).toContain("catalogue d'écrans disponibles en Tunisie");
    expect(html).not.toContain('diffuseur');
    expect(html).not.toContain("mesures d'affluence");
  });

  it('individual_owner role → "diffuseur" + screenhost next-steps, no advertiser copy', () => {
    const html = verificationEmailTemplate({
      name: 'O',
      verificationUrl: 'http://x',
      role: 'individual_owner',
    });
    expect(html).toContain('compte diffuseur');
    expect(html).toContain("mesures d'affluence");
    expect(html).toContain("Installer l'application Toodooh");
    expect(html).not.toContain('annonceur');
    expect(html).not.toContain('campagne publicitaire');
  });
});
