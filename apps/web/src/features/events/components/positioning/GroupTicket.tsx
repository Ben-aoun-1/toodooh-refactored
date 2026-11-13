import type { GroupMatchLine } from '../EventGroupRecapStep';

import TicketShell from './TicketShell';

/** EVT-CAT2 — the multi-match parcours' ticket: every match of the selection, no stub. */
export default function GroupTicket({ lines }: { lines: readonly GroupMatchLine[] }) {
  return (
    <TicketShell>
      <p className="text-xs font-medium uppercase tracking-[0.04em] text-brand-primary">
        Positionnement sur {lines.length} événements
      </p>
      <ul className="mt-2.5 flex flex-wrap gap-2">
        {lines.map((l) => (
          <li
            key={l.campaignId}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white"
          >
            {l.title}
            {l.subtitle && <span className="ml-2 text-xs text-pitch-wash/80">{l.subtitle}</span>}
          </li>
        ))}
      </ul>
    </TicketShell>
  );
}
