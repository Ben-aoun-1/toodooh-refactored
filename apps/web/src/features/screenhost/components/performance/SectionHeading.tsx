/** The mockups' numbered section header — dot, 'Section 0X', title, lead (Lane F). */
export function SectionHeading({ num, title, lead }: { num: string; title: string; lead: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-brand-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-accent" aria-hidden />
        {num}
      </div>
      <h2 className="mt-2 text-xl font-semibold text-brand-deep">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-gray-500">{lead}</p>
    </div>
  );
}
