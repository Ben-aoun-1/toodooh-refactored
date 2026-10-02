import { z } from 'zod';

// NEWLANDING-1 (operator ruling 2A, 2026-10-02) — the landing's « Carrières » application forms
// (Screencast Agent / Screenhost Agent). POST /api/candidatures emails the application, with the CV
// attached, to the HR mailbox. Nothing is stored.
//
// THE RECIPIENT IS SERVER-SIDE ONLY. The landing script posts a `destinataire` field; it is
// IGNORED — a public form that lets the caller choose where mail goes is an open relay.

export const CANDIDATURE_MAX_CV_BYTES = 5 * 1024 * 1024;

export const CANDIDATURE_PROGRAMMES = ['Screencast Agent', 'Screenhost Agent'] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

export const candidatureFieldsSchema = z.object({
  programme: z.enum(CANDIDATURE_PROGRAMMES),
  name: text(120),
  email: z.email().max(200),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s.()-]{7,}$/)
    .max(40),
  city: text(120),
  xp: text(120),
  q: text(5000),
  linkedin: z.union([z.literal(''), z.url().max(300)]).optional(),
});

export type CandidatureFields = z.infer<typeof candidatureFieldsSchema>;

export type CvKind = 'pdf' | 'doc' | 'docx';

const CV_MIME: Record<CvKind, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * The CV's real type, from its BYTES (never the filename or the declared mime):
 * PDF « %PDF- », legacy Word the OLE2 header, DOCX a ZIP container whose name says .docx.
 */
export function sniffCv(bytes: Buffer, filename: string): CvKind | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) return 'doc';
  if (bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')) && /\.docx$/i.test(filename)) {
    return 'docx';
  }
  return null;
}

export const cvMime = (kind: CvKind): string => CV_MIME[kind];

/** A safe attachment name: « CV - <Nom> .<ext> », ASCII-only. */
export const cvFilename = (name: string, kind: CvKind): string => {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .trim()
    .slice(0, 60);
  return `CV - ${base || 'candidat'}.${kind}`;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function candidatureEmail(f: CandidatureFields): {
  subject: string;
  text: string;
  html: string;
} {
  const experienceLabel = f.programme === 'Screencast Agent' ? 'Expérience' : "Niveau d'études";
  const lines = [
    `Programme : ${f.programme}`,
    `Nom : ${f.name}`,
    `Email : ${f.email}`,
    `Téléphone : ${f.phone}`,
    `Ville : ${f.city}`,
    f.linkedin ? `LinkedIn : ${f.linkedin}` : null,
    `${experienceLabel} : ${f.xp}`,
    '',
    f.q,
  ].filter((l): l is string => l !== null);
  const text = lines.join('\n');
  return {
    subject: `[Candidature ${f.programme}] ${f.name}`,
    text,
    html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
  };
}
