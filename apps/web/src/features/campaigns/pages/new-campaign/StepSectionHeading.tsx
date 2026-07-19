import type { LucideIcon } from 'lucide-react';

interface StepSectionHeadingProps {
  /** The step's contextual glyph — mirrors the ariane chip's icon language. */
  icon: LucideIcon;
  title: string;
  subtitle: string;
}

/**
 * CF-U2 — the ONE per-step section-title treatment (operator ruling 2026-07-18): every wizard
 * step heads its card with the same icon-tile + title + subtitle cluster, echoing the top
 * ariane chips' icon language (a light-green tile, dark glyph — flat, the gradient tiles are
 * retired). Before, only Catégories/Zones carried a tile and Validation drifted on the title
 * color; now all six steps share this component.
 */
export default function StepSectionHeading({
  icon: Icon,
  title,
  subtitle,
}: StepSectionHeadingProps) {
  return (
    <div className="flex items-center space-x-3">
      <div className="p-2 rounded-lg bg-brand-primary/15">
        <Icon className="h-5 w-5 text-brand-deep" aria-hidden />
      </div>
      <div>
        <h2 className="text-xl font-bold text-[#00263A]">{title}</h2>
        <p className="text-gray-600">{subtitle}</p>
      </div>
    </div>
  );
}
