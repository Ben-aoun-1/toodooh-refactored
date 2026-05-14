import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate, Link } from 'react-router-dom';

import { useAuthStore } from '../../stores/auth.store';
import { getErrorMessage } from '../../lib/errors';

export default function LoginForm() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await login(formData.email, formData.password);
      const { profileType } = useAuthStore.getState();

      if (profileType === 'individual_owner' || profileType === 'fleet_owner') {
        navigate('/owner-dashboard');
      } else {
        navigate('/dashboard');
      }

      toast.success('Connexion réussie');
    } catch (error) {
      toast.error(getErrorMessage(error) || "Une erreur inattendue s'est produite");
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
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6]/30 focus:border-[#00B3A6] transition-all text-sm text-gray-900 placeholder-gray-400"
            placeholder="contact@entreprise.com"
          />
        </div>
      </div>

      {/* Mot de passe */}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
          Mot de passe <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full pl-11 pr-11 py-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6]/30 focus:border-[#00B3A6] transition-all text-sm text-gray-900 placeholder-gray-400"
            placeholder="••••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Se souvenir / Mot de passe oublié */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            id="remember-me"
            name="remember-me"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded"
          />
          <label htmlFor="remember-me" className="text-sm text-gray-600">
            Se souvenir de moi
          </label>
        </div>
        <button
          type="button"
          onClick={() => navigate('/reset-password')}
          className="text-sm text-gray-600 underline underline-offset-2 hover:text-gray-900 transition-colors"
        >
          Mot de passe oublié ?
        </button>
      </div>

      {/* Bouton Se connecter */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-xl font-semibold text-base text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: '#76E6AB' }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
            Connexion en cours...
          </span>
        ) : (
          'Se connecter'
        )}
      </button>

      {/* Lien inscription */}
      <p className="text-center text-sm text-gray-500 pt-2">
        Pas encore de compte ?{' '}
        <Link
          to="/signup"
          className="text-gray-700 underline underline-offset-2 hover:text-gray-900 transition-colors"
        >
          S&apos;inscrire
        </Link>
      </p>
    </form>
  );
}
