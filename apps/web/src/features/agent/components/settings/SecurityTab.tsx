import { Check, Download, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { passwordCriteria, passwordStrength } from '@/features/agent/lib/agent-shell';
import {
  type AgentProfile,
  agentAccountService,
} from '@/features/agent/services/agent-account.service';
import { authService } from '@/features/auth/services/auth.service';
import { getErrorMessage } from '@/lib/errors';

import { Field, INPUT } from './fields';

const GAUGE = ['bg-gray-200', 'bg-red-400', 'bg-amber-400', 'bg-brand-primary'];

/**
 * AGT-1b — « Confidentialité et sécurité » (spec §9): change the password (current, new,
 * confirmation, gauge, three criteria; the other sessions are closed by the api), and the CGE
 * accepted — version, date, download.
 */
export function SecurityTab({ profile }: { profile: AgentProfile }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const criteria = passwordCriteria(next);
  const strength = passwordStrength(next);
  const valid = current !== '' && strength === 3 && next === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await authService.updatePasswordWithOld(current, next);
      toast.success('Mot de passe modifié — vos autres sessions ont été fermées.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Modification impossible');
    } finally {
      setSaving(false);
    }
  };

  const download = async (id: string) => {
    try {
      const { url } = await agentAccountService.acceptedCgeUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Document indisponible');
    }
  };

  const criterion = (ok: boolean, label: string) => (
    <li
      className={`flex items-center gap-1.5 text-xs ${ok ? 'text-emerald-700' : 'text-[#5C5C5C]'}`}
    >
      {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {label}
    </li>
  );

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4">
        <h3 className="text-sm font-semibold">Modifier le mot de passe</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Mot de passe actuel">
            <input
              type="password"
              autoComplete="current-password"
              className={INPUT}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="Nouveau mot de passe">
            <input
              type="password"
              autoComplete="new-password"
              className={INPUT}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="Confirmation">
            <input
              type="password"
              autoComplete="new-password"
              className={INPUT}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex gap-1">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${strength >= i ? GAUGE[strength] : GAUGE[0]}`}
            />
          ))}
        </div>
        <ul className="flex flex-wrap gap-4">
          {criterion(criteria.length, '10 caractères minimum')}
          {criterion(criteria.upper, 'Une majuscule')}
          {criterion(criteria.digit, 'Un chiffre')}
        </ul>
        {confirm !== '' && confirm !== next && (
          <p className="text-xs text-red-700">Les mots de passe ne correspondent pas.</p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!valid || saving}
            className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-50"
          >
            Enregistrer
          </button>
        </div>
      </form>

      <section className="space-y-2 rounded-lg border border-[#E1E4EA] p-4">
        <h3 className="text-sm font-semibold">Conditions Générales d’Engagement</h3>
        {profile.accepted_cge ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Version {profile.accepted_cge.version}, acceptée le{' '}
              {new Date(profile.accepted_cge.accepted_at).toLocaleDateString('fr-FR')}
            </span>
            <button
              type="button"
              onClick={() => void download(profile.accepted_cge?.id ?? '')}
              className="flex items-center gap-1 text-brand-primary"
            >
              <Download className="h-4 w-4" />
              Télécharger
            </button>
          </div>
        ) : (
          <p className="text-sm text-[#5C5C5C]">
            Aucune version publiée à accepter pour le moment.
          </p>
        )}
      </section>
    </div>
  );
}
