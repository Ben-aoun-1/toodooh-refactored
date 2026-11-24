import { useEffect, useRef, useState } from 'react';

import { useChecklist, useChecklistMutation } from '@/features/agent/hooks/useAgentChecklists';
import type { Answers } from '@/features/agent/lib/checklist-model';
import { agentChecklistsService } from '@/features/agent/services/agent-checklists.service';
import { getErrorMessage } from '@/lib/errors';

import { VfChecklistForm } from './VfChecklistForm';
import { VfChecklistResult } from './VfChecklistResult';
import { useVfOverlay } from './VfOverlay';

/**
 * AGENT-VF (spec VF §11) — one fiche: the questionnaire while it is a draft (every change is saved
 * a moment later, and at once when the agent leaves a page), then its result page. A sent fiche
 * opens on its result and can no longer change.
 */
export function VfChecklistFiche({ id, onHome }: { id: string; onHome: () => void }) {
  const { toast } = useVfOverlay();
  const q = useChecklist(id);
  const save = useChecklistMutation((a: Answers) => agentChecklistsService.save(id, a));
  const send = useChecklistMutation(() => agentChecklistsService.send(id));
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [mode, setMode] = useState<'form' | 'result'>('form');
  const [sent, setSent] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const { mutateAsync: saveNow } = save;

  useEffect(() => {
    if (!q.data || answers !== null) return;
    setAnswers(q.data.answers);
    if (q.data.status !== 'draft') {
      setMode('result');
      setSent(true);
    }
  }, [q.data, answers]);

  // Autosave: 700 ms after the last change.
  useEffect(() => {
    if (!dirty.current || answers === null || sent) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      dirty.current = false;
      void saveNow(answers).catch(() => {
        dirty.current = true;
      });
    }, 700);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [answers, sent, saveNow]);

  const flush = async (a: Answers): Promise<boolean> => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (sent) return true;
    try {
      dirty.current = false;
      await saveNow(a);
      return true;
    } catch (e) {
      toast(getErrorMessage(e) || 'Enregistrement impossible');
      return false;
    }
  };

  if (q.isError) {
    return (
      <div className="card cform">
        <div className="cfb">
          <p className="muted">{getErrorMessage(q.error) || 'Fiche introuvable.'}</p>
        </div>
        <div className="cff">
          <button type="button" className="btn" onClick={onHome}>
            Retour à mes fiches
          </button>
        </div>
      </div>
    );
  }
  if (answers === null) return <div className="tiny vf-sensor-none">Chargement…</div>;

  if (mode === 'result') {
    return (
      <VfChecklistResult
        answers={answers}
        status={sent ? (q.data?.status === 'draft' ? 'sent' : (q.data?.status ?? 'sent')) : 'draft'}
        sending={send.isPending}
        onEdit={() => setMode('form')}
        onHome={onHome}
        onSend={async () => {
          if (!(await flush(answers))) return;
          try {
            await send.mutateAsync(undefined);
            toast('Fiche envoyée au manager');
            onHome();
          } catch (e) {
            toast(getErrorMessage(e) || 'Envoi impossible');
          }
        }}
      />
    );
  }
  return (
    <VfChecklistForm
      answers={answers}
      onChange={(next) => {
        dirty.current = true;
        setAnswers(next);
      }}
      onPage={(a) => void flush(a)}
      onQuit={async (a) => {
        if (await flush(a)) {
          toast('Brouillon enregistré');
          onHome();
        }
      }}
      onDone={async (a) => {
        if (await flush(a)) setMode('result');
      }}
    />
  );
}
