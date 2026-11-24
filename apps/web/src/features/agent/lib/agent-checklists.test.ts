import { describe, expect, it } from 'vitest';

import type { ChecklistRow } from '../services/agent-checklists.service';

import {
  checklistCounters,
  ficheSubline,
  opinionLabel,
  progressPct,
  setField,
  toggleOption,
  withDefaults,
} from './agent-checklists';
import { QUESTIONS, checklistResult, pagesOf, visibleQuestions } from './checklist-model';

const row = (over: Partial<ChecklistRow>): ChecklistRow => ({
  id: 'x',
  status: 'draft',
  name: 'Café Nord',
  category: 'Cafés',
  governorate: 'Tunis',
  delegation: 'La Marsa',
  created_at: '2026-11-15T09:00:00Z',
  result: null,
  agent_opinion: null,
  ...over,
});
const q = (id: string) => {
  const found = QUESTIONS.find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('Checklist tab (spec VF §11)', () => {
  it('counts drafts, sent fiches and the two proposals', () => {
    expect(
      checklistCounters([
        row({}),
        row({ status: 'sent', result: 'elig' }),
        row({ status: 'validated', result: 'elig' }),
        row({ status: 'refused', result: 'non' }),
        row({ status: 'sent', result: 'inc' }),
      ]),
    ).toEqual({ drafts: 1, sent: 4, eligible: 2, notEligible: 1 });
    expect(ficheSubline(row({ delegation: null }))).toBe('Cafés · Tunis');
    expect(opinionLabel(null)).toBe('–');
    expect(progressPct(3, 12)).toBe(25);
  });

  it('a choice replaces, a multi toggles, « Toute la semaine » is exclusive', () => {
    expect(toggleOption(q('tv'), 'Oui', { tv: 'Non' })).toEqual({ tv: 'Oui' });
    const jours = q('jours');
    const lundi = toggleOption(jours, 'Lundi', {});
    expect(lundi).toEqual({ jours: ['Lundi'] });
    expect(toggleOption(jours, 'Lundi', lundi)).toEqual({ jours: [] });
    const all = toggleOption(jours, { v: 'Toute la semaine', all: true }, lundi);
    expect(all).toEqual({ jours: ['Toute la semaine'] });
  });

  it('changing the governorate empties the délégation; the observation is prefilled once', () => {
    expect(
      setField({ gouvernorat: 'Tunis', quartier: 'La Marsa' }, 'gouvernorat', 'Ariana'),
    ).toEqual({
      gouvernorat: 'Ariana',
      quartier: '',
    });
    const now = new Date(2026, 10, 15, 9, 5);
    const filled = withDefaults({}, [q('obs')], now);
    expect(filled).toEqual({ o_date: '2026-11-15', o_heure: '09:05' });
    expect(withDefaults({ o_date: '2026-11-01' }, [q('obs')], now)['o_date']).toBe('2026-11-01');
  });

  it('the web copy of the model gives the spec’s page counts', () => {
    expect(pagesOf(visibleQuestions({ contact: 'non' }))).toHaveLength(10);
    expect(pagesOf(visibleQuestions({ contact: 'decideur' }))).toHaveLength(12);
    expect(checklistResult({ affluence: 'moins' }).res).toBe('non');
  });
});
