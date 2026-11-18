import type {
  FleetDeviceWire,
  FleetIssue,
  FleetStartReason,
} from '@/features/admin/services/admin-fleet.service';

// FLEET-2 (operator 18/11, phase 2) — « Santé de la TV », the pure half: what each health fact says
// to the admin, and what to do about it. The facts come from the TV app (1.5.6+) through the api.

export const ISSUE_LABEL: Record<FleetIssue, string> = {
  overlay_missing: '« Afficher par-dessus » manquant',
  auto_start_blocked: 'Démarrage auto bloqué (TCL)',
  outdated: 'Application à mettre à jour',
  unknown_version: 'Version inconnue (avant 1.5.6)',
};

/** What fixes it, in one sentence the installer can follow. */
export const ISSUE_FIX: Record<FleetIssue, string> = {
  overlay_missing:
    'Sur la TV : Paramètres › Applications › Accès spécial › Afficher par-dessus d’autres applis › Toodooh Streamer › autoriser. Sans cela, les pubs ne passent pas par-dessus YouTube.',
  auto_start_blocked:
    'Sur la TV : ouvrir « Dispositif de protection » › Gestion des autorisations › Démarrage automatique › autoriser Toodooh Streamer. Sans cela, la TV ne relance pas l’application au démarrage.',
  outdated:
    'Installer la dernière version depuis too-dooh.com/downloads/toodooh-tv.apk (par-dessus l’ancienne : la connexion est conservée).',
  unknown_version:
    'Cette TV a une version antérieure à 1.5.6, qui ne dit pas son état. Installer la dernière version.',
};

/** Blocking first: these keep ads off the screen. */
export const isBlockingIssue = (issue: FleetIssue): boolean =>
  issue === 'overlay_missing' || issue === 'auto_start_blocked';

export const START_REASON_LABEL: Record<FleetStartReason, string> = {
  boot: 'au démarrage de la TV',
  quickboot: 'au réveil de la TV (démarrage rapide)',
  update: 'après une mise à jour de l’application',
  watchdog: 'par le chien de garde (l’application s’était arrêtée)',
  app: 'à l’ouverture de l’application',
  system: 'relancée par Android',
};

/** « TCL Smart TV Pro · Android 11 ». */
export const deviceLine = (d: FleetDeviceWire): string =>
  [
    [d.manufacturer, d.model].filter(Boolean).join(' '),
    d.android_release ? `Android ${d.android_release}` : null,
  ]
    .filter((x): x is string => Boolean(x))
    .join(' · ');

/** ✅ / ❌ / « inconnu » for a yes/no the TV may not know. */
export const yesNo = (v: boolean | null): 'oui' | 'non' | 'inconnu' =>
  v === null ? 'inconnu' : v ? 'oui' : 'non';

export const EVENT_LABEL: Record<string, string> = {
  connect: 'Connectée',
  disconnect: 'Déconnectée',
  playback_error: 'Erreur de lecture',
  restart_requested: 'Reconnexion demandée par l’admin',
  status_requested: 'État demandé par l’admin',
};

/** A connection history, newest first → the offline stretches (« 22:03 → 04:01 »). */
export const offlineStretches = (
  events: readonly { kind: string; at: string }[],
): { from: string; to: string | null }[] => {
  const chronological = [...events]
    .filter((e) => e.kind === 'connect' || e.kind === 'disconnect')
    .sort((a, b) => a.at.localeCompare(b.at));
  const out: { from: string; to: string | null }[] = [];
  let openFrom: string | null = null;
  for (const e of chronological) {
    if (e.kind === 'disconnect' && openFrom === null) openFrom = e.at;
    if (e.kind === 'connect' && openFrom !== null) {
      out.push({ from: openFrom, to: e.at });
      openFrom = null;
    }
  }
  if (openFrom !== null) out.push({ from: openFrom, to: null });
  return out.reverse();
};
