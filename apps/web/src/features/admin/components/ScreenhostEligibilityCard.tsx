import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';

import ScreenhostLiveness from '@/features/admin/components/ScreenhostLiveness';
import ScreenhostSpsBreakdown from '@/features/admin/components/ScreenhostSpsBreakdown';
import { useUpdateScreenhostEligibility } from '@/features/admin/hooks/useAdminScreenhostEligibility';
import {
  ELIGIBILITY_CONSEQUENCE_NOTE,
  ELIGIBILITY_ERROR_TOAST,
  ELIGIBILITY_SAVED_TOAST,
  NO_CHANGES_TOAST,
  VENUE_CLASS_OPTIONS,
  buildEligibilityPatch,
  eligibilityReadiness,
  formStateFromView,
  mapEligibilityServerErrors,
  readinessBadgeLabel,
  validateEligibilityForm,
  type EligibilityFieldErrors,
} from '@/features/admin/lib/venue-eligibility';
import type {
  ScreenhostEligibility,
  VenueClass,
} from '@/features/admin/services/admin-screenhost.service';
import type { BusinessSector } from '@/features/auth/types/auth';
import { HOUR_OPTIONS } from '@/features/screenhost/lib/venue-hours';
import type { ScreenhostWifi } from '@/features/screenhost/services/screenhost.service';
import { ApiError } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';

const SELECT_CLASS =
  'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary bg-white';

/** '' encodes null in the selects (« — » clears the field). */
const CLEAR = '';

/**
 * EL1 — one venue's « Éligibilité dispatch » editor (admin-only): catégorie (owner sectors),
 * classe, horaires (single-window pair), capacité de diffusion. Prefilled from the eligibility
 * GET; saves the DIRTY fields only (null clears). The client mirrors the pair rules (set-together,
 * ouverture < fermeture) and the positive-int capacity BEFORE the PATCH; a 400's fields[] is
 * mapped back under the matching inputs in French.
 */
export default function ScreenhostEligibilityCard({
  screenhost,
  sectors,
  view,
}: {
  screenhost: ScreenhostWifi;
  sectors: BusinessSector[];
  view: ScreenhostEligibility;
}) {
  const [form, setForm] = useState(() => formStateFromView(view));
  const [errors, setErrors] = useState<EligibilityFieldErrors>({});
  const updateEligibility = useUpdateScreenhostEligibility();

  // Re-sync after a save writes the fresh view into the cache (the cards' refetch idiom).
  useEffect(() => {
    setForm(formStateFromView(view));
  }, [view]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const clientErrors = validateEligibilityForm(form);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    const patch = buildEligibilityPatch(view, form);
    if (Object.keys(patch).length === 0) {
      toast.error(NO_CHANGES_TOAST);
      return;
    }

    try {
      await updateEligibility.mutateAsync({ screenhostId: screenhost.id, patch });
      toast.success(ELIGIBILITY_SAVED_TOAST);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.fields) {
        const serverErrors = mapEligibilityServerErrors(err.fields);
        if (Object.keys(serverErrors).length > 0) {
          setErrors(serverErrors);
          return;
        }
      }
      toast.error(getErrorMessage(err) || ELIGIBILITY_ERROR_TOAST);
    }
  };

  const fieldError = (key: keyof EligibilityFieldErrors) =>
    errors[key] ? <p className="mt-1 text-sm text-red-600">{errors[key]}</p> : null;

  const readiness = eligibilityReadiness(view);

  const idFor = (field: string) => `eligibility-${field}-${screenhost.id}`;

  return (
    <form
      onSubmit={(e) => void handleSave(e)}
      className="rounded-xl border border-gray-200 bg-white p-5 space-y-4"
    >
      {/* FCT1 rider — flex-wrap: the long « Incomplet — … » badge used to be flex-shrink-0 in a
          nowrap row and crushed the truncating venue name to zero width on narrow cards; wrapping
          drops the badge to its own line instead, so the name survives. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <SlidersHorizontal className="h-5 w-5 text-brand-deep flex-shrink-0" />
          <h3 className="text-sm font-semibold text-gray-900 truncate">{screenhost.name}</h3>
        </div>
        {/* EL1 commit 2 — the readiness verdict on the venue row, from the SAVED view (not the
            in-progress form): flips only once the fields actually persist. */}
        {readiness.eligible ? (
          <span className="text-xs font-medium text-green-800 bg-green-100 rounded-full px-3 py-1 flex-shrink-0 max-w-full truncate">
            {readinessBadgeLabel(readiness)}
          </span>
        ) : (
          <span className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-3 py-1 flex-shrink-0 max-w-full truncate">
            {readinessBadgeLabel(readiness)}
          </span>
        )}
      </div>

      {/* E4 — the SPS insight beside the readiness badge (read-only; the operator/Mejri read it
          during testing). */}
      <ScreenhostSpsBreakdown screenhostId={screenhost.id} />

      {/* CF-HF4 — the LIVE devices line (« N écran(s) » + state chip, the E6 heartbeat truth). */}
      <ScreenhostLiveness screenhostId={screenhost.id} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={idFor('sector')} className="block text-sm font-medium text-gray-700 mb-1">
            Catégorie
          </label>
          <select
            id={idFor('sector')}
            value={form.businessSectorId ?? CLEAR}
            onChange={(e) => setForm((f) => ({ ...f, businessSectorId: e.target.value || null }))}
            className={SELECT_CLASS}
          >
            <option value={CLEAR}>—</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {fieldError('business_sector_id')}
        </div>

        <div>
          <label htmlFor={idFor('class')} className="block text-sm font-medium text-gray-700 mb-1">
            Classe
          </label>
          <select
            id={idFor('class')}
            value={form.venueClass ?? CLEAR}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                venueClass: e.target.value === CLEAR ? null : (e.target.value as VenueClass),
              }))
            }
            className={SELECT_CLASS}
          >
            <option value={CLEAR}>—</option>
            {VENUE_CLASS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {fieldError('class')}
        </div>

        <div>
          <label
            htmlFor={idFor('opening')}
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Ouverture
          </label>
          <select
            id={idFor('opening')}
            value={form.openingHour ?? CLEAR}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                openingHour: e.target.value === CLEAR ? null : Number(e.target.value),
              }))
            }
            className={SELECT_CLASS}
          >
            <option value={CLEAR}>—</option>
            {HOUR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {fieldError('opening_hour')}
        </div>

        <div>
          <label
            htmlFor={idFor('closing')}
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Fermeture
          </label>
          <select
            id={idFor('closing')}
            value={form.closingHour ?? CLEAR}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                closingHour: e.target.value === CLEAR ? null : Number(e.target.value),
              }))
            }
            className={SELECT_CLASS}
          >
            <option value={CLEAR}>—</option>
            {HOUR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {fieldError('closing_hour')}
        </div>

        <div className="sm:col-span-2">
          <label
            htmlFor={idFor('capacity')}
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Capacité de diffusion
          </label>
          <input
            type="text"
            inputMode="numeric"
            id={idFor('capacity')}
            value={form.capacityInput}
            onChange={(e) => setForm((f) => ({ ...f, capacityInput: e.target.value }))}
            className={SELECT_CLASS}
            placeholder="Nombre de créneaux simultanés"
            autoComplete="off"
          />
          {fieldError('broadcast_capacity')}
        </div>
      </div>

      <p className="text-xs text-gray-500">{ELIGIBILITY_CONSEQUENCE_NOTE}</p>

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={updateEligibility.isPending}
          className="px-5 py-2.5 rounded-xl font-medium text-brand-deep bg-brand-primary hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {updateEligibility.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}
