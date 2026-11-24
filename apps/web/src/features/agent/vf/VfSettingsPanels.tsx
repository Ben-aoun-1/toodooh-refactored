import { type ReactElement, cloneElement, useId, useState } from 'react';

import {
  useAgentPrefs,
  useDeleteAgentPhoto,
  usePatchAgentProfile,
  useUploadAgentPhoto,
  useUploadAgentRib,
} from '@/features/agent/hooks/useAgentAccount';
import { passwordCriteria, passwordStrength } from '@/features/agent/lib/agent-shell';
import {
  type AgentAccount,
  type AgentProfile,
  agentAccountService,
} from '@/features/agent/services/agent-account.service';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { authService } from '@/features/auth/services/auth.service';
import { getErrorMessage } from '@/lib/errors';

import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

// AGENT-VF (spec VF « Paramètres ») — the six forms of the settings page. Each ends with the
// full-width « Annuler » / « Enregistrer » pair; « Enregistrer » wakes up on the first change.

function Actions({
  dirty,
  valid = true,
  saving,
  onCancel,
  onSave,
}: {
  dirty: boolean;
  valid?: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="sact">
      <button type="button" className="btn" onClick={onCancel}>
        Annuler
      </button>
      <button
        type="button"
        className="btn pri"
        disabled={!dirty || !valid || saving}
        onClick={onSave}
      >
        Enregistrer
      </button>
    </div>
  );
}

function Field({
  label,
  required = false,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  /** The one control of the field; it receives the id its label points to. */
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="f">
      <label htmlFor={id}>
        {label} {required && <i>*</i>}
      </label>
      {cloneElement(children, { id })}
      {hint && <div className="h">{hint}</div>}
    </div>
  );
}

const useRun = () => {
  const { toast } = useVfOverlay();
  return async (p: Promise<unknown>, ok: string): Promise<boolean> => {
    try {
      await p;
      toast(ok);
      return true;
    } catch (e) {
      toast(getErrorMessage(e) || 'Action impossible');
      return false;
    }
  };
};

/** « Informations sur l'agent »: name, first name, phone; email and code on request only. */
export function VfProfilePanel({ profile }: { profile: AgentProfile }) {
  const initial = {
    last_name: profile.last_name ?? '',
    first_name: profile.first_name ?? '',
    phone: profile.phone ?? '',
  };
  const [form, setForm] = useState(initial);
  const patch = usePatchAgentProfile();
  const run = useRun();
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== initial[k]);
  const valid = Object.values(form).every((v) => v.trim() !== '');

  return (
    <>
      <div className="grid2 vf-gap-col">
        <Field label="Nom" required>
          <input
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          />
        </Field>
        <Field label="Prénom" required>
          <input
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Téléphone" required>
        <input
          placeholder="+216"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </Field>
      <Field label="Email professionnel" hint="Modification sur demande via le Support.">
        <input readOnly value={profile.email} />
      </Field>
      <Field label="Code agent" hint="Modification sur demande via le Support.">
        <input readOnly value={profile.code} />
      </Field>
      {profile.info_verified_at ? (
        <div className="banner vf-banner-ok">✓ Informations confirmées.</div>
      ) : (
        <div className="banner">
          <VfIcon k="alert" size={16} />
          <span>Vérifiez ces informations saisies par Toodooh, puis confirmez-les.</span>
          <button
            type="button"
            className="btn sm"
            disabled={dirty || patch.isPending}
            onClick={() => void run(patch.mutateAsync({}), 'Informations confirmées')}
          >
            Je confirme mes informations
          </button>
        </div>
      )}
      <Actions
        dirty={dirty}
        valid={valid}
        saving={patch.isPending}
        onCancel={() => setForm(initial)}
        onSave={() =>
          void run(
            patch.mutateAsync({
              first_name: form.first_name.trim(),
              last_name: form.last_name.trim(),
              phone: form.phone.replace(/\s/g, ''),
            }),
            'Modifications enregistrées',
          )
        }
      />
    </>
  );
}

/** « Informations légales »: photo, address, city, postal code, governorate; the rest on request. */
export function VfLegalPanel({ profile }: { profile: AgentProfile }) {
  const governorates = useGovernorates();
  const patch = usePatchAgentProfile();
  const upload = useUploadAgentPhoto();
  const remove = useDeleteAgentPhoto();
  const run = useRun();
  const initial = {
    street_address: profile.street_address ?? '',
    city: profile.city ?? '',
    postal_code: profile.postal_code ?? '',
    governorate_id: profile.governorate_id ?? '',
  };
  const [form, setForm] = useState(initial);
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== initial[k]);
  const valid =
    Object.values(form).every((v) => v.trim() !== '') && /^\d{4}$/.test(form.postal_code.trim());

  return (
    <>
      <div className="vf-photo-row">
        <span className="av vf-av-64">
          {profile.photo_url ? (
            <img src={profile.photo_url} alt="" />
          ) : (
            (profile.first_name ?? 'A').charAt(0).toUpperCase()
          )}
        </span>
        <div>
          <b className="vf-b13">Photo de profil</b>
          <div className="tiny">Min 400 × 400 px, PNG ou JPEG</div>
        </div>
        <span className="vf-photo-acts">
          {profile.photo_url && (
            <button
              type="button"
              className="btn sm"
              disabled={remove.isPending}
              onClick={() => void run(remove.mutateAsync(undefined), 'Photo supprimée')}
            >
              Supprimer
            </button>
          )}
          <label className="btn sm vf-file">
            Changer
            <input
              type="file"
              accept="image/png,image/jpeg"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void run(upload.mutateAsync(f), 'Photo enregistrée');
                e.target.value = '';
              }}
            />
          </label>
        </span>
      </div>
      <Field label="Adresse" required>
        <input
          value={form.street_address}
          onChange={(e) => setForm({ ...form, street_address: e.target.value })}
        />
      </Field>
      <div className="grid2 vf-gap-col">
        <Field label="Ville" required>
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="Code postal" required>
          <input
            value={form.postal_code}
            onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Gouvernorat" required>
        <select
          value={form.governorate_id}
          onChange={(e) => setForm({ ...form, governorate_id: e.target.value })}
        >
          <option value="">Choisir</option>
          {(governorates.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid2 vf-gap-col">
        <Field label="Matricule fiscal" hint="Modification via le Support.">
          <input readOnly value={profile.tax_number || '–'} />
        </Field>
        <Field label="Zone couverte" hint="Modification via le Support.">
          <input readOnly value={profile.covered_zone || '–'} />
        </Field>
      </div>
      <Actions
        dirty={dirty}
        valid={valid}
        saving={patch.isPending}
        onCancel={() => setForm(initial)}
        onSave={() =>
          void run(
            patch.mutateAsync({
              street_address: form.street_address.trim(),
              city: form.city.trim(),
              postal_code: form.postal_code.trim(),
              governorate_id: form.governorate_id,
            }),
            'Modifications enregistrées',
          )
        }
      />
    </>
  );
}

const RIB: Record<AgentAccount['rib']['status'], { label: string; badge: string }> = {
  non_fourni: { label: 'Non fourni', badge: 'b-att' },
  en_attente: { label: 'En attente de validation', badge: 'b-av' },
  valide: { label: 'Validé', badge: 'b-act' },
  refuse: { label: 'Refusé', badge: 'b-red' },
};
const RIB_MAX_BYTES = 5 * 1024 * 1024;

/** « Mes coordonnées bancaires »: the RIB's status and its deposit. */
export function VfRibPanel({ rib }: { rib: AgentAccount['rib'] }) {
  const upload = useUploadAgentRib();
  const { toast } = useVfOverlay();
  const run = useRun();
  const state = RIB[rib.status];
  return (
    <>
      <h4 className="vf-h4">Mes coordonnées bancaires</h4>
      <p className="muted vf-lead">Votre RIB permet de recevoir vos versements mensuels.</p>
      <div className="prow">
        <span className="logo lg-shop vf-logo-40">
          <VfIcon k="doc" size={40} />
        </span>
        <div>
          <b>Statut du RIB</b>
          <small>{rib.file_name ?? state.label}</small>
        </div>
        <span className={`badge ${state.badge} vf-push`}>{state.label}</span>
      </div>
      {rib.status === 'refuse' && rib.refusal_reason && (
        <div className="banner vf-banner-red">Motif : {rib.refusal_reason}</div>
      )}
      {rib.status === 'en_attente' && rib.validated && (
        <p className="tiny">
          Votre RIB validé précédent reste utilisé jusqu’à la validation du nouveau.
        </p>
      )}
      <label className="btn pri vf-file vf-mt6">
        ⇪ {rib.status === 'non_fourni' ? 'Téléverser mon RIB' : 'Remplacer mon RIB'}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          hidden
          disabled={upload.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > RIB_MAX_BYTES) {
              toast('Fichier trop lourd (5 Mo maximum).');
              return;
            }
            void run(upload.mutateAsync(f), 'RIB envoyé : en attente de validation');
          }}
        />
      </label>
      <div className="tiny vf-mt8">PDF, JPG, JPEG ou PNG, 5 Mo maximum.</div>
    </>
  );
}

/** « Préférences »: the two categories the agent may switch off. */
export function VfNotifPanel({ profile, noun }: { profile: AgentProfile; noun: string }) {
  const prefs = useAgentPrefs();
  const run = useRun();
  const initial = { news: profile.notify_news, reminders: profile.notify_reminders };
  const [form, setForm] = useState(initial);
  const dirty = form.news !== initial.news || form.reminders !== initial.reminders;
  const row = (key: 'news' | 'reminders', label: string, text: string) => (
    <div className="vf-pref">
      <button
        type="button"
        role="switch"
        aria-checked={form[key]}
        aria-label={label}
        className={`sw${form[key] ? ' on' : ''}`}
        onClick={() => setForm({ ...form, [key]: !form[key] })}
      />
      <div>
        <b className="vf-b13 vf-w500">{label}</b>
        <div className="tiny">{text}</div>
      </div>
    </div>
  );
  return (
    <>
      {row(
        'news',
        'Actualités et mises à jour',
        'Restez informé(e) des dernières actualités, mises à jour et annonces.',
      )}
      {row('reminders', 'Rappels et événements', 'Rappels de rendez-vous et de fin d’affiliation.')}
      <p className="tiny">
        Les notifications liées à vos revenus, à vos {noun} affiliés et à vos rendez-vous sont
        toujours envoyées.
      </p>
      <Actions
        dirty={dirty}
        saving={prefs.isPending}
        onCancel={() => setForm(initial)}
        onSave={() => void run(prefs.mutateAsync(form), 'Modifications enregistrées')}
      />
    </>
  );
}

const GAUGE = ['', 'vf-g-red', 'vf-g-amber', 'vf-g-green'];

/** « Modifier le mot de passe »: 10 characters, one uppercase letter, one digit. */
export function VfPasswordPanel() {
  const run = useRun();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const c = passwordCriteria(next);
  const strength = passwordStrength(next);
  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
  };
  const save = async () => {
    setSaving(true);
    const ok = await run(
      authService.updatePasswordWithOld(current, next),
      'Mot de passe modifié. Vos autres sessions ont été fermées.',
    );
    setSaving(false);
    if (ok) reset();
  };
  return (
    <>
      <Field label="Mot de passe actuel" required>
        <input
          type="password"
          autoComplete="current-password"
          placeholder="••••••••••"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>
      <Field label="Nouveau mot de passe" required>
        <input
          type="password"
          autoComplete="new-password"
          placeholder="••••••••••"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>
      <Field label="Confirmer le nouveau mot de passe" required>
        <input
          type="password"
          autoComplete="new-password"
          placeholder="••••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      <div className="gauge">
        {[0, 1, 2].map((i) => (
          <i key={i} className={i < strength ? GAUGE[strength] : 'vf-g-off'} />
        ))}
      </div>
      <div className="tiny">Doit contenir au moins</div>
      <div className="chk">
        <span className={c.upper ? 'ok' : undefined}>
          <i>✓</i>Au moins une majuscule
        </span>
        <span className={c.digit ? 'ok' : undefined}>
          <i>✓</i>Au moins un chiffre
        </span>
        <span className={c.length ? 'ok' : undefined}>
          <i>✓</i>Minimum 10 caractères
        </span>
      </div>
      {confirm !== '' && confirm !== next && (
        <p className="tiny vf-red">Les mots de passe ne correspondent pas.</p>
      )}
      <Actions
        dirty={next !== ''}
        valid={current !== '' && strength === 3 && next === confirm}
        saving={saving}
        onCancel={reset}
        onSave={() => void save()}
      />
    </>
  );
}

/** « Conditions Générales d'Engagement »: the version accepted, its date, the document. */
export function VfCgePanel({ profile }: { profile: AgentProfile }) {
  const { toast } = useVfOverlay();
  const cge = profile.accepted_cge;
  const open = async (id: string) => {
    try {
      const { url } = await agentAccountService.acceptedCgeUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast(getErrorMessage(e) || 'Document indisponible');
    }
  };
  return (
    <>
      <h4 className="vf-h4">Conditions Générales d&apos;Engagement</h4>
      {cge ? (
        <div className="prow">
          <span className="logo lg-shop vf-logo-40">
            <VfIcon k="doc" size={40} />
          </span>
          <div>
            <b>Version {cge.version}</b>
            <small>Acceptées le {new Date(cge.accepted_at).toLocaleDateString('fr-FR')}</small>
          </div>
          <button type="button" className="btn sm vf-push" onClick={() => void open(cge.id)}>
            Télécharger
          </button>
        </div>
      ) : (
        <p className="muted vf-m0">Aucune version publiée à accepter pour le moment.</p>
      )}
    </>
  );
}
