import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// CF-Q2 (spec §3.3) — « Reprendre » reopens a draft at the step where the user stopped. The step
// index is persisted PER DRAFT ID via Zustand persist (CLAUDE.md: localStorage only through the
// persist middleware — this store IS the ruled "localStorage keyed by draft id"). Same-device
// resume is exact; a missing entry falls back to deriveResumeStep (wizard-resume lib). Entries
// are REPLACED per key (no growth on repeated saves) and cleared on submit/delete.

interface WizardResumeState {
  /** draft campaign id → the 1-indexed wizard step last shown. */
  steps: Record<string, number>;
  setStep: (draftId: string, step: number) => void;
  clear: (draftId: string) => void;
}

export const useWizardResumeStore = create<WizardResumeState>()(
  persist(
    (set) => ({
      steps: {},
      setStep: (draftId, step) =>
        set((s) => (s.steps[draftId] === step ? s : { steps: { ...s.steps, [draftId]: step } })),
      clear: (draftId) =>
        set((s) => {
          if (!(draftId in s.steps)) return s;
          const next = { ...s.steps };
          delete next[draftId];
          return { steps: next };
        }),
    }),
    { name: 'toodooh-wizard-resume' },
  ),
);
