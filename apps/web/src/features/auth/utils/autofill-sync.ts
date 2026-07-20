/**
 * The DOM-sync seam (prod-blocker lane) — reconcile React state with what the browser actually
 * put in the inputs.
 *
 * Mobile autofill (iOS Safari, Android Chrome/Samsung keyboards, password managers) can write
 * `input.value` without dispatching a React-visible event: the form LOOKS filled while the
 * controlled state still holds the initial values, so every state-derived gate stays unsatisfied
 * — the disabled-forever Suivant mystery. On every Suivant click the wizard reads the live DOM
 * values and reconciles them through this pure function BEFORE validating: whenever the DOM
 * differs from state, the DOM wins (it is what the user sees).
 */

export interface ReconcileResult<T extends Record<string, string>> {
  next: T;
  /** Keys whose DOM value differed from state (empty = state was already in sync). */
  changedKeys: (keyof T)[];
}

export function reconcileAutofill<T extends Record<string, string>>(
  state: T,
  dom: Partial<Record<keyof T, string | undefined>>,
): ReconcileResult<T> {
  const next = { ...state };
  const changedKeys: (keyof T)[] = [];
  for (const key of Object.keys(dom) as (keyof T)[]) {
    const domValue = dom[key];
    if (domValue === undefined) continue; // input not mounted → nothing to reconcile
    if (domValue !== state[key]) {
      next[key] = domValue as T[keyof T];
      changedKeys.push(key);
    }
  }
  return { next, changedKeys };
}
