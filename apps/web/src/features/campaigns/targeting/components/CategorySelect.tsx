import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface CategoryOption {
  id: string;
  name: string;
}

interface CategorySelectProps {
  value: string | null; // null = "Toutes les catégories"
  onChange: (next: string | null) => void;
  options: CategoryOption[];
  disabled?: boolean;
}

const ALL_LABEL = 'Toutes les catégories';
// Show the filter input only once the list is long enough to warrant it.
const SEARCH_THRESHOLD = 6;

// A polished category chooser: a button + popover listbox, searchable when the list is long. Closes
// on outside-click or Escape. The "Toutes les catégories" (null) row sits at the top.
export function CategorySelect({
  value,
  onChange,
  options,
  disabled = false,
}: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedLabel =
    value === null ? ALL_LABEL : (options.find((o) => o.id === value)?.name ?? ALL_LABEL);
  const filtered =
    query.trim() === ''
      ? options
      : options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));

  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-left text-sm font-medium text-brand-deep transition-colors hover:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:opacity-50"
      >
        <span className={`truncate ${value === null ? 'text-gray-500' : ''}`}>{selectedLabel}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            role="listbox"
            className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
          >
            {options.length > SEARCH_THRESHOLD && (
              <div className="sticky top-0 mb-1 flex items-center gap-2 rounded-lg bg-gray-50 px-2">
                <Search className="h-4 w-4 text-gray-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher…"
                  className="w-full bg-transparent py-2 text-sm focus:outline-none"
                />
              </div>
            )}

            <Option
              label={ALL_LABEL}
              muted
              selected={value === null}
              onClick={() => choose(null)}
            />
            {filtered.map((o) => (
              <Option
                key={o.id}
                label={o.name}
                selected={value === o.id}
                onClick={() => choose(o.id)}
              />
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-400">Aucune catégorie</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Option({
  label,
  selected,
  muted = false,
  onClick,
}: {
  label: string;
  selected: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-brand-primary/10 ${
        selected ? 'bg-brand-primary/10 font-semibold text-brand-deep' : 'text-gray-700'
      } ${muted && !selected ? 'text-gray-500' : ''}`}
    >
      <span className="truncate">{label}</span>
      {selected && <Check className="h-4 w-4 shrink-0 text-brand-deep" />}
    </button>
  );
}
