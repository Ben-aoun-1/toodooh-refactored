import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface PositioningCardProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  children: ReactNode;
}

/** A step's white card in the Foot parcours: the light-green head (icon tile, title), its body. */
export default function PositioningCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: PositioningCardProps) {
  return (
    <section className="rounded-xl border border-pitch-line bg-white shadow-lg shadow-pitch-ink/[0.07]">
      <div className="relative flex items-center gap-3 overflow-hidden rounded-t-xl border-b border-pitch-line bg-stadium-card-head px-5 py-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full border-2 border-pitch-leaf/10"
        />
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stadium-tile text-white shadow-md shadow-pitch-leaf/35">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-pitch-ink">{title}</h2>
          <p className="mt-0.5 text-sm text-pitch-grey">{subtitle}</p>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
