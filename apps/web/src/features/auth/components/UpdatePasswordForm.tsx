import { Eye, EyeOff, Lock, CheckCircle, XCircle } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { authService } from '@/features/auth/services/auth.service';
import {
  isValidPassword,
  passwordChecks,
  PASSWORD_MIN_LENGTH,
} from '@/features/auth/utils/password';
import { getErrorMessage } from '@/lib/errors';

// Phase-1f F6 — the reset-LANDING. better-auth's reset link (/auth/reset-password/:token) redirects
// here with ?token= (valid) or ?error= (invalid/expired). The form posts the token + new password to
// POST /api/password/reset (revokes all sessions → the user signs in after). 12-char via the shared
// util (the FE accepts exactly what the backend accepts).
export default function UpdatePasswordForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const linkError = params.get('error');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const checks = passwordChecks(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast.error('Lien de réinitialisation invalide.');
      return;
    }
    if (!isValidPassword(password)) {
      toast.error('Le mot de passe ne respecte pas les critères de sécurité');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }

    setLoading(true);
    try {
      await authService.confirmPasswordReset(token, password);
      toast.success('Mot de passe mis à jour. Veuillez vous connecter.');
      navigate('/login');
    } catch (error) {
      toast.error(getErrorMessage(error) || "Une erreur inattendue s'est produite");
    } finally {
      setLoading(false);
    }
  };

  // Invalid / expired link (or no token): better-auth redirected with ?error=, or the page was
  // opened directly. Offer a fresh request rather than a broken form.
  if (!token || linkError) {
    return (
      <div className="space-y-5 text-center">
        <XCircle className="mx-auto h-14 w-14 text-red-500" />
        <p className="text-sm text-gray-600">
          Ce lien de réinitialisation est invalide ou a expiré.
        </p>
        <Link
          to="/reset-password"
          className="block w-full py-3.5 rounded-xl font-semibold text-base text-brand-deep text-center bg-brand-primary hover:opacity-90 transition-opacity"
        >
          Demander un nouveau lien
        </Link>
      </div>
    );
  }

  const rule = (ok: boolean, label: string) => (
    <div className="flex items-center text-xs">
      <CheckCircle className={`w-4 h-4 mr-2 ${ok ? 'text-brand-primary' : 'text-gray-300'}`} />
      <span className={ok ? 'text-gray-700' : 'text-gray-400'}>{label}</span>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
          Nouveau mot de passe
        </label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-11 pr-11 py-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-all text-sm text-gray-900 placeholder-gray-400"
            placeholder="••••••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {rule(checks.minLen, `Au moins ${PASSWORD_MIN_LENGTH} caractères`)}
          {rule(checks.upper, 'Une lettre majuscule')}
          {rule(checks.lower, 'Une lettre minuscule')}
          {rule(checks.digit, 'Un chiffre')}
        </div>
      </div>

      <div>
        <label
          htmlFor="confirm-password"
          className="block text-sm font-medium text-gray-700 mb-1.5"
        >
          Confirmer le mot de passe
        </label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="confirm-password"
            type={showPassword ? 'text' : 'password'}
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-all text-sm text-gray-900 placeholder-gray-400"
            placeholder="••••••••••••"
          />
        </div>
        {confirmPassword && password !== confirmPassword && (
          <p className="mt-2 text-sm text-red-600">Les mots de passe ne correspondent pas</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !isValidPassword(password) || password !== confirmPassword}
        className="w-full py-3.5 rounded-xl font-semibold text-base text-brand-deep bg-brand-primary hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
            Mise à jour...
          </span>
        ) : (
          'Mettre à jour le mot de passe'
        )}
      </button>
    </form>
  );
}
