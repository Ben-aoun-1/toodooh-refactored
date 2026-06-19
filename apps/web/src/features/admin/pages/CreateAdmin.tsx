import {
  UserPlus,
  Shield,
  User,
  Mail,
  Lock,
  AlertCircle,
  CheckCircle,
  Monitor,
  Cast,
  Copy,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import AdminLayout from '@/features/admin/components/AdminLayout';
import { useAdminMutations } from '@/features/admin/hooks/useAdmins';
import type { InternalAccount, InternalAccountRole } from '@/features/admin/types/admin';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';

interface AdminFormData {
  email: string;
  password: string;
  confirmPassword: string;
  first_name: string;
  last_name: string;
  role: InternalAccountRole;
}

// Labels for the success toast + the role-card picker (no `moderator` — slice-2 A ruling 2).
const ROLE_LABELS: Record<InternalAccountRole, string> = {
  admin: 'Administrateur',
  screenhost_agent: 'Agent ScreenHost',
  screencast_agent: 'Agent ScreenCast',
};

export default function CreateAdmin() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const navigate = useNavigate();
  const { createAdmin } = useAdminMutations();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<AdminFormData>({
    email: '',
    password: '',
    confirmPassword: '',
    first_name: '',
    last_name: '',
    role: 'admin',
  });
  // The created account surfaced after a successful POST — holds the issued agent code (agent
  // roles only; null for admin) so the superadmin can relay it. Its role label is kept because
  // formData.role is reset on success.
  const [created, setCreated] = useState<{ account: InternalAccount; roleLabel: string } | null>(
    null,
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const validateForm = (): string | null => {
    if (!formData.email || !formData.password || !formData.first_name || !formData.last_name) {
      return 'Tous les champs sont obligatoires';
    }

    if (formData.password.length < 12) {
      return 'Le mot de passe doit contenir au moins 12 caractères';
    }

    if (formData.password !== formData.confirmPassword) {
      return 'Les mots de passe ne correspondent pas';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      return 'Adresse email invalide';
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (!user) {
      toast.error('Vous devez être connecté');
      return;
    }

    setLoading(true);
    try {
      // contact_name is the single name field the apps/api endpoint stores; compose it from the
      // first/last inputs. role/status/verification are server-controlled (created approved +
      // verified); credentials are delivered out-of-band, so no verification email is sent.
      const account = await createAdmin.mutateAsync({
        email: formData.email,
        password: formData.password,
        contact_name: `${formData.first_name} ${formData.last_name}`.trim(),
        role: formData.role,
      });

      // Surface the created account (with its issued agent code, if any) so the superadmin can
      // relay it; capture the role label now since formData.role is about to be reset.
      setCreated({ account, roleLabel: ROLE_LABELS[formData.role] });
      toast.success(`${ROLE_LABELS[formData.role]} créé avec succès !`);

      // Réinitialiser le formulaire
      setFormData({
        email: '',
        password: '',
        confirmPassword: '',
        first_name: '',
        last_name: '',
        role: 'admin',
      });
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Code copié');
    } catch {
      toast.error('Copie impossible — copiez le code manuellement');
    }
  };

  // Vérifier que l'utilisateur est super admin
  if (!user || role !== 'superadmin') {
    return (
      <AdminLayout title="Créer un Admin" subtitle="Accès réservé au Super Administrateur">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Accès Refusé</h3>
          <p className="text-gray-600 mb-6">
            Seul le Super Administrateur peut créer des comptes internes.
          </p>
          <button
            onClick={() => navigate('/admin-dashboard')}
            className="px-6 py-2 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors"
          >
            Retour au Dashboard
          </button>
        </div>
      </AdminLayout>
    );
  }

  const createdCode = created?.account.code ?? null;

  return (
    <AdminLayout title="Créer un compte" subtitle="Ajouter un administrateur ou un agent">
      <div className="max-w-3xl mx-auto">
        {/* Confirmation post-création — surface le code agent (rôles agent) à relayer */}
        {created && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-6">
            <div className="flex items-start">
              <CheckCircle className="h-6 w-6 text-green-600 mr-3 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-green-900 mb-1">Compte créé</h4>
                <p className="text-sm text-green-700">
                  {created.roleLabel} — <span className="font-medium">{created.account.email}</span>
                </p>
                {createdCode && (
                  <div className="mt-3">
                    <span className="block text-xs font-medium text-green-900 mb-1">
                      Code agent — à communiquer à l&apos;agent
                    </span>
                    <div className="flex items-center gap-2">
                      <code className="px-3 py-2 bg-white border border-green-300 rounded-lg font-mono text-base tracking-widest text-gray-900">
                        {createdCode}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(createdCode)}
                        className="inline-flex items-center px-3 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-100 transition-colors"
                      >
                        <Copy className="h-4 w-4 mr-1.5" />
                        Copier
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCreated(null)}
                aria-label="Fermer la confirmation"
                className="ml-3 text-green-600 hover:text-green-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
        {/* En-tête informatif */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-start">
            <Shield className="h-6 w-6 text-blue-600 mr-3 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-blue-900 mb-1">
                Création de compte interne
              </h4>
              <p className="text-sm text-blue-700">
                <strong>Administrateur :</strong> Accès complet à toutes les fonctionnalités (sauf
                création d'autres comptes internes)
                <br />
                <strong>Agent ScreenHost :</strong> Inscription des établissements / inventaire
                <br />
                <strong>Agent ScreenCast :</strong> Acquisition des annonceurs
              </p>
            </div>
          </div>
        </div>

        {/* Formulaire */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Type de compte */}
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">Type de compte *</span>
              <div className="grid grid-cols-3 gap-4">
                {(
                  [
                    {
                      value: 'admin',
                      label: 'Administrateur',
                      desc: 'Accès complet',
                      Icon: Shield,
                    },
                    {
                      value: 'screenhost_agent',
                      label: 'Agent ScreenHost',
                      desc: 'Inventaire / établissements',
                      Icon: Monitor,
                    },
                    {
                      value: 'screencast_agent',
                      label: 'Agent ScreenCast',
                      desc: 'Acquisition annonceurs',
                      Icon: Cast,
                    },
                  ] as const
                ).map(({ value, label, desc, Icon }) => {
                  const selected = formData.role === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFormData({ ...formData, role: value })}
                      className={`p-4 border-2 rounded-lg transition-all ${
                        selected
                          ? 'border-brand-primary bg-brand-primary bg-opacity-10'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <Icon
                        className={`h-8 w-8 mx-auto mb-2 ${selected ? 'text-brand-primary' : 'text-gray-400'}`}
                      />
                      <p
                        className={`font-semibold ${selected ? 'text-brand-primary' : 'text-gray-700'}`}
                      >
                        {label}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">{desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Informations personnelles */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-sm font-medium text-gray-700 mb-2"
                  htmlFor="first-name"
                >
                  Prénom *
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input
                    type="text"
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    placeholder="Prénom"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                    required
                    id="first-name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="last-name">
                  Nom *
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input
                    type="text"
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    placeholder="Nom"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                    required
                    id="last-name"
                  />
                </div>
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="email">
                Adresse email *
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="admin@example.com"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  required
                  id="email"
                />
              </div>
            </div>

            {/* Mot de passe */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="password">
                Mot de passe *
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Minimum 12 caractères"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  required
                  id="password"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Minimum 12 caractères</p>
            </div>

            {/* Confirmation mot de passe */}
            <div>
              <label
                className="block text-sm font-medium text-gray-700 mb-2"
                htmlFor="confirm-password"
              >
                Confirmer le mot de passe *
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="Confirmer le mot de passe"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  required
                  id="confirm-password"
                />
              </div>
            </div>

            {/* Message de succès */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3 mt-0.5" />
                <div className="text-sm text-green-700">
                  <p className="font-medium mb-1">Le compte sera activé immédiatement</p>
                  <p>
                    L'utilisateur pourra se connecter dès la création du compte avec ses
                    identifiants.
                  </p>
                </div>
              </div>
            </div>

            {/* Boutons */}
            <div className="flex justify-end space-x-4 pt-4">
              <button
                type="button"
                onClick={() => navigate('/admin-dashboard')}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Création en cours...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-5 w-5 mr-2" />
                    Créer le compte
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AdminLayout>
  );
}
