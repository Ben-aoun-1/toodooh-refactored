import { AnimatePresence, motion } from 'framer-motion';
import { Globe, Plus, X } from 'lucide-react';
import { useState } from 'react';

import {
  type TargetingLine,
  allNetworkLine,
  categoryLineLabel,
  duplicateIndexOf,
  firstAvailableCategoryLine,
  firstAvailableLine,
  isAllNetwork,
  lineLabel,
} from '../lib/targeting-lines';

import { CategorySelect, type CategoryOption } from './CategorySelect';
import { ClassSegmentedControl } from './ClassSegmentedControl';

/** A targeting line plus a stable client key (lines have no id until persisted) — drives React keys
 * + exit animations. The parent owns the array; this module mints keys for new lines. */
export interface BuilderLine extends TargetingLine {
  key: string;
}

let keyCounter = 0;
export const newBuilderLine = (line: TargetingLine): BuilderLine => ({
  ...line,
  key: `tl-${(keyCounter += 1)}`,
});

interface TargetingBuilderProps {
  value: BuilderLine[];
  onChange: (next: BuilderLine[]) => void;
  categories: CategoryOption[];
  disabled?: boolean;
  /** CF-W1 — the wizard targets CATEGORIES only: the class control is HIDDEN (not removed —
   * classes return later), every line carries the all-value class (null), dedup is by category. */
  categoryOnly?: boolean;
}

const FLASH_MS = 1800;

export function TargetingBuilder({
  value,
  onChange,
  categories,
  disabled = false,
  categoryOnly = false,
}: TargetingBuilderProps) {
  // Key of the existing line to flash amber when a duplicate is attempted (transient UI only).
  const [flashKey, setFlashKey] = useState<string | null>(null);

  const allNetwork = value.length === 1 && value[0] !== undefined && isAllNetwork(value[0]);
  const categoryName = (id: string): string | undefined =>
    categories.find((c) => c.id === id)?.name;
  const categoryIds = categories.map((c) => c.id);

  const flash = (key: string) => {
    setFlashKey(key);
    window.setTimeout(() => setFlashKey((k) => (k === key ? null : k)), FLASH_MS);
  };

  // Apply an edit to line `index`, unless it would duplicate another line — then flash that line.
  const editLine = (index: number, patch: Partial<TargetingLine>) => {
    const current = value[index];
    if (!current) return;
    const candidate: TargetingLine = {
      categoryId: current.categoryId,
      class: current.class,
      ...patch,
    };
    const dup = duplicateIndexOf(value, candidate, index);
    if (dup !== -1) {
      const dupLine = value[dup];
      if (dupLine) flash(dupLine.key);
      return;
    }
    onChange(value.map((l, i) => (i === index ? { ...l, ...candidate } : l)));
  };

  const removeLine = (index: number) => onChange(value.filter((_, i) => i !== index));

  const nextSeed = () =>
    categoryOnly
      ? firstAvailableCategoryLine(value, categoryIds)
      : firstAvailableLine(value, categoryIds);

  const addLine = () => {
    const seed = nextSeed();
    if (!seed) return; // every combination already targeted
    onChange([...value, newBuilderLine(seed)]);
  };

  const enableAllNetwork = () => onChange([newBuilderLine(allNetworkLine())]);
  const disableAllNetwork = () => onChange([]);

  const addExhausted = nextSeed() === null;

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold text-brand-deep">
          Quelles audiences voulez-vous toucher&nbsp;?
        </h2>
        <p className="text-sm text-gray-500">
          {categoryOnly
            ? 'Ciblez par type de lieu, ou diffusez sur l’ensemble du réseau.'
            : 'Ciblez par type de lieu et par standing, ou diffusez sur l’ensemble du réseau.'}
        </p>
      </header>

      {/* Tout le réseau — the exhaustive ALL/ALL affordance. */}
      <button
        type="button"
        disabled={disabled}
        onClick={allNetwork ? disableAllNetwork : enableAllNetwork}
        aria-pressed={allNetwork}
        className={`flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all disabled:opacity-50 ${
          allNetwork
            ? 'border-brand-primary bg-brand-primary/10'
            : 'border-gray-200 bg-white hover:border-gray-300'
        }`}
      >
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
            allNetwork ? 'bg-brand-primary text-brand-deep' : 'bg-gray-100 text-gray-500'
          }`}
        >
          <Globe className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block font-semibold text-brand-deep">Tout le réseau</span>
          <span className="block text-sm text-gray-500">
            Diffuser sur l’ensemble des écrans, toutes catégories et standings confondus.
          </span>
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            allNetwork ? 'bg-brand-primary' : 'bg-gray-300'
          }`}
        >
          <motion.span
            layout
            transition={{ type: 'spring', stiffness: 600, damping: 38 }}
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${
              allNetwork ? 'right-0.5' : 'left-0.5'
            }`}
          />
        </span>
      </button>

      <AnimatePresence mode="wait" initial={false}>
        {allNetwork ? (
          <motion.div
            key="all-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="rounded-2xl bg-brand-deep/5 px-5 py-6 text-center"
          >
            <p className="font-medium text-brand-deep">Vous ciblez l’ensemble des écrans.</p>
            <p className="mt-1 text-sm text-gray-500">
              Le ciblage par audience est désactivé tant que “Tout le réseau” est actif.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="lines-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-3"
          >
            <AnimatePresence initial={false}>
              {value.map((line, index) => {
                const flashing = line.key === flashKey;
                return (
                  <motion.div
                    key={line.key}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    className={`rounded-2xl border p-3 transition-colors sm:p-4 ${
                      flashing ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="sm:w-64">
                        <CategorySelect
                          value={line.categoryId}
                          options={categories}
                          disabled={disabled}
                          onChange={(categoryId) => editLine(index, { categoryId })}
                        />
                      </div>
                      {!categoryOnly && (
                        <div className="flex-1">
                          <ClassSegmentedControl
                            value={line.class}
                            groupId={line.key}
                            disabled={disabled}
                            onChange={(cls) => editLine(index, { class: cls })}
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        aria-label="Retirer cette audience"
                        disabled={disabled}
                        onClick={() => removeLine(index)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary sm:self-auto"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <AnimatePresence>
                      {flashing && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2 text-sm font-medium text-amber-600"
                        >
                          Cette combinaison est déjà ciblée.
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {value.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-gray-200 px-5 py-8 text-center">
                <p className="text-sm text-gray-500">
                  Ajoutez une première audience pour cibler des lieux précis.
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={disabled || addExhausted}
              onClick={addLine}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-primary/50 px-4 py-3 font-medium text-brand-deep transition-colors hover:border-brand-primary hover:bg-brand-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {addExhausted ? 'Toutes les audiences sont ciblées' : 'Ajouter une audience'}
            </button>

            {value.length > 0 && (
              <div className="pt-1">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Audiences ciblées
                </p>
                <div className="flex flex-wrap gap-2">
                  <AnimatePresence initial={false}>
                    {value.map((line, index) => (
                      <motion.span
                        key={line.key}
                        layout
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary/15 py-1 pl-3 pr-1.5 text-sm font-medium text-brand-deep"
                      >
                        {categoryOnly
                          ? categoryLineLabel(line, categoryName)
                          : lineLabel(line, categoryName)}
                        <button
                          type="button"
                          aria-label={`Retirer ${lineLabel(line, categoryName)}`}
                          disabled={disabled}
                          onClick={() => removeLine(index)}
                          className="flex h-5 w-5 items-center justify-center rounded-full text-brand-deep/60 transition-colors hover:bg-brand-deep/10 hover:text-brand-deep"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
