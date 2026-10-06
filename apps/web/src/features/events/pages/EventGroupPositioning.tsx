import { useQueries, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import WizardExitDialog from '@/features/campaigns/components/WizardExitDialog';
import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import { useDeleteCampaign, useUpdateCampaign } from '@/features/campaigns/hooks/useCampaignApi';
import StepCreative from '@/features/campaigns/pages/new-campaign/StepCreative';
import StepZones from '@/features/campaigns/pages/new-campaign/StepZones';
import { campaignsApi } from '@/features/campaigns/services/campaigns.api';
import { useCartMutations } from '@/features/cart/hooks/useCart';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import EventGroupRecapStep, { type GroupMatchLine } from '../components/EventGroupRecapStep';
import { useEventsCatalogue } from '../hooks/useEvents';
import { cardTitle, dateLine, hourLabel } from '../lib/event-catalogue';
import { parseGroupIds } from '../lib/event-group';

const log = logger.child({ module: 'EventGroupPositioning' });

const STEPS = [
  { id: 1, title: 'Zones' },
  { id: 2, title: 'Média' },
  { id: 3, title: 'Récapitulatif' },
] as const;

/**
 * EVT-CAT2 — the MULTI-MATCH positioning parcours (operator ruling 2026-10-06): « Je me positionne
 * sur ces N événements » created N positioning drafts (one per match); this page runs them as one
 * — the same zones and the same uploaded media for all, then the Récapitulatif's big minutes
 * slider + one small slider per match, and « Ajouter au panier » files all N (payment = the
 * panier). Each draft stays a classic positioning row: the api prices, gates and dispatches it
 * alone. Quitter deletes the N fresh drafts; Enregistrer keeps them as Brouillons.
 */
export default function EventGroupPositioning() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const ids = useMemo(() => parseGroupIds(location.search), [location.search]);

  const campaigns = useQueries({
    queries: ids.map((id) => ({
      queryKey: campaignsKeys.detail(id),
      queryFn: () => campaignsApi.get(id),
    })),
  });
  const updateCampaign = useUpdateCampaign(user?.id);
  const deleteCampaign = useDeleteCampaign(user?.id);
  const { addToCart } = useCartMutations(user?.id);
  const { data: catalogue } = useEventsCatalogue();

  const [step, setStep] = useState(1);
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [creativeId, setCreativeId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [exitTo, setExitTo] = useState<string | null>(null);

  // Hydrate once from the first draft (all N share zones + media by construction).
  const first = campaigns[0]?.data;
  useEffect(() => {
    if (!first) return;
    setZoneIds((prev) => (prev.length > 0 ? prev : (first.zones ?? []).map((z) => z.zone_id)));
    setCreativeId((prev) => prev ?? first.creative_id);
  }, [first]);

  const lines: GroupMatchLine[] = ids.map((id, i) => {
    const c = campaigns[i]?.data;
    const event = (catalogue ?? []).find((e) => e.id === c?.event_id);
    return {
      campaignId: id,
      title: event ? cardTitle(event) : (c?.name ?? 'Match'),
      subtitle: event
        ? `${dateLine(event)}${event.time_tbc ? '' : `, ${hourLabel(event.kickoff_at)}`}`
        : '',
    };
  });

  /** Apply one PATCH to every draft of the group. */
  const patchAll = useCallback(
    async (input: Parameters<typeof campaignsApi.update>[1]) => {
      for (const id of ids) await updateCampaign.mutateAsync({ id, input });
    },
    [ids, updateCampaign],
  );

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(getErrorMessage(error) || label);
      log.error({ err: error }, label);
    } finally {
      setBusy(false);
    }
  };

  const handleZonesNext = () =>
    run("Échec de l'enregistrement des zones", async () => {
      await patchAll({ zone_ids: zoneIds });
      setStep(2);
    });

  const handleSelectCreative = (id: string) =>
    run('Erreur lors de l’association du média', async () => {
      await patchAll({ creative_id: id });
      setCreativeId(id);
    });

  const handleDeselectCreative = () =>
    run('Erreur lors de la désélection du média', async () => {
      await patchAll({ creative_id: null });
      setCreativeId(null);
    });

  const saveMinutes = async () => {
    for (const id of ids) {
      const m = minutes[id];
      if (m != null) await updateCampaign.mutateAsync({ id, input: { event_minutes: m } });
    }
  };

  const handleAddToCart = () =>
    run('Erreur lors de l’ajout au panier', async () => {
      await saveMinutes();
      for (const id of ids) await addToCart.mutateAsync(id);
      void queryClient.invalidateQueries({ queryKey: campaignsKeys.all });
      toast.success(`${ids.length} positionnements ajoutés au panier.`);
      navigate('/my-cart');
    });

  const handleSave = () =>
    run('Erreur lors de l’enregistrement du brouillon', async () => {
      await patchAll({ zone_ids: zoneIds });
      await saveMinutes();
      toast.success('Brouillons enregistrés.');
      navigate('/my-campaigns');
    });

  const handleQuit = () =>
    run('Erreur lors de la suppression des brouillons', async () => {
      for (const id of ids) await deleteCampaign.mutateAsync(id);
      navigate(exitTo ?? '/evenements');
    });

  if (ids.length === 0) {
    navigate('/evenements');
    return null;
  }

  return (
    <div className="mx-auto w-full space-y-6">
      <div className="rounded-xl bg-white p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900">Je me positionne</h1>
            <p className="text-sm text-gray-600">
              {ids.length} matchs, un seul média, vos minutes match par match
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExitTo('/evenements')}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <X className="h-5 w-5" />
            <span>Annuler</span>
          </button>
        </div>
        <div className="flex w-full items-center">
          {STEPS.map((s, index) => (
            <React.Fragment key={s.id}>
              <div className="flex flex-1 flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                    step > s.id
                      ? 'bg-brand-primary text-brand-deep'
                      : step === s.id
                        ? 'border-2 border-brand-primary text-brand-deep'
                        : 'border border-gray-300 text-gray-400'
                  }`}
                >
                  {s.id}
                </div>
                <span
                  className={`mt-1.5 text-xs ${step === s.id ? 'font-semibold text-gray-900' : 'text-gray-500'}`}
                >
                  {s.title}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <ChevronRight
                  className="mt-[-14px] h-5 w-5 flex-shrink-0 text-gray-300"
                  aria-hidden
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      <ul className="flex flex-wrap gap-2">
        {lines.map((l) => (
          <li
            key={l.campaignId}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700"
          >
            {l.title}
          </li>
        ))}
      </ul>

      {step === 1 && (
        <StepZones
          zoneIds={zoneIds}
          setZoneIds={setZoneIds}
          draftCampaignId={ids[0] ?? null}
          saving={busy}
          onNext={handleZonesNext}
          onBack={() => setExitTo('/evenements')}
        />
      )}
      {step === 2 && (
        <StepCreative
          draftCampaignId={ids[0] ?? null}
          userId={user?.id}
          selectedCreativeId={creativeId}
          onSelectCreative={handleSelectCreative}
          onDeselectCreative={handleDeselectCreative}
          linking={busy}
          eventMode
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <EventGroupRecapStep
          lines={lines}
          minutes={minutes}
          setMinutes={setMinutes}
          onAddToCart={handleAddToCart}
          adding={busy}
          onBack={() => setStep(2)}
        />
      )}

      <WizardExitDialog
        open={exitTo !== null}
        busy={busy}
        onQuit={() => void handleQuit()}
        onCancel={() => setExitTo(null)}
        onSave={() => void handleSave()}
      />
    </div>
  );
}
