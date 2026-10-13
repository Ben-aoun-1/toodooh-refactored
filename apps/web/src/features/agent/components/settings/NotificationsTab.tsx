import { toast } from 'react-hot-toast';

import { useAgentPrefs } from '@/features/agent/hooks/useAgentAccount';
import type { AgentProfile } from '@/features/agent/services/agent-account.service';
import { getErrorMessage } from '@/lib/errors';

/**
 * AGT-1b (spec §8) — the two switchable categories. Money, affiliation and appointment
 * notifications always go out.
 */
export function NotificationsTab({ profile }: { profile: AgentProfile }) {
  const prefs = useAgentPrefs();
  const set = async (news: boolean, reminders: boolean) => {
    try {
      await prefs.mutateAsync({ news, reminders });
      toast.success('Préférences enregistrées');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Enregistrement impossible');
    }
  };
  const row = (label: string, desc: string, on: boolean, toggle: () => void) => (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[#E1E4EA] p-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-[#5C5C5C]">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={toggle}
        disabled={prefs.isPending}
        className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-brand-primary' : 'bg-gray-200'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  );
  return (
    <div className="space-y-3">
      {row(
        'Actualités et mises à jour',
        'Les nouveautés de la plateforme Toodooh.',
        profile.notify_news,
        () => void set(!profile.notify_news, profile.notify_reminders),
      )}
      {row(
        'Rappels et événements',
        'Rappels de rendez-vous et de fin d’affiliation.',
        profile.notify_reminders,
        () => void set(profile.notify_news, !profile.notify_reminders),
      )}
      <p className="text-xs text-[#5C5C5C]">
        Les notifications liées à vos revenus, à vos affiliés et à vos rendez-vous sont toujours
        envoyées.
      </p>
    </div>
  );
}
