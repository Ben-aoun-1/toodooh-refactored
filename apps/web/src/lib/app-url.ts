/**
 * Builds an absolute URL under the app's public base URL.
 *
 * The base URL comes from `VITE_PUBLIC_APP_URL` when it is set to a non-empty
 * value (set this in staging/production — it ends up in the client bundle, so it
 * must not be a secret). When it is unset, we fall back to `window.location.origin`,
 * which makes local development work with zero env configuration. If neither is
 * available (e.g. called in a non-browser context with no env var), this throws.
 *
 * @param path Path beginning with `/` (a leading `/` is added if missing).
 */
export function getAppUrl(path: string): string {
  const envBase = import.meta.env.VITE_PUBLIC_APP_URL;
  const base =
    typeof envBase === 'string' && envBase.trim() !== ''
      ? envBase.trim()
      : typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : undefined;

  if (!base) {
    throw new Error(
      'getAppUrl: no base URL available — set VITE_PUBLIC_APP_URL or run in a browser',
    );
  }

  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
