import type { AgentKind } from './agent-shell';

// AGENT-VF (spec VF « Support, FAQ et déconnexion ») — the FAQ of each agent type, verbatim from
// the product prototype: 11 questions for a Screenhost agent, 9 for a Screencaster agent.

export interface FaqEntry {
  question: string;
  answer: string;
}

const RIB_ANSWER =
  'Sans RIB validé, aucun versement ne peut être émis : vos revenus s’accumulent et sont versés dès la validation. « En attente de validation » signifie que l’équipe Toodooh vérifie votre document.';
const EMAIL_ZONE: FaqEntry = {
  question: 'Comment modifier mon email ou ma zone couverte ?',
  answer: 'Ces informations se modifient sur demande, via le Support.',
};

const SCREENHOST: FaqEntry[] = [
  {
    question: 'À quoi sert mon code agent ?',
    answer:
      'C’est votre identifiant unique. Le Screenhost le saisit lors de son inscription : il devient alors votre Screenhost affilié et vous êtes son agent référent.',
  },
  {
    question: 'Quand un Screenhost affilié est-il activé ?',
    answer:
      'À la fin de sa première campagne diffusée jusqu’à son terme. Avant cela, il apparaît « En attente d’activation ».',
  },
  {
    question: 'Pendant combien de temps suis-je commissionné sur un Screenhost ?',
    answer:
      'Pendant 24 mois à partir de sa date d’activation. La date de fin est affichée sur sa fiche.',
  },
  {
    question: 'Comment ma commission est-elle calculée ?',
    answer:
      'Quand un Screenhost affilié accepte une campagne, vous êtes notifié du montant que vous allez recevoir. Ce montant apparaît dans « Mes campagnes » comme montant à gagner, et il est ajusté si la campagne est redispatchée. À la clôture, le montant final s’ajoute à vos revenus.',
  },
  {
    question: 'Quand et comment suis-je payé ?',
    answer:
      'Chaque mois, par virement sur votre RIB validé, sans montant minimum. Chaque versement apparaît dans « Mes revenus ».',
  },
  { question: 'Pourquoi dois-je téléverser mon RIB ?', answer: RIB_ANSWER },
  {
    question: 'Qu’est-ce que le score de priorité ?',
    answer:
      'Il détermine l’ordre dans lequel les campagnes sont proposées à un Screenhost. Il n’entraîne aucune pénalité financière.',
  },
  {
    question: 'Que signifie un point d’attention ?',
    answer:
      'Il signale un Screenhost qui mérite votre accompagnement : refus fréquents, offres sans réponse, écrans peu actifs, événement non diffusé ou absence de campagne récente. Il disparaît de lui-même quand la situation se rétablit.',
  },
  {
    question: 'Comment gérer mes rendez-vous ?',
    answer:
      'Vos Screenhosts affiliés réservent selon vos disponibilités. Vous acceptez ou proposez un nouvel horaire depuis vos notifications ou Mon calendrier. Vous pouvez aussi prendre vous-même un rendez-vous avec un Screenhost affilié : bouton « Prendre un rendez-vous » dans Mon calendrier, sur le Dashboard ou dans sa fiche. Il l’accepte ou propose un autre horaire, et l’équipe Toodooh est informée. Bloquez vos indisponibilités, par jour entier ou par heure, dans Mon calendrier.',
  },
  {
    question: 'Comment ajouter le logo d’un Screenhost ?',
    answer:
      'Ouvrez sa fiche dans « Mes Screenhosts » et cliquez sur « Ajouter le logo » : fichier transmis par le gérant ou photo de l’enseigne. Le logo s’affiche après validation par l’équipe Toodooh.',
  },
  EMAIL_ZONE,
];

const SCREENCASTER: FaqEntry[] = [
  {
    question: 'À quoi sert mon code agent ?',
    answer:
      'C’est votre identifiant unique. L’annonceur le saisit lors de son inscription : il devient alors votre Screencaster affilié et vous êtes son agent référent.',
  },
  {
    question: 'Pendant combien de temps suis-je commissionné sur un Screencaster ?',
    answer:
      'Pendant 24 mois à partir de la validation de son inscription. La date de fin est affichée sur sa fiche.',
  },
  {
    question: 'Que se passe-t-il quand mon Screencaster recharge son portefeuille ?',
    answer:
      'Vous êtes informé par notification. La recharge ne vous rapporte rien en elle-même : votre revenu vient des campagnes qu’il lance.',
  },
  {
    question: 'Comment ma commission est-elle calculée ?',
    answer:
      'Quand votre Screencaster lance une campagne, vous êtes notifié du montant que vous allez gagner. Ce montant apparaît dans « Mes campagnes ». À la fin de la campagne, votre revenu s’ajoute à « Mes revenus », avec une ligne de transaction.',
  },
  {
    question: 'Quand et comment suis-je payé ?',
    answer:
      'Chaque mois, par virement sur votre RIB validé, dès que votre solde atteint le seuil de versement et que votre facture mensuelle est remise.',
  },
  { question: 'Pourquoi dois-je téléverser mon RIB ?', answer: RIB_ANSWER },
  {
    question: 'Comment gérer mes rendez-vous ?',
    answer:
      'Vos Screencasters affiliés réservent selon vos disponibilités. Vous acceptez ou proposez un nouvel horaire depuis vos notifications ou Mon calendrier. Vous pouvez aussi prendre vous-même un rendez-vous avec un Screencaster affilié : bouton « Prendre un rendez-vous » dans Mon calendrier, sur le Dashboard ou dans sa fiche. Il l’accepte ou propose un autre horaire, et l’équipe Toodooh est informée. Bloquez vos indisponibilités, par jour entier ou par heure, dans Mon calendrier.',
  },
  {
    question: 'Comment ajouter le logo d’un Screencaster ?',
    answer:
      'Ouvrez sa fiche dans « Mes Screencasters » et cliquez sur « Ajouter le logo », avec le fichier transmis par l’annonceur. Le logo s’affiche après validation par l’équipe Toodooh.',
  },
  EMAIL_ZONE,
];

export const agentFaq = (kind: AgentKind): FaqEntry[] =>
  kind === 'screenhost' ? SCREENHOST : SCREENCASTER;
