import type { ChecklistRow, ChecklistStatus } from '../services/agent-checklists.service';

import {
  type Answers,
  type ChecklistResult,
  type Opt,
  type Question,
  optIsAll,
  optValue,
} from './checklist-model';

// Agent Screenhost spec VF §11 « Checklist » — the tab's own rules and wording (the questionnaire
// itself is lib/checklist-model.ts), pure.

export const RESULT_BADGE: Record<ChecklistResult, { label: string; cls: string }> = {
  elig: { label: 'Éligible', cls: 'b-act' },
  non: { label: 'Non éligible', cls: 'b-red' },
  inc: { label: 'À compléter', cls: 'b-wait' },
};

export const MANAGER_BADGE: Record<ChecklistStatus, { label: string; cls: string }> = {
  draft: { label: 'Brouillon', cls: 'b-wait' },
  sent: { label: 'En attente du manager', cls: 'b-av' },
  validated: { label: 'Validé éligible par le manager', cls: 'b-act' },
  refused: { label: 'Refusé par le manager', cls: 'b-red' },
};

/** The four counters of the tab's home. */
export const checklistCounters = (rows: readonly ChecklistRow[]) => {
  const sent = rows.filter((r) => r.status !== 'draft');
  return {
    drafts: rows.length - sent.length,
    sent: sent.length,
    eligible: sent.filter((r) => r.result === 'elig').length,
    notEligible: sent.filter((r) => r.result === 'non').length,
  };
};

/** « Cafés · La Marsa · Tunis » under the venue's name. */
export const ficheSubline = (r: ChecklistRow): string =>
  [r.category, r.delegation, r.governorate].filter(Boolean).join(' · ');

export const opinionLabel = (o: 'oui' | 'non' | null): string =>
  o === 'oui' ? 'Oui' : o === 'non' ? 'Non' : '–';

export const createdLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' });

/** The bar under the step caption: the share of pages already passed. */
export const progressPct = (index: number, total: number): number =>
  total > 0 ? Math.round((index / total) * 100) : 0;

/** One click on an option: a choice replaces, a multi toggles, « Toute la semaine » is exclusive. */
export const toggleOption = (q: Question, o: Opt, a: Answers): Answers => {
  const v = optValue(o);
  if (q.type !== 'multi') return { ...a, [q.id]: v };
  const raw = a[q.id];
  const current = new Set(Array.isArray(raw) ? raw : []);
  if (optIsAll(o)) return { ...a, [q.id]: current.has(v) ? [] : [v] };
  if (current.has(v)) current.delete(v);
  else current.add(v);
  return { ...a, [q.id]: [...current] };
};

/** A field typed: trimmed; changing the governorate empties the délégation. */
export const setField = (a: Answers, id: string, value: string): Answers => ({
  ...a,
  [id]: value,
  ...(id === 'gouvernorat' ? { quartier: '' } : {}),
});

/** The values a page prefills: today and now for the observation's date and hour. */
export const withDefaults = (a: Answers, questions: readonly Question[], now: Date): Answers => {
  const p = (n: number) => String(n).padStart(2, '0');
  const out = { ...a };
  for (const q of questions) {
    for (const f of q.fields ?? []) {
      if (!f.def || out[f.id] !== undefined) continue;
      out[f.id] =
        f.def === 'today'
          ? `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
          : `${p(now.getHours())}:${p(now.getMinutes())}`;
    }
  }
  return out;
};

export const RESULT_LINE: Record<ChecklistResult, string> = {
  elig: 'Aucune réponse éliminatoire. Proposition à valider par le manager.',
  non: 'Au moins une réponse éliminatoire : la fiche est clôturée.',
  inc: 'La qualification reste à terminer.',
};

export const CIRCUIT_BANNER =
  "Circuit d'une fiche : vous remplissez et donnez votre avis, la fiche part au manager avec tout son détail, le manager donne l'éligibilité finale, puis le récapitulatif est envoyé à l'admin et enregistré sur la fiche du Screenhost.";
