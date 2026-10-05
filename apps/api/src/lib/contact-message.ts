import { z } from 'zod';

// LAND-FB1 (Youssef, 2026-10-04) — the landing's « Écrivez-nous » form and its « Prendre
// rendez-vous » buttons used to open the visitor's own mail app (mailto:). POST /api/contact now
// emails the message straight to CONTACT_MAILBOX. Nothing is stored.
//
// THE RECIPIENT IS SERVER-SIDE ONLY: nothing in the body names where the mail goes — a public form
// that lets the caller choose is an open relay.

export const CONTACT_ROLES = ['Screencaster', 'Screenhost'] as const;
export const CONTACT_KINDS = ['message', 'rendez-vous'] as const;

export const contactFieldsSchema = z.object({
  role: z.enum(CONTACT_ROLES),
  kind: z.enum(CONTACT_KINDS).default('message'),
  name: z.string().trim().max(120).default(''),
  email: z.email().max(200),
  message: z.string().trim().min(1).max(5000),
});

export type ContactFields = z.infer<typeof contactFieldsSchema>;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function contactEmail(f: ContactFields): { subject: string; text: string; html: string } {
  const what = f.kind === 'rendez-vous' ? 'Demande de rendez-vous' : 'Message';
  const text = [
    `Profil : ${f.role}`,
    `Nom : ${f.name || 'Non renseigné'}`,
    `Email : ${f.email}`,
    '',
    f.message,
  ].join('\n');
  return {
    subject: `[${f.role}] ${what} depuis le site Toodooh`,
    text,
    html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
  };
}
