import 'react-datepicker/dist/react-datepicker.css';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Save, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import ariane1 from '@/assets/ariane/1.png';
import ariane1s from '@/assets/ariane/1s.png';
import ariane2 from '@/assets/ariane/2.png';
import ariane2s from '@/assets/ariane/2s.png';
import ariane3 from '@/assets/ariane/3.png';
import ariane3s from '@/assets/ariane/3s.png';
import ariane4 from '@/assets/ariane/4.png';
import ariane4s from '@/assets/ariane/4s.png';
import ariane5 from '@/assets/ariane/5.png';
import ariane5s from '@/assets/ariane/5s.png';
import ariane6 from '@/assets/ariane/6.png';
import ariane6s from '@/assets/ariane/6s.png';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import WizardExitDialog from '@/features/campaigns/components/WizardExitDialog';
import { persistDatesForAdvance } from '@/features/campaigns/hooks/new-campaign/dates-advance';
import { useCampaignWizard } from '@/features/campaigns/hooks/new-campaign/useCampaignWizard';
import { buildInitialWizardState } from '@/features/campaigns/hooks/new-campaign/wizard-init';
import { resolveResumeStep } from '@/features/campaigns/hooks/new-campaign/wizard-resume';
import { performSaveDraft } from '@/features/campaigns/hooks/new-campaign/wizard-serialize';
import { getStepList } from '@/features/campaigns/hooks/new-campaign/wizard-steps';
import type {
  UseCampaignWizardOptions,
  WizardState,
} from '@/features/campaigns/hooks/new-campaign/wizard-types';
import { campaignsKeys } from '@/features/campaigns/hooks/queryKeys';
import {
  useCreateCampaign,
  useDeleteCampaign,
  useUpdateCampaign,
} from '@/features/campaigns/hooks/useCampaignApi';
import { usePricingConfig } from '@/features/campaigns/hooks/usePricingConfig';
import { useZones } from '@/features/campaigns/hooks/useZones';
import {
  BUDGET_FLOOR_ERROR,
  isBudgetBelowMinimum,
  isBudgetExceedsCmax,
} from '@/features/campaigns/lib/cmax-budget';
import { quitDeletesDraft, shouldArmExitGuard } from '@/features/campaigns/lib/exit-intercept';
import { setNavigationGuard } from '@/features/campaigns/lib/navigation-guard';
import { parseCampaignUiDate, toLocalDateOnlyString } from '@/features/campaigns/lib/wizard-dates';
import { defaultZoneSelection } from '@/features/campaigns/lib/zones-selection';
import StepBasics from '@/features/campaigns/pages/new-campaign/StepBasics';
import StepCart from '@/features/campaigns/pages/new-campaign/StepCart';
import StepCreative from '@/features/campaigns/pages/new-campaign/StepCreative';
import StepDates from '@/features/campaigns/pages/new-campaign/StepDates';
import StepTargeting from '@/features/campaigns/pages/new-campaign/StepTargeting';
import StepZones from '@/features/campaigns/pages/new-campaign/StepZones';
import { useWizardResumeStore } from '@/features/campaigns/stores/wizard-resume.store';
import { useCartMutations } from '@/features/cart/hooks/useCart';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'NewCampaign' });

const ARIANE_ICONS = [ariane1, ariane2, ariane3, ariane4, ariane5, ariane6] as const;
const ARIANE_ICONS_DONE = [ariane1s, ariane2s, ariane3s, ariane4s, ariane5s, ariane6s] as const;

// Loose edit-mode record carried in router state (MyCampaigns navigation). The wizard prefills name +
// dates from it; the full edit round-trip on the new engine lands with the MyCampaigns repoint (C6).
interface EditNavRecord {
  id?: string;
  name?: string;
  start_date?: string | null;
  startDate?: string | Date | null;
  end_date?: string | null;
  endDate?: string | Date | null;
  creative_id?: string | null;
  requested_budget?: number | null;
  zones?: { zone_id: string; name: string }[];
}

/**
 * The de-Supabase campaign wizard — a 6-step orchestrator on the campaigns REST engine (CF-W1):
 *   Nom et type → Catégories → Période → Couverture → Création → Validation (+ Submit).
 *
 * Leaving step 1 creates the draft (POST /api/campaigns, date-less — dates arrive at Période)
 * and threads the id into the later panels.
 * Couverture is a read-only coverage-map preview of the screenhosts matching the targeting; it gates
 * nothing. There is no render harness — the logic core (validators / create-early / submit) is
 * unit-tested in useCampaignWizard.test.ts.
 */
export default function NewCampaign() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();

  const editMode: boolean = location.state?.editMode || false;
  const campaignToEdit = (location.state?.campaign as EditNavRecord | undefined) ?? null;

  const initialStateRef = useRef<WizardState | null>(null);
  const initialStepRef = useRef<number>(1);
  if (initialStateRef.current === null) {
    initialStateRef.current = buildInitialWizardState({ campaignToEdit });
    // CF-Q2 (spec §3.3) — Reprendre resumes at the stored step (same device, exact) or derives
    // the first incomplete step from the loaded draft. Read once at mount (getState — no sub).
    const draftId = initialStateRef.current.draftCampaignId;
    const stored = draftId ? useWizardResumeStore.getState().steps[draftId] : undefined;
    initialStepRef.current = resolveResumeStep(stored, initialStateRef.current, getStepList());
  }

  const createCampaign = useCreateCampaign(user?.id);
  const updateCampaign = useUpdateCampaign(user?.id);
  const deleteCampaign = useDeleteCampaign(user?.id);
  const { addToCart: addToCartMutation } = useCartMutations(user?.id);
  const queryClient = useQueryClient();

  const wizOpts = useMemo<UseCampaignWizardOptions>(
    () => ({
      initialState: initialStateRef.current as WizardState,
      initialStep: initialStepRef.current,
      createDraft: (input) => createCampaign.mutateAsync(input),
      updateCampaign: (id, input) => updateCampaign.mutateAsync({ id, input }),
      addToCart: (campaignId) => addToCartMutation.mutateAsync(campaignId),
    }),
    [createCampaign, updateCampaign, addToCartMutation],
  );

  const wiz = useCampaignWizard(wizOpts);
  const { state, setState, currentStep, stepList } = wiz;

  // CF-Q2 — the server start floor (J+2 jours ouvrés), fetched once per mount via React Query.
  const pricingConfig = usePricingConfig();
  const firstAvailableStartDate = pricingConfig.data?.first_available_start_date;
  const minStartDate = useMemo(
    () => parseCampaignUiDate(firstAvailableStartDate ?? null),
    [firstAvailableStartDate],
  );

  // CF-Z1 — the predefined zones + the fresh-wizard default (Grand Tunis — V1's only zone).
  const zonesQuery = useZones();
  const zonesTouchedRef = useRef(false);
  useEffect(() => {
    if (!zonesQuery.data) return;
    const next = defaultZoneSelection(
      zonesQuery.data.map((z) => z.id),
      { isEdit: editMode, touched: zonesTouchedRef.current, current: state.zoneIds },
    );
    if (JSON.stringify(next) !== JSON.stringify(state.zoneIds)) {
      setState((prev) => ({ ...prev, zoneIds: next }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default applies once, on zones load
  }, [zonesQuery.data]);

  const setZoneIds = useCallback(
    (next: string[]) => {
      zonesTouchedRef.current = true;
      setState((prev) => ({ ...prev, zoneIds: next }));
    },
    [setState],
  );

  // Advancing from the Zones step persists a dirty selection first (replace-set PATCH — same
  // block-on-failure semantics as the targeting flush). Save/submit also carry zone_ids.
  // CF-HF2 (prod bug): advancing from Période used to leave the dates client-only — Validation
  // then mounted with a server-side dateless draft and GET /:id/cmax 409'd (CMAX_REQUIRES), so
  // the budget step was unusable straight-through. Persist-then-advance, the zones idiom: dirty-
  // checked PATCH, block the advance on failure with the same error-toast voice.
  const persistedDatesRef = useRef<string | null>(null);
  const [savingDates, setSavingDates] = useState(false);
  const handleDatesNext = useCallback(async () => {
    setSavingDates(true);
    const result = await persistDatesForAdvance({
      draftCampaignId: state.draftCampaignId || null,
      startDate: state.startDate,
      endDate: state.endDate,
      persistedWire: persistedDatesRef.current,
      update: (id, input) => updateCampaign.mutateAsync({ id, input }),
    });
    setSavingDates(false);
    if (!result.ok) {
      toast.error("Échec de l'enregistrement des dates");
      log.error({ err: result.error }, 'dates persist-on-advance failed');
      return;
    }
    persistedDatesRef.current = result.wire;
    void wiz.nextStep();
  }, [state.draftCampaignId, state.startDate, state.endDate, updateCampaign, wiz]);

  const persistedZonesRef = useRef<string | null>(null);
  const [savingZones, setSavingZones] = useState(false);
  const handleZonesNext = useCallback(async () => {
    if (state.draftCampaignId) {
      const wire = JSON.stringify([...state.zoneIds].sort());
      if (persistedZonesRef.current !== wire) {
        setSavingZones(true);
        try {
          await updateCampaign.mutateAsync({
            id: state.draftCampaignId,
            input: { zone_ids: state.zoneIds },
          });
          persistedZonesRef.current = wire;
        } catch (error) {
          toast.error("Échec de l'enregistrement des zones");
          log.error({ err: error }, 'zones replace-set failed');
          return;
        } finally {
          setSavingZones(false);
        }
      }
    }
    await wiz.nextStep();
  }, [state.draftCampaignId, state.zoneIds, updateCampaign, wiz]);

  // CF-Q2 — persist the shown step per draft id on every step change (covers save/exit too:
  // the step the user leaves from was already recorded on arrival). Cleared on submit/delete.
  const setResumeStep = useWizardResumeStore((s) => s.setStep);
  const clearResumeStep = useWizardResumeStore((s) => s.clear);
  useEffect(() => {
    if (state.draftCampaignId) setResumeStep(state.draftCampaignId, currentStep);
  }, [state.draftCampaignId, currentStep, setResumeStep]);

  // ── CF-W1 §1.8/§1.9 — per-step Enregistrer + exit intercept ─────────────────────────────────
  // "Saved" tracking: a RESUMED draft starts saved; a fresh wizard is saved only after an
  // explicit Enregistrer. Dirty = the editable state moved since the last save/load snapshot.
  const editableSnapshot = (s: WizardState): string =>
    JSON.stringify([
      s.campaignName,
      s.startDate,
      s.endDate,
      s.creativeId,
      s.requestedBudget,
      s.zoneIds, // CF-Z1 — zone edits count as dirty (exit intercept arms)
    ]);
  const [explicitlySaved, setExplicitlySaved] = useState<boolean>(editMode);
  const savedSnapRef = useRef<string>(editableSnapshot(initialStateRef.current as WizardState));
  const dirtySinceSave = editableSnapshot(state) !== savedSnapRef.current;
  const armed = shouldArmExitGuard({
    hasDraft: Boolean(state.draftCampaignId),
    explicitlySaved,
    dirtySinceSave,
  });
  const armedRef = useRef(armed);
  armedRef.current = armed;

  const [exitPrompt, setExitPrompt] = useState<{ to: string } | null>(null);
  const [exitBusy, setExitBusy] = useState(false);
  // While this step is 'targeting', holds the panel's flush() (header Enregistrer uses it).
  const targetingFlushRef = useRef<(() => Promise<boolean>) | null>(null);
  const registerTargetingFlush = useCallback((flush: (() => Promise<boolean>) | null) => {
    targetingFlushRef.current = flush;
  }, []);

  // In-app guard (consulted by the sidebar — see navigation-guard.ts; the app has no data
  // router, so useBlocker is unavailable). Registered once; reads the armed state via ref.
  useEffect(
    () =>
      setNavigationGuard((to) => {
        if (!armedRef.current) return true;
        setExitPrompt({ to });
        return false;
      }),
    [],
  );

  // Browser back: a sentinel history entry keeps the wizard mounted on the first back; while
  // armed the pop opens the popup and re-arms the sentinel. (Not armed → the pop lands on the
  // same URL; the next back leaves normally.)
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const onPop = () => {
      if (!armedRef.current) return;
      window.history.pushState(null, '', window.location.href);
      setExitPrompt({ to: '/my-campaigns' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Tab close / refresh: the NATIVE prompt while armed (custom buttons are impossible there —
  // the spec's own clarification). Disarms with the same armed flag.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!armedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const setCampaignName = useCallback(
    (value: string) => setState((prev) => ({ ...prev, campaignName: value })),
    [setState],
  );
  const setStartDate = useCallback(
    (next: Date | null) =>
      setState((prev) => ({ ...prev, startDate: next ? toLocalDateOnlyString(next) : null })),
    [setState],
  );
  const setEndDate = useCallback(
    (next: Date | null) =>
      setState((prev) => ({ ...prev, endDate: next ? toLocalDateOnlyString(next) : null })),
    [setState],
  );

  const startDate = useMemo(() => parseCampaignUiDate(state.startDate), [state.startDate]);
  const endDate = useMemo(() => parseCampaignUiDate(state.endDate), [state.endDate]);

  const handleBasicsNext = useCallback(async () => {
    const moved = await wiz.nextStep();
    if (!moved && !state.draftCampaignId) {
      const created = await wiz.ensureDraft();
      if (created.kind === 'error') {
        toast.error(getErrorMessage(created.error) || 'Erreur lors de la création de la campagne');
        log.error({ err: created.error }, 'create-early draft failed');
      }
    }
  }, [wiz, state.draftCampaignId]);

  const setRequestedBudget = useCallback(
    (value: number | null) => setState((prev) => ({ ...prev, requestedBudget: value })),
    [setState],
  );

  // CF-C1 — « Ajouter au panier »: the wizard's final action queues the draft; the launch is
  // the cart page's ONE « Confirmer et lancer » (the submit path retired from the wizard).
  const handleAddToCart = useCallback(async () => {
    const result = await wiz.addToCart();
    if (result.kind === 'success') {
      if (state.draftCampaignId) clearResumeStep(state.draftCampaignId); // CF-Q2 key hygiene
      armedRef.current = false; // CF-W1 — no orphan intercept after a successful add
      toast.success('Campagne ajoutée au panier.');
      navigate('/my-cart');
    } else if (isBudgetBelowMinimum(result.error)) {
      // CF-U3 — the server floor refusal, in French (the slider min already enforces it for any
      // fresh drag; this catches legacy sub-floor drafts).
      toast.error(BUDGET_FLOOR_ERROR, { duration: 6000 });
    } else if (isBudgetExceedsCmax(result.error)) {
      // E5 (US-1.4) — the server's ceiling gate fired (occupancy moved since the read): re-read
      // the LIVE ceiling; the Validation step's pull-back effect re-clamps with its notice.
      toast.error(
        'Le budget dépasse l’inventaire disponible — le plafond a été recalculé, ajustez votre budget.',
        { duration: 8000 },
      );
      if (state.draftCampaignId) {
        void queryClient.invalidateQueries({
          queryKey: campaignsKeys.cmax(state.draftCampaignId),
        });
      }
      log.warn({ err: result.error }, 'add-to-cart refused: budget exceeds live C_max');
    } else {
      toast.error(getErrorMessage(result.error) || 'Erreur lors de l’ajout au panier');
      log.error({ err: result.error }, 'add-to-cart failed');
    }
  }, [wiz, navigate, state.draftCampaignId, clearResumeStep, queryClient]);

  // CF-W1 §1.8 — Enregistrer on EVERY step: flush targeting if that step is live, create the
  // draft when it does not exist yet (step-1 pre-draft), persist the full state, toast, leave.
  const handleSaveDraft = useCallback(async () => {
    if (targetingFlushRef.current) {
      const flushed = await targetingFlushRef.current();
      if (!flushed) {
        toast.error("Échec de l'enregistrement du ciblage");
        return;
      }
    }
    let draftId = state.draftCampaignId;
    if (!draftId) {
      const created = await wiz.ensureDraft();
      if (created.kind !== 'success') {
        toast.error(getErrorMessage(created.error) || 'Erreur lors de la création de la campagne');
        log.error({ err: created.error }, 'save-draft create-early failed');
        return;
      }
      draftId = created.id;
    }
    // The effective state carries the fresh draft id (ensureDraft's setState may not have
    // flushed into this closure yet) — same tested seam as the wizard's own saveDraft.
    const effective: WizardState = { ...state, draftCampaignId: draftId };
    const result = await performSaveDraft({
      state: effective,
      deps: { update: (id, input) => updateCampaign.mutateAsync({ id, input }) },
    });
    if (result.kind === 'success') {
      savedSnapRef.current = editableSnapshot(effective);
      setExplicitlySaved(true);
      armedRef.current = false; // disarm synchronously before the redirect
      toast.success('Brouillon enregistré.');
      navigate('/my-campaigns');
    } else {
      toast.error(getErrorMessage(result.error) || 'Erreur lors de l’enregistrement du brouillon');
      log.error({ err: result.error }, 'save draft failed');
    }
  }, [state, wiz, updateCampaign, navigate]);

  // §1.9 — the popup's three actions. RULED: Quitter on a FRESH wizard deletes the create-early
  // draft (no campaign left, not even a brouillon); on a RESUMED draft it only discards the
  // unsaved edits. Annuler closes and stays. Enregistrer = the save button, then leave.
  const requestExit = useCallback(
    (to: string) => {
      if (armedRef.current) setExitPrompt({ to });
      else navigate(to);
    },
    [navigate],
  );

  const handleExitQuit = useCallback(async () => {
    const destination = exitPrompt?.to ?? '/my-campaigns';
    setExitBusy(true);
    try {
      if (
        quitDeletesDraft({ hasDraft: Boolean(state.draftCampaignId), explicitlySaved }) &&
        state.draftCampaignId
      ) {
        try {
          await deleteCampaign.mutateAsync(state.draftCampaignId);
        } catch (error) {
          // Leaving still wins — an orphaned draft is recoverable, a stuck user is not.
          log.error({ err: error }, 'fresh-draft delete on quit failed');
        }
        clearResumeStep(state.draftCampaignId);
      }
    } finally {
      setExitBusy(false);
    }
    armedRef.current = false;
    setExitPrompt(null);
    navigate(destination);
  }, [
    exitPrompt,
    state.draftCampaignId,
    explicitlySaved,
    deleteCampaign,
    clearResumeStep,
    navigate,
  ]);

  const handleExitSave = useCallback(async () => {
    setExitBusy(true);
    try {
      await handleSaveDraft(); // saves, toasts and navigates on success; stays on failure
    } finally {
      setExitBusy(false);
      setExitPrompt(null);
    }
  }, [handleSaveDraft]);

  const handleSelectCreative = useCallback(
    async (creativeId: string) => {
      if (!state.draftCampaignId) return;
      try {
        await updateCampaign.mutateAsync({
          id: state.draftCampaignId,
          input: { creative_id: creativeId },
        });
        setState((prev) => ({ ...prev, creativeId }));
      } catch (error) {
        toast.error(getErrorMessage(error) || 'Erreur lors de l’association de la création');
        log.error({ err: error }, 'link creative failed');
      }
    },
    [state.draftCampaignId, updateCampaign, setState],
  );

  // CF-U1 (Mejri item 4) — an already-selected spot can be DESELECTED: mirrors the select
  // (PATCH creative_id: null + clear the wizard state); the creative step gate re-blocks Suivant.
  const handleDeselectCreative = useCallback(async () => {
    if (!state.draftCampaignId) return;
    try {
      await updateCampaign.mutateAsync({
        id: state.draftCampaignId,
        input: { creative_id: null },
      });
      setState((prev) => ({ ...prev, creativeId: null }));
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la désélection de la création');
      log.error({ err: error }, 'unlink creative failed');
    }
  }, [state.draftCampaignId, updateCampaign, setState]);

  const handleBreadcrumbClick = useCallback(
    (target: number) => {
      void wiz.goToStep(target).then((moved) => {
        if (!moved && target > currentStep) {
          toast.error('Complétez l’étape en cours avant de continuer');
        }
      });
    },
    [wiz, currentStep],
  );

  const steps = useMemo(() => stepList.map((s) => ({ id: s.index, title: s.label })), [stepList]);

  function renderActiveStep(): React.ReactElement | null {
    const stepId = stepList[currentStep - 1]?.id;
    if (stepId === 'basics') {
      return (
        <StepBasics
          campaignName={state.campaignName}
          setCampaignName={setCampaignName}
          onNext={handleBasicsNext}
          creating={wiz.creatingDraft}
        />
      );
    }
    if (stepId === 'dates') {
      return (
        <StepDates
          startDate={startDate}
          endDate={endDate}
          minStartDate={minStartDate}
          firstAvailableStartDate={firstAvailableStartDate}
          setStartDate={setStartDate}
          setEndDate={setEndDate}
          saving={savingDates}
          onNext={handleDatesNext}
          onBack={() => wiz.prevStep()}
        />
      );
    }
    if (stepId === 'targeting') {
      return (
        <StepTargeting
          draftCampaignId={state.draftCampaignId || null}
          registerFlush={registerTargetingFlush}
          onNext={() => {
            void wiz.nextStep();
          }}
          onBack={() => wiz.prevStep()}
        />
      );
    }
    if (stepId === 'zones') {
      return (
        <StepZones
          zoneIds={state.zoneIds}
          setZoneIds={setZoneIds}
          draftCampaignId={state.draftCampaignId || null}
          saving={savingZones}
          onNext={handleZonesNext}
          onBack={() => wiz.prevStep()}
        />
      );
    }
    if (stepId === 'creative') {
      return (
        <StepCreative
          draftCampaignId={state.draftCampaignId || null}
          userId={user?.id}
          selectedCreativeId={state.creativeId}
          onSelectCreative={handleSelectCreative}
          onDeselectCreative={handleDeselectCreative}
          linking={updateCampaign.isPending}
          onNext={() => {
            void wiz.nextStep();
          }}
          onBack={() => wiz.prevStep()}
        />
      );
    }
    if (stepId === 'cart') {
      return (
        <StepCart
          requestedBudget={state.requestedBudget}
          setRequestedBudget={setRequestedBudget}
          zoneNames={(zonesQuery.data ?? [])
            .filter((z) => state.zoneIds.includes(z.id))
            .map((z) => z.name)}
          campaignName={state.campaignName}
          startDate={state.startDate}
          endDate={state.endDate}
          draftCampaignId={state.draftCampaignId || null}
          userId={user?.id}
          creativeId={state.creativeId}
          onBack={() => wiz.prevStep()}
          onSaveDraft={handleSaveDraft}
          onSubmit={handleAddToCart}
          submitting={wiz.addingToCart}
          saving={wiz.savingDraft}
        />
      );
    }
    return null;
  }

  return (
    <div className="w-full mx-auto space-y-8">
      <div className="bg-white rounded-xl p-8">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold mb-0.5 text-gray-900">
              {editMode ? `Modifier: ${campaignToEdit?.name ?? ''}` : 'Lancer une campagne'}
            </h1>
            <p className="text-sm text-gray-600">Créez et configurez votre campagne publicitaire</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* CF-W1 §1.8 — Enregistrer is available on EVERY step (step 1 creates then saves). */}
            <button
              type="button"
              onClick={() => void handleSaveDraft()}
              disabled={
                wiz.savingDraft ||
                wiz.creatingDraft ||
                (!state.draftCampaignId && !state.campaignName.trim())
              }
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-brand-primary/60 text-brand-deep hover:bg-brand-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" />
              <span>Enregistrer</span>
            </button>
            <button
              type="button"
              onClick={() => requestExit('/my-campaigns')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              <X className="h-5 w-5" />
              <span>Annuler</span>
            </button>
          </div>
        </div>

        <div className="w-full flex items-start">
          {steps.map((step, index) => {
            const isClickable = wiz.canGoToStep(step.id);
            const isCurrentStep = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            return (
              <React.Fragment key={step.id}>
                <div className="flex-1 flex flex-col items-center justify-center min-w-0">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (isClickable) handleBreadcrumbClick(step.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (isClickable) handleBreadcrumbClick(step.id);
                      }
                    }}
                    className={`flex flex-col items-center transition-all w-full ${
                      isClickable ? 'cursor-pointer hover:opacity-90' : 'cursor-default opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-center flex-shrink-0 transition-all">
                      <img
                        src={
                          isCompleted ? ARIANE_ICONS_DONE[step.id - 1] : ARIANE_ICONS[step.id - 1]
                        }
                        alt=""
                        className="w-14 h-14 object-contain"
                      />
                    </div>
                    <span
                      className={`mt-2 text-center text-xs max-w-[100px] leading-tight ${
                        isCurrentStep ? 'text-gray-900 font-semibold' : 'text-gray-500 font-normal'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                </div>
                {index < steps.length - 1 && (
                  <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0 mt-5" aria-hidden />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-3 space-y-6">{renderActiveStep()}</div>
      </div>

      <WizardExitDialog
        open={exitPrompt !== null}
        busy={exitBusy || wiz.savingDraft}
        onQuit={() => void handleExitQuit()}
        onCancel={() => setExitPrompt(null)}
        onSave={() => void handleExitSave()}
      />
    </div>
  );
}
