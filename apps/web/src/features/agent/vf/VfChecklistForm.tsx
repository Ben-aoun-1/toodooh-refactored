import { useEffect, useState } from 'react';

import {
  progressPct,
  setField,
  toggleOption,
  withDefaults,
} from '@/features/agent/lib/agent-checklists';
import {
  type Answers,
  type Field,
  GOUVERNORATS,
  type Question,
  STEP_CAPTION,
  delegationsOf,
  hasEliminatory,
  isAnswered,
  optIsAll,
  optIsElim,
  optLabel,
  optValue,
  otherSelected,
  pagesOf,
  visibleQuestions,
} from '@/features/agent/lib/checklist-model';

import { VfIcon } from './VfIcon';

const str = (a: Answers, id: string): string => {
  const v = a[id];
  return typeof v === 'string' ? v : '';
};
const arr = (a: Answers, id: string): string[] => {
  const v = a[id];
  return Array.isArray(v) ? v : [];
};

function FieldInput({
  field: f,
  answers: a,
  set,
}: {
  field: Field;
  answers: Answers;
  set: (id: string, value: string) => void;
}) {
  const id = `chk-${f.id}`;
  const value = str(a, f.id);
  const label = (
    <label htmlFor={id}>
      {f.label}
      {f.req ? (
        <>
          {' '}
          <i>*</i>
        </>
      ) : null}
    </label>
  );
  const options =
    f.select === 'gouvernorat'
      ? GOUVERNORATS
      : f.select === 'delegation'
        ? delegationsOf(str(a, 'gouvernorat') || undefined)
        : null;
  if (f.select && options) {
    return (
      <div className="f">
        {label}
        <select id={id} value={value} onChange={(e) => set(f.id, e.target.value)}>
          <option value="">
            {f.select === 'delegation' && !str(a, 'gouvernorat')
              ? "Choisir d'abord le gouvernorat"
              : 'Choisir'}
          </option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (f.kind === 'range') {
    return (
      <div className="f vf-span-all">
        {label}
        <div className="crange">
          <b>{value ? `${value} %` : 'Déplace le curseur'}</b>
          <input
            id={id}
            type="range"
            min={0}
            max={100}
            step={5}
            value={value || '50'}
            onChange={(e) => set(f.id, e.target.value)}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="f">
      {label}
      <input
        id={id}
        type={f.kind ?? 'text'}
        value={value}
        onChange={(e) => set(f.id, e.target.value)}
      />
    </div>
  );
}

function QuestionBlock({
  question: q,
  answers: a,
  missing,
  onChange,
}: {
  question: Question;
  answers: Answers;
  missing: boolean;
  onChange: (next: Answers) => void;
}) {
  const set = (id: string, value: string) => onChange(setField(a, id, value));
  const selected = (v: string) => (q.type === 'multi' ? arr(a, q.id).includes(v) : a[q.id] === v);
  const allSelected =
    q.type === 'multi' && (q.options ?? []).some((o) => optIsAll(o) && selected(optValue(o)));
  return (
    <div
      className={`cq${q.rule && !q.fin ? ' sub' : ''}${missing ? ' miss' : ''}`}
      id={`cq_${q.id}`}
    >
      {q.rule && <div className="crule">↳ {q.rule}</div>}
      {q.title && <h3>{q.title}</h3>}
      {q.help && <p className="tiny">{q.help}</p>}
      {q.options ? (
        <>
          <div className="copts">
            {q.options
              .filter((o) => !allSelected || optIsAll(o))
              .map((o) => (
                <button
                  type="button"
                  key={optValue(o)}
                  className={`copt${selected(optValue(o)) ? ' on' : ''}`}
                  onClick={() => onChange(toggleOption(q, o, a))}
                >
                  {optLabel(o)}
                  {optIsElim(o) && <span className="celim">Non éligible</span>}
                </button>
              ))}
          </div>
          {otherSelected(q, a) && (
            <div className="f vf-mt10">
              <label htmlFor={`chk-${q.id}-autre`}>Précise ta réponse</label>
              <input
                id={`chk-${q.id}-autre`}
                value={str(a, `${q.id}_autre`)}
                onChange={(e) => set(`${q.id}_autre`, e.target.value)}
              />
            </div>
          )}
        </>
      ) : (
        <div className="grid2 vf-chk-fields">
          {(q.fields ?? []).map((f) => (
            <FieldInput key={f.id} field={f} answers={a} set={set} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * AGENT-VF (spec VF §11 « Questionnaire ») — one page of the questionnaire at a time: the step,
 * « Page x / y » (the total follows the answers), the questions of the page, the red banner after
 * an eliminatory answer, and « Enregistrer et quitter » on every page.
 */
export function VfChecklistForm({
  answers,
  onChange,
  onPage,
  onQuit,
  onDone,
}: {
  answers: Answers;
  onChange: (next: Answers) => void;
  onPage: (a: Answers) => void;
  onQuit: (a: Answers) => void;
  onDone: (a: Answers) => void;
}) {
  const [pageId, setPageId] = useState('etab');
  const [miss, setMiss] = useState<string | null>(null);
  const visible = visibleQuestions(answers);
  const pages = pagesOf(visible);
  const found = pages.findIndex((p) => p.id === pageId);
  const index = found < 0 ? 0 : found;
  const page = pages[index];
  const onThisPage = visible.filter((q) => q.page === page?.id);

  // Prefill the page's defaults (the observation's day and hour) once it is shown.
  useEffect(() => {
    const filled = withDefaults(answers, onThisPage, new Date());
    if (Object.keys(filled).length !== Object.keys(answers).length) onChange(filled);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the page changes
  }, [page?.id]);

  if (!page) return null;
  const go = (id: string) => {
    setPageId(id);
    setMiss(null);
    onPage(answers);
    window.scrollTo(0, 0);
    document.querySelector('.agt')?.scrollTo?.(0, 0);
  };
  const next = () => {
    const bad = onThisPage.find((q) => !isAnswered(q, answers));
    if (bad) {
      setMiss(bad.id);
      document.getElementById(`cq_${bad.id}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    const after = pages[index + 1];
    if (after) go(after.id);
    else onDone(answers);
  };

  return (
    <div className="card cform">
      <div className="cfh">
        <div className="vf-chk-top">
          <span className="cstep">{STEP_CAPTION[page.step]}</span>
          <span className="tiny">
            Page {index + 1} / {pages.length}
          </span>
          <button type="button" className="btn sm" onClick={() => onQuit(answers)}>
            Enregistrer et quitter
          </button>
        </div>
        <div className="onb">
          <div className="bar">
            <i className={`vf-w-${Math.round(progressPct(index, pages.length) / 10)}`} />
          </div>
        </div>
      </div>
      <div className="cfb">
        <h2 className="ctitle">{page.title}</h2>
        {onThisPage.map((q) => (
          <QuestionBlock
            key={q.id}
            question={q}
            answers={answers}
            missing={miss === q.id}
            onChange={(a) => {
              if (miss === q.id) setMiss(null);
              onChange(a);
            }}
          />
        ))}
        {hasEliminatory(answers) && page.step !== 3 && (
          <div className="banner vf-banner-elim">
            <VfIcon k="alert" size={16} />
            <span>
              Réponse éliminatoire : la fiche se clôture. Il reste à donner ton avis et la prochaine
              action.
            </span>
          </div>
        )}
      </div>
      <div className="cff">
        {miss && <span className="cerr">Il manque une réponse sur cette page.</span>}
        {index > 0 && (
          <button type="button" className="btn" onClick={() => go(pages[index - 1]?.id ?? 'etab')}>
            Précédent
          </button>
        )}
        <span className="vf-flex1" />
        <button type="button" className="btn pri" onClick={next}>
          {index === pages.length - 1 ? 'Terminer la fiche' : 'Continuer'}
        </button>
      </div>
    </div>
  );
}
