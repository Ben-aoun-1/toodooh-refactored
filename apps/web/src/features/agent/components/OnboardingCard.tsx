import { CheckCircle2, Circle, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAgentAccount } from '@/features/agent/hooks/useAgentAccount';
import {
  AGENT_PATHS,
  onboardingProgress,
  onboardingStepCopy,
} from '@/features/agent/lib/agent-shell';

/**
 * AGT-1b (agent specs v1.0 §2) — « Finalisez votre compte »: above the dashboard, full width,
 * until every mandatory step is validated; cannot be hidden. Each step opens its settings tab.
 */
export function OnboardingCard() {
  const account = useAgentAccount();
  const navigate = useNavigate();
  const o = account.data?.onboarding;
  if (!o || o.complete) return null;
  const pct = Math.round((o.done / o.steps.length) * 100);

  return (
    <section className="mb-6 rounded-xl border border-[#E1E4EA] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Finalisez votre compte</h2>
        <span className="text-sm text-[#5C5C5C]">{onboardingProgress(o.done, o.steps.length)}</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-brand-primary" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {o.steps.map((step) => {
          const copy = onboardingStepCopy(step);
          return (
            <li
              key={step.key}
              className="flex items-center gap-3 rounded-lg border border-[#E1E4EA] p-3"
            >
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 text-brand-primary" />
              ) : step.pending ? (
                <Clock className="h-5 w-5 text-amber-500" />
              ) : (
                <Circle className="h-5 w-5 text-gray-300" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{copy.label}</p>
                <p className="text-xs text-[#5C5C5C]">{copy.status}</p>
              </div>
              {!step.done && copy.tab && step.key !== 'cge' && (
                <button
                  type="button"
                  onClick={() => navigate(`${AGENT_PATHS.settings}?tab=${copy.tab}`)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
                >
                  {step.pending ? 'Voir' : 'Compléter'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
