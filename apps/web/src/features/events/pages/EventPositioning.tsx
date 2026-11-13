import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import WizardExitDialog from '@/features/campaigns/components/WizardExitDialog';
import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import {
  useCampaign,
  useDeleteCampaign,
  useUpdateCampaign,
} from '@/features/campaigns/hooks/useCampaignApi';
import { useZones } from '@/features/campaigns/hooks/useZones';
import {
  BUDGET_FLOOR_ERROR,
  isBudgetBelowMinimum,
  isBudgetExceedsCmax,
} from '@/features/campaigns/lib/cmax-budget';
import { setNavigationGuard } from '@/features/campaigns/lib/navigation-guard';
import { useCartMutations } from '@/features/cart/hooks/useCart';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import EventRecapStep from '../components/EventRecapStep';
import FootCreativeStep from '../components/positioning/FootCreativeStep';
import FootZonesStep from '../components/positioning/FootZonesStep';
import MatchTicket from '../components/positioning/MatchTicket';
import PositioningHero from '../components/positioning/PositioningHero';
import { useEventsCatalogue, useSuggestedEvents } from '../hooks/useEvents';
import { EVENTS_PATHS } from '../lib/events-home';
import { resumeStepFor } from '../lib/positioning-resume';

const log = logger.child({ module: 'EventPositioning' });

const STEPS = [
  { id: 1, title: 'Zones' },
  { id: 2, title: 'Vidéo' },
  { id: 3, title: 'Récapitulatif' },
] as const;

/**
 * EV3 — the 3-step positioning parcours (Zones → Vidéo → Récapitulatif), the match ticket PINNED
 * on top of every step, drawn as Mariem's 04/11 mockup (the lit pitch, the ticket, the step
 * cards). The positioning DRAFT already exists when this page opens (« Je me positionne »
 * creates it — POST /:id/positionner) so every step composes the CLASSIC draft machinery: the
 * zone replace-set PATCH, the creative-link PATCH (EVT-MIN1 spots only), the bounded minutes
 * slider on the EVENT ceiling, « Ajouter au panier » → the panier's Événements section. §1.9 exit
 * machinery reused whole (popup + beforeunload + browser-back sentinel); Quitter on a FRESH
 * parcours deletes the row, on a RESUMED one (Reprendre) it only leaves — the row IS already a
 * Brouillon server-side.
 */
export default function EventPositioning() {
  const navigate = useNavigate();
  const location = useLocation();
  const { campaignId } = useParams<{ campaignId: string }>();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  // Reprendre navigates with { resumed: true } — Quitter then never deletes the draft.
  const resumed: boolean = Boolean(location.state?.resumed);

  const campaign = useCampaign(campaignId ?? null);
  const updateCampaign = useUpdateCampaign(user?.id);
  const deleteCampaign = useDeleteCampaign(user?.id);
  const { addToCart } = useCartMutations(user?.id);

  // The match récap: the catalogue + suggested lists both feed the lookup (a positioning can
  // target either kind); the header degrades to the row's snapshotted name if neither has it.
  const { data: catalogue } = useEventsCatalogue();
  const { data: suggested } = useSuggestedEvents(true);
  const event = useMemo(() => {
    const eventId = campaign.data?.event_id;
    if (!eventId) return null;
    return (
      (catalogue ?? []).find((e) => e.id === eventId) ??
      (suggested ?? []).find((e) => e.id === eventId) ??
      null
    );
  }, [campaign.data?.event_id, catalogue, suggested]);

  const [currentStep, setCurrentStep] = useState(1);
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [creativeId, setCreativeId] = useState<string | null>(null);
  // EVT-MIN1 — a positioning is sized in MINUTES; the api derives its budget from them.
  const [eventMinutes, setEventMinutes] = useState<number | null>(null);

  // Hydrate ONCE from the loaded row (zones/creative/budget survive a resume).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !campaign.data) return;
    hydratedRef.current = true;
    setZoneIds((campaign.data.zones ?? []).map((z) => z.zone_id));
    setCreativeId(campaign.data.creative_id);
    setEventMinutes(campaign.data.event_minutes ?? null);
    // « Modifier » opens the récap (its minutes slider) — the Vidéo step while no spot is chosen.
    setCurrentStep(resumeStepFor(location.state, campaign.data.creative_id));
  }, [campaign.data, location.state]);

  const zonesQuery = useZones();
  const zoneNames = (zonesQuery.data ?? [])
    .filter((z) => zoneIds.includes(z.id))
    .map((z) => z.name);

  // ── §1.9 exit machinery (the NewCampaign idioms, reused whole) ────────────────────────────
  // Dirty = the editable state moved since the last persisted snapshot. The row itself is
  // ALWAYS a server-side Brouillon (auto-Brouillon by construction — created at entry).
  const snapshot = useCallback(
    () => JSON.stringify([zoneIds, creativeId, eventMinutes]),
    [zoneIds, creativeId, eventMinutes],
  );
  const savedSnapRef = useRef<string | null>(null);
  useEffect(() => {
    if (savedSnapRef.current === null && hydratedRef.current) savedSnapRef.current = snapshot();
  }, [snapshot]);
  const armed = savedSnapRef.current !== null && savedSnapRef.current !== snapshot();
  const armedRef = useRef(armed);
  armedRef.current = armed || (!resumed && Boolean(campaignId));

  const [exitPrompt, setExitPrompt] = useState<{ to: string } | null>(null);
  const [exitBusy, setExitBusy] = useState(false);

  useEffect(
    () =>
      setNavigationGuard((to) => {
        if (!armedRef.current) return true;
        setExitPrompt({ to });
        return false;
      }),
    [],
  );

  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const onPop = () => {
      if (!armedRef.current) return;
      window.history.pushState(null, '', window.location.href);
      setExitPrompt({ to: EVENTS_PATHS.football });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!armedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const requestExit = useCallback(
    (to: string) => {
      if (armedRef.current) setExitPrompt({ to });
      else navigate(to);
    },
    [navigate],
  );

  // Persist the dirty editable state (zones + minutes; the creative link PATCHes at click).
  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (!campaignId) return false;
    try {
      await updateCampaign.mutateAsync({
        id: campaignId,
        input: {
          zone_ids: zoneIds,
          ...(eventMinutes !== null ? { event_minutes: eventMinutes } : {}),
        },
      });
      savedSnapRef.current = snapshot();
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de l’enregistrement du brouillon');
      log.error({ err: error }, 'positioning draft save failed');
      return false;
    }
  }, [campaignId, updateCampaign, zoneIds, eventMinutes, snapshot]);

  // Enregistrer → the row stays a Brouillon (Mes campagnes · Reprendre resumes the parcours).
  const handleSave = useCallback(async () => {
    const ok = await persistDraft();
    if (ok) {
      armedRef.current = false;
      toast.success('Brouillon enregistré.');
      navigate('/my-campaigns');
    }
  }, [persistDraft, navigate]);

  // Quitter: a FRESH parcours deletes the row (no campaign left behind — the wizard's ruled
  // idiom); a RESUMED one only discards the unsaved edits (the Brouillon survives).
  const handleExitQuit = useCallback(async () => {
    const destination = exitPrompt?.to ?? EVENTS_PATHS.football;
    setExitBusy(true);
    try {
      if (!resumed && campaignId) {
        try {
          await deleteCampaign.mutateAsync(campaignId);
        } catch (error) {
          log.error({ err: error }, 'fresh positioning delete on quit failed');
        }
      }
    } finally {
      setExitBusy(false);
    }
    armedRef.current = false;
    setExitPrompt(null);
    navigate(destination);
  }, [exitPrompt, resumed, campaignId, deleteCampaign, navigate]);

  const handleExitSave = useCallback(async () => {
    setExitBusy(true);
    try {
      await handleSave();
    } finally {
      setExitBusy(false);
      setExitPrompt(null);
    }
  }, [handleSave]);

  // ── the steps ─────────────────────────────────────────────────────────────────────────────
  const [savingZones, setSavingZones] = useState(false);
  const handleZonesNext = useCallback(async () => {
    if (!campaignId) return;
    setSavingZones(true);
    try {
      await updateCampaign.mutateAsync({ id: campaignId, input: { zone_ids: zoneIds } });
    } catch (error) {
      toast.error("Échec de l'enregistrement des zones");
      log.error({ err: error }, 'positioning zones replace-set failed');
      return;
    } finally {
      setSavingZones(false);
    }
    setCurrentStep(2);
  }, [campaignId, zoneIds, updateCampaign]);

  const handleSelectCreative = useCallback(
    async (id: string) => {
      if (!campaignId) return;
      try {
        await updateCampaign.mutateAsync({ id: campaignId, input: { creative_id: id } });
        setCreativeId(id);
      } catch (error) {
        // EV3 — the api's attach gate (EVENT_SPOT_TOO_LONG) speaks French already.
        toast.error(getErrorMessage(error) || 'Erreur lors de l’association de la création');
        log.error({ err: error }, 'positioning creative link failed');
      }
    },
    [campaignId, updateCampaign],
  );

  const handleDeselectCreative = useCallback(async () => {
    if (!campaignId) return;
    try {
      await updateCampaign.mutateAsync({ id: campaignId, input: { creative_id: null } });
      setCreativeId(null);
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la désélection de la création');
      log.error({ err: error }, 'positioning creative unlink failed');
    }
  }, [campaignId, updateCampaign]);

  const [adding, setAdding] = useState(false);
  const handleAddToCart = useCallback(async () => {
    if (!campaignId) return;
    setAdding(true);
    try {
      const ok = await persistDraft();
      if (!ok) return;
      await addToCart.mutateAsync(campaignId);
      armedRef.current = false;
      toast.success('Positionnement ajouté au panier.');
      navigate('/my-cart');
    } catch (error) {
      if (isBudgetBelowMinimum(error)) {
        toast.error(BUDGET_FLOOR_ERROR, { duration: 6000 });
      } else if (isBudgetExceedsCmax(error)) {
        toast.error(
          'Ces minutes ne sont plus toutes disponibles — le maximum a été recalculé, ajustez votre positionnement.',
          { duration: 8000 },
        );
        void queryClient.invalidateQueries({ queryKey: campaignsKeys.cmax(campaignId) });
      } else {
        toast.error(getErrorMessage(error) || 'Erreur lors de l’ajout au panier');
        log.error({ err: error }, 'positioning add-to-cart failed');
      }
    } finally {
      setAdding(false);
    }
  }, [campaignId, persistDraft, addToCart, navigate, queryClient]);

  if (!campaignId) {
    navigate(EVENTS_PATHS.football);
    return null;
  }

  // The page bleeds to the edges of the layout's padded <main> (the AnalysisFilterBar idiom): the
  // pitch runs under the top bar, the light stripes under the steps.
  return (
    <div className="-mx-4 -my-6 min-h-full bg-stadium-stage sm:-mx-6 lg:-mx-8 lg:-my-8">
      <PositioningHero
        title="Je me positionne"
        subtitle="Positionnez votre marque sur la fenêtre de diffusion du match"
        steps={STEPS}
        currentStep={currentStep}
        onStep={setCurrentStep}
        onSave={() => void handleSave()}
        saving={updateCampaign.isPending}
        onCancel={() => requestExit(EVENTS_PATHS.football)}
      />

      <div className="relative z-[2] -mt-14 px-4 pb-10 sm:px-6 lg:px-8">
        <MatchTicket event={event} campaignName={campaign.data?.name ?? ''} />

        {currentStep === 1 && (
          <FootZonesStep
            zoneIds={zoneIds}
            setZoneIds={setZoneIds}
            draftCampaignId={campaignId}
            saving={savingZones}
            onNext={handleZonesNext}
            onBack={() => requestExit(EVENTS_PATHS.football)}
          />
        )}
        {currentStep === 2 && (
          <FootCreativeStep
            draftCampaignId={campaignId}
            userId={user?.id}
            selectedCreativeId={creativeId}
            onSelectCreative={handleSelectCreative}
            onDeselectCreative={handleDeselectCreative}
            linking={updateCampaign.isPending}
            eventMinutes={eventMinutes}
            onNext={() => setCurrentStep(3)}
            onBack={() => setCurrentStep(1)}
          />
        )}
        {currentStep === 3 && (
          <EventRecapStep
            campaignId={campaignId}
            event={event}
            zoneNames={zoneNames}
            eventMinutes={eventMinutes}
            setEventMinutes={setEventMinutes}
            spotValidationStatus={campaign.data?.content_validation_status ?? null}
            onAddToCart={handleAddToCart}
            adding={adding}
            onBack={() => setCurrentStep(2)}
          />
        )}
      </div>

      <WizardExitDialog
        open={exitPrompt !== null}
        busy={exitBusy || updateCampaign.isPending}
        onQuit={() => void handleExitQuit()}
        onCancel={() => setExitPrompt(null)}
        onSave={() => void handleExitSave()}
      />
    </div>
  );
}
