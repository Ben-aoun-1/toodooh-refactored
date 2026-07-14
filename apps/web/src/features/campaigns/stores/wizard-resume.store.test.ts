import { beforeEach, describe, expect, it } from 'vitest';

import { useWizardResumeStore } from './wizard-resume.store';

// CF-Q2 — the per-draft resume map: entries are REPLACED per key (no growth on repeated saves),
// removed on submit/delete, and an unknown clear is a no-op. (Persist hydration is a browser
// concern; the node suite exercises the store logic the pages call.)

describe('useWizardResumeStore', () => {
  beforeEach(() => {
    useWizardResumeStore.setState({ steps: {} });
  });

  it('records and REPLACES the step per draft id — repeated saves never grow the map', () => {
    const { setStep } = useWizardResumeStore.getState();
    setStep('d1', 2);
    setStep('d1', 3);
    setStep('d1', 3);
    setStep('d1', 5);
    expect(useWizardResumeStore.getState().steps).toEqual({ d1: 5 });
  });

  it('tracks drafts independently', () => {
    const { setStep } = useWizardResumeStore.getState();
    setStep('d1', 2);
    setStep('d2', 4);
    expect(useWizardResumeStore.getState().steps).toEqual({ d1: 2, d2: 4 });
  });

  it('clear removes exactly the one draft key (submit/delete hygiene)', () => {
    const { setStep, clear } = useWizardResumeStore.getState();
    setStep('d1', 2);
    setStep('d2', 4);
    clear('d1');
    expect(useWizardResumeStore.getState().steps).toEqual({ d2: 4 });
  });

  it('clearing an unknown draft is a no-op (state object untouched)', () => {
    const before = useWizardResumeStore.getState().steps;
    useWizardResumeStore.getState().clear('ghost');
    expect(useWizardResumeStore.getState().steps).toBe(before);
  });
});
