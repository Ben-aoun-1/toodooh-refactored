import { getStepList } from '@/features/campaigns/hooks/new-campaign/wizard-steps';
import type { StepDescriptor } from '@/features/campaigns/hooks/new-campaign/wizard-types';
import type { CampaignView } from '@/features/campaigns/services/campaigns.api';

// CF-RJ1 (spec §3.3) — « Rejouer » turns a Passée campaign into an identical NEW draft positioned
// directly at the Période step, everything else editable. The gating, the landing step and the
// replay→store→navigate chain live here so they are pinned by unit test (no render harness).

/** Rejouer is a Passée-only affordance — exactly where the API's 409 gate sits. */
export const canReplayCampaign = (status: string): boolean => status === 'completed';

export const REPLAY_SUCCESS_TOAST = 'Campagne dupliquée — choisissez la nouvelle période.';
export const REPLAY_ERROR_TOAST = 'Impossible de dupliquer la campagne';

/** The wizard step the clone lands on: Période, resolved from the step list (never hardcoded). */
export const replayLandingStep = (stepList: StepDescriptor[] = getStepList()): number =>
  stepList.find((s) => s.id === 'dates')?.index ?? 3;

export type ReplayResult =
  | { kind: 'success'; campaign: CampaignView }
  | { kind: 'error'; error: Error };

/**
 * The Rejouer chain: POST replay → persist the NEW draft's resume step (Période — CF-Q2 store,
 * keyed to the CLONE id, never the source) → navigate into the wizard in edit mode with the
 * returned projection (buildInitialWizardState consumes the wire shape directly). On failure,
 * NOTHING happens (no store write, no navigation) — the caller shows the error toast.
 */
export async function performReplay(args: {
  sourceId: string;
  deps: {
    replay: (id: string) => Promise<CampaignView>;
    setResumeStep: (draftId: string, step: number) => void;
    navigate: (to: string, opts: { state: { editMode: boolean; campaign: CampaignView } }) => void;
    stepList?: StepDescriptor[];
  };
}): Promise<ReplayResult> {
  try {
    const campaign = await args.deps.replay(args.sourceId);
    args.deps.setResumeStep(campaign.id, replayLandingStep(args.deps.stepList));
    args.deps.navigate('/new-campaign', { state: { editMode: true, campaign } });
    return { kind: 'success', campaign };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
  }
}
