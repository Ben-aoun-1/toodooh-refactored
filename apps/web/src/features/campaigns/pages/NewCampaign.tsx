import 'react-datepicker/dist/react-datepicker.css';
import { ChevronRight, X } from 'lucide-react';
import React, { useCallback, useMemo, useRef } from 'react';
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
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { useCampaignWizard } from '@/features/campaigns/hooks/new-campaign/useCampaignWizard';
import { buildInitialWizardState } from '@/features/campaigns/hooks/new-campaign/wizard-init';
import type {
  UseCampaignWizardOptions,
  WizardState,
} from '@/features/campaigns/hooks/new-campaign/wizard-types';
import {
  useCreateCampaign,
  useSubmitCampaign,
  useUpdateCampaign,
} from '@/features/campaigns/hooks/useCampaignApi';
import { parseCampaignUiDate, toLocalDateOnlyString } from '@/features/campaigns/lib/wizard-dates';
import StepBasics from '@/features/campaigns/pages/new-campaign/StepBasics';
import StepCart from '@/features/campaigns/pages/new-campaign/StepCart';
import StepCoverage from '@/features/campaigns/pages/new-campaign/StepCoverage';
import StepCreative from '@/features/campaigns/pages/new-campaign/StepCreative';
import StepTargeting from '@/features/campaigns/pages/new-campaign/StepTargeting';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'NewCampaign' });

const ARIANE_ICONS = [ariane1, ariane2, ariane3, ariane4, ariane5] as const;
const ARIANE_ICONS_DONE = [ariane1s, ariane2s, ariane3s, ariane4s, ariane5s] as const;

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
}

/**
 * The de-Supabase campaign wizard — a 5-step orchestrator on the campaigns REST engine:
 *   Basics → Targeting → Couverture → Creative → Cart (interim indicative budget) + Submit.
 *
 * Leaving Basics creates the draft (POST /api/campaigns) and threads the id into the later panels.
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
  if (initialStateRef.current === null) {
    initialStateRef.current = buildInitialWizardState({ campaignToEdit });
  }

  const createCampaign = useCreateCampaign(user?.id);
  const updateCampaign = useUpdateCampaign(user?.id);
  const submitCampaign = useSubmitCampaign(user?.id);

  const wizOpts = useMemo<UseCampaignWizardOptions>(
    () => ({
      initialState: initialStateRef.current as WizardState,
      createDraft: (input) => createCampaign.mutateAsync(input),
      updateCampaign: (id, input) => updateCampaign.mutateAsync({ id, input }),
      submitCampaign: (id) => submitCampaign.mutateAsync(id),
    }),
    [createCampaign, updateCampaign, submitCampaign],
  );

  const wiz = useCampaignWizard(wizOpts);
  const { state, setState, currentStep, stepList } = wiz;

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

  const handleSubmit = useCallback(async () => {
    const result = await wiz.submit();
    if (result.kind === 'success') {
      toast.success('Campagne soumise pour validation.');
      navigate('/my-campaigns?status=pending');
    } else {
      toast.error(getErrorMessage(result.error) || 'Erreur lors de la soumission de la campagne');
      log.error({ err: result.error }, 'campaign submit failed');
    }
  }, [wiz, navigate]);

  const handleSaveDraft = useCallback(async () => {
    const result = await wiz.saveDraft();
    if (result.kind === 'success') {
      toast.success('Brouillon enregistré.');
      navigate('/my-campaigns');
    } else {
      toast.error(getErrorMessage(result.error) || 'Erreur lors de l’enregistrement du brouillon');
      log.error({ err: result.error }, 'save draft failed');
    }
  }, [wiz, navigate]);

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
          startDate={startDate}
          endDate={endDate}
          setCampaignName={setCampaignName}
          setStartDate={setStartDate}
          setEndDate={setEndDate}
          onNext={handleBasicsNext}
          creating={wiz.creatingDraft}
        />
      );
    }
    if (stepId === 'targeting') {
      return (
        <StepTargeting
          draftCampaignId={state.draftCampaignId || null}
          onNext={() => {
            void wiz.nextStep();
          }}
          onBack={() => wiz.prevStep()}
        />
      );
    }
    if (stepId === 'coverage') {
      return (
        <StepCoverage
          draftCampaignId={state.draftCampaignId || null}
          onNext={() => {
            void wiz.nextStep();
          }}
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
          campaignName={state.campaignName}
          startDate={state.startDate}
          endDate={state.endDate}
          draftCampaignId={state.draftCampaignId || null}
          userId={user?.id}
          creativeId={state.creativeId}
          onBack={() => wiz.prevStep()}
          onSaveDraft={handleSaveDraft}
          onSubmit={handleSubmit}
          submitting={wiz.submitting}
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
          <button
            type="button"
            onClick={() => navigate('/my-campaigns')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors flex-shrink-0"
          >
            <X className="h-5 w-5" />
            <span>Annuler</span>
          </button>
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
    </div>
  );
}
