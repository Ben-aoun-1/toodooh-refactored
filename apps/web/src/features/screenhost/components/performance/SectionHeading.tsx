/** The mockups' numbered section header — mono eyebrow with dot, 28px title, 15px lead. */
export function SectionHeading({ num, title, lead }: { num: string; title: string; lead: string }) {
  return (
    <div>
      <div className="perf-mono inline-flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-perf-green">
        <span className="h-1.5 w-1.5 rounded-full bg-perf-green" aria-hidden />
        {num}
      </div>
      <h2 className="mt-3.5 text-[28px] font-semibold leading-[1.15] tracking-[-0.015em] text-perf-ink">
        {title}
      </h2>
      <p className="mt-3 max-w-[600px] text-[15px] leading-[1.6] text-perf-grey">{lead}</p>
    </div>
  );
}
