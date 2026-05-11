import { Mail } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { authService } from '../../services/auth.service';

export default function ResetPasswordForm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await authService.resetPassword(email);
      toast.success('Un email de réinitialisation vous a été envoyé');
      navigate('/login');
    } catch (error: any) {
      toast.error(error?.message || "Une erreur inattendue s'est produite");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
          Email professionnel <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6]/30 focus:border-[#00B3A6] transition-all text-sm text-gray-900 placeholder-gray-400"
            placeholder="contact@entreprise.com"
          />
        </div>
      </div>

      {/* Bouton */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-xl font-semibold text-base text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: '#76E6AB' }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
            Envoi en cours...
          </span>
        ) : (
          'Modifier le mot de passe'
        )}
      </button>

      {/* Lien retour */}
      <p className="text-center text-sm text-gray-500 pt-2">
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="text-gray-700 underline underline-offset-2 hover:text-gray-900 transition-colors"
        >
          Revenir à la page d&apos;accueil
        </button>
      </p>
    </form>
  );
}
