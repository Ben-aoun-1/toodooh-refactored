import { Check, Eye, EyeOff, Wifi } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';

import { getErrorMessage } from '@/lib/errors';

import type { ScreenhostWifi, WifiPatch } from '../services/screenhost.service';

const INPUT_CLASS =
  'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary bg-white';

/**
 * One screenhost's WiFi editor — the single source of truth for the WRITE-ONLY password UX, shared
 * by the owner (OwnerWifiSlot) and admin (AdminUserWifiSlot) surfaces so the secret handling lives
 * in ONE place. The password is never prefilled or shown; leaving it blank keeps the stored secret.
 * Saving sends only the changed fields (SSID emptied → null to clear; password sent only when typed)
 * and clears the password input on success. `onSave` performs the actual mutation (owner vs admin).
 */
export default function ScreenhostWifiEditorCard({
  screenhost,
  onSave,
}: {
  screenhost: ScreenhostWifi;
  onSave: (patch: WifiPatch) => Promise<void>;
}) {
  const [ssid, setSsid] = useState(screenhost.wifi_ssid ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-sync the SSID when the data refetches after a save; the password stays blank (write-only).
  useEffect(() => {
    setSsid(screenhost.wifi_ssid ?? '');
  }, [screenhost.wifi_ssid]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const nextSsid = ssid.trim();
    const ssidChanged = nextSsid !== (screenhost.wifi_ssid ?? '');
    const passwordProvided = password.length > 0;

    if (!ssidChanged && !passwordProvided) {
      toast.error('Aucune modification à enregistrer');
      return;
    }

    // Send only what changed. SSID: emptied → null (clear), else the new value. Password: only when
    // the owner/admin typed one (blank keeps the stored secret).
    const patch: WifiPatch = {};
    if (ssidChanged) patch.wifi_ssid = nextSsid === '' ? null : nextSsid;
    if (passwordProvided) patch.wifi_password = password;

    setSaving(true);
    try {
      await onSave(patch);
      setPassword('');
      toast.success('WiFi du lieu enregistré');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la mise à jour du WiFi');
    } finally {
      setSaving(false);
    }
  };

  const ssidId = `wifi-ssid-${screenhost.id}`;
  const passwordId = `wifi-password-${screenhost.id}`;

  return (
    <form
      onSubmit={handleSave}
      className="rounded-xl border border-gray-200 bg-white p-5 space-y-4"
    >
      <div className="flex items-center gap-2">
        <Wifi className="h-5 w-5 text-brand-deep" />
        <h3 className="text-sm font-semibold text-gray-900">{screenhost.name}</h3>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={ssidId}>
          Nom du réseau (SSID)
        </label>
        <input
          type="text"
          id={ssidId}
          value={ssid}
          onChange={(e) => setSsid(e.target.value)}
          className={INPUT_CLASS}
          placeholder="Nom du réseau WiFi"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={passwordId}>
          Mot de passe WiFi
        </label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            id={passwordId}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${INPUT_CLASS} pr-11`}
            placeholder="••••••••"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            Laisser vide pour conserver le mot de passe actuel.
          </p>
          {screenhost.wifi_password_set && (
            <span className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
              <Check className="h-4 w-4 text-green-600" />
              Mot de passe enregistré
            </span>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-xl font-medium text-brand-deep bg-brand-primary hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
