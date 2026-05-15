import { UserPlus, Shield, User, Mail, Lock, AlertCircle, CheckCircle } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { getErrorMessage } from '../../../lib/errors';
import AdminLayout from '../components/AdminLayout';
import { adminService } from '../services/admin.service';
import { useAdminStore } from '../stores/admin.store';

interface AdminFormData {
  email: string;
  password: string;
  confirmPassword: string;
  first_name: string;
  last_name: string;
  role: 'admin' | 'moderator';
}

export default function CreateAdmin() {
  const { admin } = useAdminStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<AdminFormData>({
    email: '',
    password: '',
    confirmPassword: '',
    first_name: '',
    last_name: '',
    role: 'admin',
  });

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

    if (formData.password.length < 6) {
      return 'Le mot de passe doit contenir au moins 6 caractères';
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

    if (!admin) {
      toast.error('Vous devez être connecté');
      return;
    }

    setLoading(true);
    try {
      await adminService.createAdmin(
        {
          email: formData.email,
          password: formData.password,
          first_name: formData.first_name,
          last_name: formData.last_name,
          role: formData.role,
          permissions: [],
        },
        admin.id,
      );

      toast.success(
        `${formData.role === 'admin' ? 'Administrateur' : 'Modérateur'} créé avec succès !`,
      );

      // Réinitialiser le formulaire
      setFormData({
        email: '',
        password: '',
        confirmPassword: '',
        first_name: '',
        last_name: '',
        role: 'admin',
      });

      // Log l'activité
      await adminService.logActivity({
        admin_id: admin.id,
        action: 'create_admin',
        target_type: 'admin',
        description: `Création d'un ${formData.role === 'admin' ? 'administrateur' : 'modérateur'}: ${formData.first_name} ${formData.last_name}`,
      });
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  // Vérifier que l'utilisateur est super admin
  if (!admin || admin.role !== 'superadmin') {
    return (
      <AdminLayout title="Créer un Admin" subtitle="Accès réservé au Super Administrateur">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Accès Refusé</h3>
          <p className="text-gray-600 mb-6">
            Seul le Super Administrateur peut créer des administrateurs et modérateurs.
          </p>
          <button
            onClick={() => navigate('/admin-dashboard')}
            className="px-6 py-2 bg-[#00B3A6] text-white rounded-lg hover:bg-[#008C82] transition-colors"
          >
            Retour au Dashboard
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Créer un Admin" subtitle="Ajouter un administrateur ou modérateur">
      <div className="max-w-3xl mx-auto">
        {/* En-tête informatif */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-start">
            <Shield className="h-6 w-6 text-blue-600 mr-3 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-blue-900 mb-1">
                Création de compte administrateur
              </h4>
              <p className="text-sm text-blue-700">
                <strong>Administrateur :</strong> Accès complet à toutes les fonctionnalités (sauf
                création d'autres admins)
                <br />
                <strong>Modérateur :</strong> Accès limité aux fonctions de modération et validation
              </p>
            </div>
          </div>
        </div>

        {/* Formulaire */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Type de compte */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type de compte *
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, role: 'admin' })}
                  className={`p-4 border-2 rounded-lg transition-all ${
                    formData.role === 'admin'
                      ? 'border-[#00B3A6] bg-[#00B3A6] bg-opacity-10'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <Shield
                    className={`h-8 w-8 mx-auto mb-2 ${
                      formData.role === 'admin' ? 'text-[#00B3A6]' : 'text-gray-400'
                    }`}
                  />
                  <p
                    className={`font-semibold ${
                      formData.role === 'admin' ? 'text-[#00B3A6]' : 'text-gray-700'
                    }`}
                  >
                    Administrateur
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Accès complet</p>
                </button>

                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, role: 'moderator' })}
                  className={`p-4 border-2 rounded-lg transition-all ${
                    formData.role === 'moderator'
                      ? 'border-[#00B3A6] bg-[#00B3A6] bg-opacity-10'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <User
                    className={`h-8 w-8 mx-auto mb-2 ${
                      formData.role === 'moderator' ? 'text-[#00B3A6]' : 'text-gray-400'
                    }`}
                  />
                  <p
                    className={`font-semibold ${
                      formData.role === 'moderator' ? 'text-[#00B3A6]' : 'text-gray-700'
                    }`}
                  >
                    Modérateur
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Accès limité</p>
                </button>
              </div>
            </div>

            {/* Informations personnelles */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Prénom *</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input
                    type="text"
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    placeholder="Prénom"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nom *</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input
                    type="text"
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    placeholder="Nom"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  required
                />
              </div>
            </div>

            {/* Mot de passe */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Mot de passe *</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Minimum 6 caractères"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  required
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Minimum 6 caractères</p>
            </div>

            {/* Confirmation mot de passe */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  required
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
                className="px-6 py-3 bg-[#00B3A6] text-white rounded-lg hover:bg-[#008C82] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
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
