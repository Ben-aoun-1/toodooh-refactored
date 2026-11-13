import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import WizardExitDialog from '@/features/campaigns/components/WizardExitDialog';
import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import { useDeleteCampaign, useUpdateCampaign } from '@/features/campaigns/hooks/useCampaignApi';
import { campaignsApi } from '@/features/campaigns/services/campaigns.api';
import { useCartMutations } from '@/features/cart/hooks/useCart';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import EventGroupRecapStep, { type GroupMatchLine } from '../components/EventGroupRecapStep';
import FootCreativeStep from '../components/positioning/FootCreativeStep';
import FootZonesStep from '../components/positioning/FootZonesStep';
import GroupTicket from '../components/positioning/GroupTicket';
import PositioningHero from '../components/positioning/PositioningHero';
import { useEventsCatalogue } from '../hooks/useEvents';
import { cardTitle, dateLine, hourLabel } from '../lib/event-catalogue';
import { parseGroupIds } from '../lib/event-group';
import { groupMinutesTotal } from '../lib/event-minutes';
import { EVENTS_PATHS } from '../lib/events-home';

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
 * alone. Quitter deletes the N fresh drafts; Enregistrer keeps them as Brouillons. Drawn like the
 * single parcours (Mariem's 04/11 mockup), with a ticket listing the matches.
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
      navigate(exitTo ?? EVENTS_PATHS.football);
    });

  if (ids.length === 0) {
    navigate(EVENTS_PATHS.football);
    return null;
  }

  // Full bleed like the single parcours (EventPositioning).
  return (
    <div className="-mx-4 -my-6 min-h-full bg-stadium-stage sm:-mx-6 lg:-mx-8 lg:-my-8">
      <PositioningHero
        title="Je me positionne"
        subtitle={`${ids.length} matchs, un seul média, vos minutes match par match`}
        steps={STEPS}
        currentStep={step}
        onStep={setStep}
        onCancel={() => setExitTo(EVENTS_PATHS.football)}
      />

      <div className="relative z-[2] -mt-14 px-4 pb-10 sm:px-6 lg:px-8">
        <GroupTicket lines={lines} />

        {step === 1 && (
          <FootZonesStep
            zoneIds={zoneIds}
            setZoneIds={setZoneIds}
            draftCampaignId={ids[0] ?? null}
            saving={busy}
            onNext={handleZonesNext}
            onBack={() => setExitTo(EVENTS_PATHS.football)}
          />
        )}
        {step === 2 && (
          <FootCreativeStep
            draftCampaignId={ids[0] ?? null}
            userId={user?.id}
            selectedCreativeId={creativeId}
            onSelectCreative={handleSelectCreative}
            onDeselectCreative={handleDeselectCreative}
            linking={busy}
            eventMinutes={groupMinutesTotal(ids, minutes)}
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
      </div>

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
