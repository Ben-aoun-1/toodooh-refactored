import type { ReactNode } from 'react';

/** One labelled block of the decision popup (Figma 588: uppercase grey label, ruled below). */
export default function DecisionSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-b border-[#EFEFEF] pb-4 last:border-b-0">
      <p className="text-xs font-medium uppercase text-[#A3A3A3]">{label}</p>
      {children}
    </section>
  );
}

export function DecisionChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-brand-primary bg-white px-2 py-1 text-xs text-[#171717]">
      {children}
    </span>
  );
}
