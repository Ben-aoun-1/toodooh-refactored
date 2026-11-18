import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Stethoscope } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useFleetRemote } from '@/features/admin/hooks/useFleet';
import { sinceLabel } from '@/features/admin/lib/fleet';
import {
  EVENT_LABEL,
  ISSUE_FIX,
  ISSUE_LABEL,
  START_REASON_LABEL,
  deviceLine,
  isBlockingIssue,
  offlineStretches,
  yesNo,
} from '@/features/admin/lib/fleet-health';
import type { FleetScreenDetailWire } from '@/features/admin/services/admin-fleet.service';
import { getErrorMessage } from '@/lib/errors';

const time = (iso: string): string =>
  new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Tunis',
  }).format(new Date(iso));

const Fact = ({ label, value, bad }: { label: string; value: string; bad?: boolean }) => (
  <div className="flex justify-between gap-3 py-1.5 text-sm">
    <span className="text-gray-500">{label}</span>
    <span className={bad ? 'font-semibold text-red-700' : 'text-gray-900'}>{value}</span>
  </div>
);

/**
 * FLEET-2 — « Santé de la TV »: what the TV app reports about itself (1.5.6+), what to fix and
 * how, its connection history, and the remote actions (reconnect, ask for its state).
 */
export default function FleetHealthSection({ s, now }: { s: FleetScreenDetailWire; now: Date }) {
  const remote = useFleetRemote(s.id);
  const act = async (which: 'restart' | 'requestStatus') => {
    try {
      await remote[which].mutateAsync();
      toast.success(which === 'restart' ? 'La TV se reconnecte…' : 'État demandé à la TV…');
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) || 'La TV n’a pas pu être jointe.');
    }
  };
  const d = s.device;
  const stretches = offlineStretches(s.events);

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Stethoscope className="h-4 w-4 text-brand-deep" /> Santé de la TV
      </h3>

      {s.issues.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4" /> Tout est en ordre sur cette TV.
        </p>
      ) : (
        <ul className="space-y-2">
          {s.issues.map((issue) => (
            <li
              key={issue}
              className={`rounded-lg p-3 text-sm ${isBlockingIssue(issue) ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> {ISSUE_LABEL[issue]}
              </div>
              <p className="mt-1 text-xs">{ISSUE_FIX[issue]}</p>
            </li>
          ))}
        </ul>
      )}

      {d && (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 px-3">
          <Fact
            label="Application"
            value={`${d.app_version_name ?? '?'} (${d.app_version_code ?? '?'})`}
            bad={s.issues.includes('outdated')}
          />
          <Fact label="Appareil" value={deviceLine(d) || '—'} />
          <Fact
            label="Afficher par-dessus"
            value={yesNo(d.overlay_granted)}
            bad={d.overlay_granted === false}
          />
          <Fact
            label="Démarrage automatique"
            value={yesNo(d.auto_start_allowed)}
            bad={d.auto_start_allowed === false}
          />
          <Fact
            label="Dernier démarrage"
            value={
              d.service_started_at
                ? `${time(d.service_started_at)}${d.start_reason ? `, ${START_REASON_LABEL[d.start_reason]}` : ''}`
                : '—'
            }
          />
          <Fact label="Rapport reçu" value={sinceLabel(s.device_report_at, now)} />
          {s.player && (
            <Fact
              label="Lecteur"
              value={`${s.player.status ?? '?'} · ${s.player.playlist_size ?? 0} spot(s), ${s.player.cached_videos ?? 0} en cache · ${sinceLabel(s.player_report_at, now)}`}
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!s.connected || remote.restart.isPending}
          onClick={() => void act('restart')}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-brand-deep disabled:opacity-40"
        >
          {remote.restart.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Reconnecter la TV
        </button>
        <button
          type="button"
          disabled={!s.connected || remote.requestStatus.isPending}
          onClick={() => void act('requestStatus')}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-brand-deep disabled:opacity-40"
        >
          {remote.requestStatus.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Demander un état
        </button>
        {!s.connected && (
          <span className="self-center text-xs text-gray-500">La TV doit être connectée.</span>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-gray-700">Dernières 24 h</p>
        {stretches.length > 0 && (
          <ul className="mb-2 space-y-1 text-xs text-red-800">
            {stretches.map((st) => (
              <li key={st.from}>
                Hors ligne {time(st.from)} → {st.to ? time(st.to) : 'maintenant'}
              </li>
            ))}
          </ul>
        )}
        {s.events.length === 0 ? (
          <p className="text-xs text-gray-500">Aucun événement enregistré.</p>
        ) : (
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-gray-600">
            {s.events.map((e) => (
              <li key={`${e.kind}-${e.at}`}>
                {time(e.at)} · {EVENT_LABEL[e.kind] ?? e.kind}
                {e.kind === 'playback_error' && e.detail ? ` : ${e.detail}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
