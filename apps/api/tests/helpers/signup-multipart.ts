// R7/N4 — owner signup posts multipart: a `payload` field (the signup JSON) + the volet files. This
// builds that body for fastify `inject`. Volets default to the body's profile_type (individual_owner
// → cin_recto/cin_verso/bank; fleet_owner → rne/bank); `omit` drops parts (missing-volet tests) and
// `files` overrides a part (e.g. a bad MIME). Dependency-free (form-data isn't installed). Shared by
// signup.test.ts and signup-screenhosts.test.ts.
export type MultipartFile = { filename: string; contentType: string; content: Buffer };

const VOLET_PDF = Buffer.from('%PDF-1.4 signup volet bytes');

const defaultVolets = (profileType: unknown): Record<string, MultipartFile> => {
  const pdf = (n: string): MultipartFile => ({
    filename: `${n}.pdf`,
    contentType: 'application/pdf',
    content: VOLET_PDF,
  });
  if (profileType === 'individual_owner')
    return { cin_recto: pdf('recto'), cin_verso: pdf('verso'), bank: pdf('rib') };
  if (profileType === 'fleet_owner') return { rne: pdf('rne'), bank: pdf('rib') };
  return {};
};

export const signupMultipart = (
  body: Record<string, unknown>,
  opts: { omit?: string[]; files?: Record<string, MultipartFile> } = {},
): { payload: Buffer; headers: Record<string, string> } => {
  const boundary = `----toodoohsignup${Date.now()}${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(body)}\r\n`,
    ),
  ];
  const files = { ...defaultVolets(body['profile_type']), ...opts.files };
  for (const [name, f] of Object.entries(files)) {
    if (opts.omit?.includes(name)) continue;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`,
      ),
      f.content,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
};
