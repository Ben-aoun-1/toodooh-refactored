import { History } from 'lucide-react';

// ADM-OBS2 item 1 — « Tout l'historique », next to the date filter: the whole life of the venue,
// from its creation day to today. Shared by the Tests page and the Simulateur's inspector.

interface Props {
  /** The venue's creation day (YYYY-MM-DD); the button is disabled until it is known. */
  createdDate: string | null;
  today: string;
  from: string;
  to: string;
  onPick: (from: string, to: string) => void;
}

export function AllHistoryButton({ createdDate, today, from, to, onPick }: Props) {
  const active = createdDate !== null && from === createdDate && to === today;
  return (
    <button
      type="button"
      disabled={createdDate === null}
      onClick={() => createdDate !== null && onPick(createdDate, today)}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-brand-primary bg-brand-primary/10 font-medium'
          : 'bg-white hover:bg-gray-50'
      }`}
    >
      <History className="h-4 w-4" />
      Tout l’historique
    </button>
  );
}
