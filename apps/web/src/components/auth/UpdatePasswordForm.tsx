import { Eye, EyeOff, Lock, CheckCircle } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { authService } from '../../services/auth.service';
import { isErrorWithCode } from '../../lib/errors';

export default function UpdatePasswordForm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const validatePassword = (password: string) => {
    const hasMinLength = password.length >= 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    return hasMinLength && hasUpperCase && hasLowerCase && hasNumber;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validatePassword(password)) {
      toast.error('Le mot de passe ne respecte pas les critères de sécurité');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }

    setLoading(true);
    try {
      await authService.updatePassword(password);
      toast.success('Mot de passe mis à jour avec succès');
      navigate('/login');
    } catch (error) {
      const _err = isErrorWithCode(error) ? error : null;
      toast.error(_err?.message || "Une erreur inattendue s'est produite");
    } finally {
      setLoading(false);
    }
  };

  const passwordValidation = {
    minLength: password.length >= 8,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-white mb-2">
          Nouveau mot de passe
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/60" />
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-10 pr-12 py-3 bg-white/10 border border-white/20 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent transition-all duration-200 text-white placeholder-white/50 backdrop-blur-sm"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/60 hover:text-white transition-colors duration-200"
          >
            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>

        {/* Indicateurs de validation du mot de passe */}
        <div className="mt-3 space-y-2">
          <div className="flex items-center text-xs">
            <CheckCircle
              className={`w-4 h-4 mr-2 ${passwordValidation.minLength ? 'text-[#00B3A6]' : 'text-white/40'}`}
            />
            <span className={passwordValidation.minLength ? 'text-white' : 'text-white/60'}>
              Au moins 8 caractères
            </span>
          </div>
          <div className="flex items-center text-xs">
            <CheckCircle
              className={`w-4 h-4 mr-2 ${passwordValidation.hasUpperCase ? 'text-[#00B3A6]' : 'text-white/40'}`}
            />
            <span className={passwordValidation.hasUpperCase ? 'text-white' : 'text-white/60'}>
              Une lettre majuscule
            </span>
          </div>
          <div className="flex items-center text-xs">
            <CheckCircle
              className={`w-4 h-4 mr-2 ${passwordValidation.hasLowerCase ? 'text-[#00B3A6]' : 'text-white/40'}`}
            />
            <span className={passwordValidation.hasLowerCase ? 'text-white' : 'text-white/60'}>
              Une lettre minuscule
            </span>
          </div>
          <div className="flex items-center text-xs">
            <CheckCircle
              className={`w-4 h-4 mr-2 ${passwordValidation.hasNumber ? 'text-[#00B3A6]' : 'text-white/40'}`}
            />
            <span className={passwordValidation.hasNumber ? 'text-white' : 'text-white/60'}>
              Un chiffre
            </span>
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="confirm-password" className="block text-sm font-medium text-white mb-2">
          Confirmer le mot de passe
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/60" />
          <input
            id="confirm-password"
            type={showPassword ? 'text' : 'password'}
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent transition-all duration-200 text-white placeholder-white/50 backdrop-blur-sm"
            placeholder="••••••••"
          />
        </div>
        {confirmPassword && password !== confirmPassword && (
          <p className="mt-2 text-sm text-red-400">Les mots de passe ne correspondent pas</p>
        )}
      </div>

      <div>
        <button
          type="submit"
          disabled={loading || !validatePassword(password) || password !== confirmPassword}
          className="w-full px-5 py-3 bg-gradient-to-r from-[#00B3A6] to-[#00B3A6]/80 text-white font-semibold text-base rounded-xl hover:shadow-lg hover:shadow-[#00B3A6]/25 transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center"
        >
          {loading ? (
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
              Mise à jour...
            </div>
          ) : (
            'Mettre à jour le mot de passe'
          )}
        </button>
      </div>
    </form>
  );
}
