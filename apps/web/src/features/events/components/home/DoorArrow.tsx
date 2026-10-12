import { ChevronRight } from 'lucide-react';

/** The door's call to action (Youssef's design, .go2): mint, the arrow on the right. */
export default function DoorArrow({ label }: { label: string }) {
  return (
    <span className="mt-1.5 inline-flex min-h-[50px] items-center gap-2.5 self-start rounded-xl bg-brand-primary px-[22px] text-[15px] font-bold text-brand-deep transition-colors group-hover:bg-[#A9F2CB]">
      {label}
      <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}
