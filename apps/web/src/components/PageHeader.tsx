import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** Optional one-line description under the title. */
  subtitle?: string;
  /** Optional inline extras next to the title cluster (count chips etc.). */
  children?: ReactNode;
}

/**
 * CF-U2 — THE page-header idiom (operator ruling 2026-07-18, harmonized headers): a plain
 * title + small subtitle cluster, NO icon. Chosen as the majority pattern across owner +
 * advertiser pages (Mes campagnes / Calendrier / Campagnes à valider language):
 *   title    text-xl font-semibold text-[#171717]
 *   subtitle text-sm  text-[#5C5C5C]
 * Pages keep their own header SHELL (sticky bar, card, …) and right-side actions; this is only
 * the title cluster, so the idiom has one home. Dashboards keep their greeting heroes and the
 * statement DETAIL page keeps its document letterhead — those are not titled feature pages.
 */
export default function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="flex items-center gap-4 min-w-0">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-[#171717] truncate">{title}</h1>
        {subtitle && <p className="text-sm text-[#5C5C5C] hidden sm:block">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
