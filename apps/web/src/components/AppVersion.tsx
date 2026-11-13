import { APP_VERSION_LABEL } from '@/lib/app-version';

/** RELEASE-1 — the build's version at the bottom of a sidebar (nothing on a local build). */
export default function AppVersion({ className = '' }: { className?: string }) {
  if (!APP_VERSION_LABEL) return null;
  return (
    <p className={`select-all font-mono text-[11px] text-gray-400 ${className}`}>
      {APP_VERSION_LABEL}
    </p>
  );
}
