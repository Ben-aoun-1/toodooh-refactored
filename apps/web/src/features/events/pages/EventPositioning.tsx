import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Save, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import StepCreative from '@/features/campaigns/pages/new-campaign/StepCreative';
import StepZones from '@/features/campaigns/pages/new-campaign/StepZones';
import { useCartMutations } from '@/features/cart/hooks/useCart';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import EventMatchHeader from '../components/EventMatchHeader';
import EventRecapStep from '../components/EventRecapStep';
import { useEventsCatalogue, useSuggestedEvents } from '../hooks/useEvents';

const log = logger.child({ module: 'EventPositioning' });

const STEPS = [
  { id: 1, title: 'Zones' },
  { id: 2, title: 'Vidéo' },
  { id: 3, title: 'Récapitulatif' },
] as const;

/**
 * EV3 — the 3-step positioning parcours (Zones → Vidéo → Récapitulatif), the match récap PINNED
 * on top of every step. The positioning DRAFT already exists when this page opens (« Je me
 * positionne » creates it — POST /:id/positionner) so every step composes the CLASSIC draft
 * machinery: StepZones + the zone replace-set PATCH, StepCreative in eventMode (15 s grid) +
 * the creative-link PATCH, the bounded budget slider on the EVENT ceiling, « Ajouter au
 * panier » → the panier's Événements section. §1.9 exit machinery reused whole (popup +
 * beforeunload + browser-back sentinel); Quitter on a FRESH parcours deletes the row, on a
 * RESUMED one (Reprendre) it only leaves — the row IS already a Brouillon server-side.
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
  const [requestedBudget, setRequestedBudget] = useState<number | null>(null);

  // Hydrate ONCE from the loaded row (zones/creative/budget survive a resume).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !campaign.data) return;
    hydratedRef.current = true;
    setZoneIds((campaign.data.zones ?? []).map((z) => z.zone_id));
    setCreativeId(campaign.data.creative_id);
    setRequestedBudget(campaign.data.requested_budget ?? null);
  }, [campaign.data]);

  const zonesQuery = useZones();
  const zoneNames = (zonesQuery.data ?? [])
    .filter((z) => zoneIds.includes(z.id))
    .map((z) => z.name);

  // ── §1.9 exit machinery (the NewCampaign idioms, reused whole) ────────────────────────────
  // Dirty = the editable state moved since the last persisted snapshot. The row itself is
  // ALWAYS a server-side Brouillon (auto-Brouillon by construction — created at entry).
  const snapshot = useCallback(
    () => JSON.stringify([zoneIds, creativeId, requestedBudget]),
    [zoneIds, creativeId, requestedBudget],
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
      setExitPrompt({ to: '/evenements' });
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

  // Persist the dirty editable state (zones + budget; the creative link PATCHes at click).
  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (!campaignId) return false;
    try {
      await updateCampaign.mutateAsync({
        id: campaignId,
        input: { zone_ids: zoneIds, requested_budget: requestedBudget },
      });
      savedSnapRef.current = snapshot();
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de l’enregistrement du brouillon');
      log.error({ err: error }, 'positioning draft save failed');
      return false;
    }
  }, [campaignId, updateCampaign, zoneIds, requestedBudget, snapshot]);

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
    const destination = exitPrompt?.to ?? '/evenements';
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
          'Le budget dépasse l’inventaire disponible — le plafond a été recalculé, ajustez votre budget.',
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
    navigate('/evenements');
    return null;
  }

  return (
    <div className="w-full mx-auto space-y-6">
      <div className="bg-white rounded-xl p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900">Je me positionne</h1>
            <p className="text-sm text-gray-600">
              Positionnez votre marque sur la fenêtre de diffusion du match
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={updateCampaign.isPending}
              className="flex items-center gap-2 rounded-lg border border-brand-primary/60 px-4 py-2 text-brand-deep transition-colors hover:bg-brand-primary/10 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>Enregistrer</span>
            </button>
            <button
              type="button"
              onClick={() => requestExit('/evenements')}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <X className="h-5 w-5" />
              <span>Annuler</span>
            </button>
          </div>
        </div>

        <div className="flex w-full items-center">
          {STEPS.map((step, index) => (
            <React.Fragment key={step.id}>
              <div className="flex flex-1 flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                    currentStep > step.id
                      ? 'bg-brand-primary text-brand-deep'
                      : currentStep === step.id
                        ? 'border-2 border-brand-primary text-brand-deep'
                        : 'border border-gray-300 text-gray-400'
                  }`}
                >
                  {step.id}
                </div>
                <span
                  className={`mt-1.5 text-xs ${
                    currentStep === step.id
                      ? 'font-semibold text-gray-900'
                      : 'font-normal text-gray-500'
                  }`}
                >
                  {step.title}
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

      <EventMatchHeader event={event} campaignName={campaign.data?.name ?? ''} />

      {currentStep === 1 && (
        <StepZones
          zoneIds={zoneIds}
          setZoneIds={setZoneIds}
          draftCampaignId={campaignId}
          saving={savingZones}
          onNext={handleZonesNext}
          onBack={() => requestExit('/evenements')}
        />
      )}
      {currentStep === 2 && (
        <StepCreative
          draftCampaignId={campaignId}
          userId={user?.id}
          selectedCreativeId={creativeId}
          onSelectCreative={handleSelectCreative}
          onDeselectCreative={handleDeselectCreative}
          linking={updateCampaign.isPending}
          eventMode
          onNext={() => setCurrentStep(3)}
          onBack={() => setCurrentStep(1)}
        />
      )}
      {currentStep === 3 && (
        <EventRecapStep
          campaignId={campaignId}
          event={event}
          zoneNames={zoneNames}
          requestedBudget={requestedBudget}
          setRequestedBudget={setRequestedBudget}
          spotValidationStatus={campaign.data?.content_validation_status ?? null}
          onAddToCart={handleAddToCart}
          adding={adding}
          onBack={() => setCurrentStep(2)}
        />
      )}

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
