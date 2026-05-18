import { Loader } from 'lucide-react';

/**
 * Full-screen spinner shown by the route-level <Suspense> boundary while a
 * lazily-loaded page chunk is being fetched.
 *
 * Note: `text-brand-primary` is the brand colour as a hardcoded hex on purpose —
 * the Tailwind `brand` token migration is a separate, later cleanup pass.
 */
export default function PageLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader className="h-10 w-10 animate-spin text-brand-primary" />
    </div>
  );
}
