import type { AgentOffer } from '../services/agent-offers.service';

import { vfDate } from './agent-vf';

// Agent Screenhost spec VF §10 — the offer window's words, pure (verbatim from the prototype).

/** The offer a notification opens (`/agent?offre=<id>`), else null. */
export const offerIdOfLink = (link: string | null | undefined): string | null => {
  if (!link) return null;
  const query = link.split('?')[1];
  if (query === undefined) return null;
  const id = new URLSearchParams(query).get('offre');
  return id !== null && id !== '' ? id : null;
};

type Answered = Pick<AgentOffer, 'state' | 'answered_by' | 'screenhost_name'>;

const who = (o: Answered): string =>
  o.answered_by === 'vous'
    ? 'vous'
    : o.answered_by === 'toodooh'
      ? 'l’équipe Toodooh'
      : o.screenhost_name;

export interface OfferBadge {
  tone: 'wait' | 'ok' | 'red';
  label: string;
}

/** « En attente de réponse », « Acceptée par vous », « Refusée par {Screenhost} ». */
export const offerBadge = (o: Answered): OfferBadge =>
  o.state === 'attente'
    ? { tone: 'wait', label: 'En attente de réponse' }
    : o.state === 'acceptee'
      ? { tone: 'ok', label: `Acceptée par ${who(o)}` }
      : { tone: 'red', label: `Refusée par ${who(o)}` };

/** The banner under the spot: what the agent can still do. */
export const offerBanner = (
  o: Answered & Pick<AgentOffer, 'decidable'>,
): { tone: 'violet' | 'ok'; text: string } => {
  const sh = o.screenhost_name;
  if (o.state === 'attente') {
    return o.decidable
      ? {
          tone: 'violet',
          text: `Vous pouvez répondre pour le compte de ${sh}. Le premier qui répond, vous ou le Screenhost, décide ; l'autre est informé et ne peut plus agir.`,
        }
      : {
          tone: 'ok',
          text: 'Cette offre n’est plus d’actualité : la campagne est terminée ou a été retirée.',
        };
  }
  if (o.answered_by === 'vous') {
    return {
      tone: 'ok',
      text: `Vous avez répondu pour le compte de ${sh}. Le Screenhost en a été informé et ne peut plus agir.`,
    };
  }
  if (o.answered_by === 'toodooh') {
    return {
      tone: 'ok',
      text: `L’équipe Toodooh a répondu à cette offre pour ${sh}. Vous ne pouvez plus agir, vous êtes seulement informé.`,
    };
  }
  return {
    tone: 'ok',
    text: `${sh} a déjà répondu à cette offre. Vous ne pouvez plus agir, vous êtes seulement informé.`,
  };
};

/** The toast after the agent's answer. */
export const offerAnsweredToast = (accepted: boolean, screenhostName: string): string =>
  `${accepted ? 'Offre acceptée' : 'Offre refusée'} pour ${screenhostName}. Le Screenhost est informé.`;

/** « Grand Tunis, Sousse », the whole network when no zone is named. */
export const offerZoneLabel = (zones: readonly string[]): string =>
  zones.length === 0 ? 'Tout le réseau' : zones.join(', ');

/** The Host reads every classic campaign as « Particuliers »; the agent reads the same. */
export const offerTypeLabel = (campaignType: string): string =>
  campaignType === 'standard'
    ? 'Particuliers'
    : campaignType === 'parc'
      ? 'Parc TV'
      : campaignType === 'evenement'
        ? 'Soir de match'
        : campaignType;

/** « 15/09/2027 à 20h00 » — a kick-off on the Tunis clock. */
export const kickoffLabel = (iso: string): string => {
  const d = new Date(iso);
  const day = d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' });
  const [h, m] = d
    .toLocaleTimeString('fr-FR', { timeZone: 'Africa/Tunis', hour: '2-digit', minute: '2-digit' })
    .split(':');
  return `${day} à ${h ?? '00'}h${m ?? '00'}`;
};

/**
 * The offer window's facts: type, zone and dates for a campaign; for a match (Mariem 15/11), its
 * kick-off and the spots the answer covers.
 */
export const offerFacts = (
  o: Pick<
    AgentOffer,
    'kind' | 'campaign_type' | 'zones' | 'start_date' | 'end_date' | 'kickoff_at' | 'spots'
  >,
): { label: string; value: string }[] =>
  o.kind === 'event'
    ? [
        { label: 'Type de la campagne', value: offerTypeLabel(o.campaign_type) },
        { label: 'Coup d’envoi', value: o.kickoff_at ? kickoffLabel(o.kickoff_at) : '–' },
        { label: 'Spots', value: o.spots > 1 ? `${o.spots} spots` : '1 spot' },
      ]
    : [
        { label: 'Type de la campagne', value: offerTypeLabel(o.campaign_type) },
        { label: 'Zone', value: offerZoneLabel(o.zones) },
        { label: 'Début', value: vfDate(o.start_date) },
        { label: 'Fin', value: vfDate(o.end_date) },
      ];
