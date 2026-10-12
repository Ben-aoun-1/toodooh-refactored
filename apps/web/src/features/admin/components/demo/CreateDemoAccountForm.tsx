import { Loader2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useCreateDemoAccount } from '@/features/admin/hooks/useAdminDemo';
import { type DemoAccountForm, demoAccountBody } from '@/features/admin/lib/demo';
import { getErrorMessage } from '@/lib/errors';

const EMPTY: DemoAccountForm = {
  email: '',
  password: '',
  businessName: '',
  contactName: '',
  balance: '',
};

const FIELDS: { key: keyof DemoAccountForm; label: string; type: string; placeholder: string }[] = [
  { key: 'email', label: 'E-mail de connexion', type: 'email', placeholder: 'prospect@societe.tn' },
  { key: 'password', label: 'Mot de passe', type: 'text', placeholder: '8 caractères minimum' },
  { key: 'businessName', label: 'Société', type: 'text', placeholder: 'Nom affiché du compte' },
  {
    key: 'contactName',
    label: 'Contact (facultatif)',
    type: 'text',
    placeholder: 'Nom du contact',
  },
  { key: 'balance', label: 'Solde de départ (TND)', type: 'text', placeholder: '2000' },
];

/** DEMO-1 (ruled Q5 A) — the admin types the login, the company and the balance. */
export function CreateDemoAccountForm() {
  const [form, setForm] = useState<DemoAccountForm>(EMPTY);
  const create = useCreateDemoAccount();

  const submit = async () => {
    const body = demoAccountBody(form);
    if (!body.ok) {
      toast.error(body.error);
      return;
    }
    try {
      await create.mutateAsync(body.value);
      toast.success('Compte démo créé');
      setForm(EMPTY);
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Création impossible');
    }
  };

  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-lg border bg-gray-50 p-4 md:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {FIELDS.map((f) => (
        <label key={f.key} className="text-sm">
          <span className="block text-gray-600">{f.label}</span>
          <input
            type={f.type}
            value={form[f.key]}
            placeholder={f.placeholder}
            autoComplete="off"
            onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
            className="mt-1 w-full rounded-lg border bg-white px-3 py-2"
          />
        </label>
      ))}
      <div className="flex items-end">
        <button
          type="submit"
          disabled={create.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-60"
        >
          {create.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Créer le compte démo
        </button>
      </div>
    </form>
  );
}
