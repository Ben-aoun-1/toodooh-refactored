/**
 * PERF-QA1 R3 — the download filename's ONE home is the api's content-disposition header (it
 * carries the venue slug). The client parses it instead of re-deriving the name, so the slug
 * algorithm lives api-side only; callers fall back to their legacy name when the header is
 * absent or unparseable.
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename=(?:"([^"]+)"|([^;]+))/i.exec(header);
  const raw = (match?.[1] ?? match?.[2])?.trim();
  return raw ? raw : null;
}
