/**
 * AGT-1b (agent specs v1.0 §3 « Libellés définitifs », §9 Support, §2 onboarding) — the agent
 * shell's literals per agent type, pure. The Figma frames carry labels copied from other
 * interfaces; these are the final ones. Vocabulary rules (§3): a Screencaster agent never reads
 * « Screenhost » or « établissement »; a Screenhost agent never reads « Screencasters affiliés »,
 * « SPS », « pénalité » or « sanction »; no « dispositif de diffusion », no dollar sign.
 */

export type AgentKind = 'screencaster' | 'screenhost';

export const agentKindOf = (role: string | null | undefined): AgentKind | null =>
  role === 'screencast_agent' ? 'screencaster' : role === 'screenhost_agent' ? 'screenhost' : null;

export type AgentPage = 'dashboard' | 'campaigns' | 'calendar' | 'affiliates' | 'settings';

export const AGENT_PATHS: Record<AgentPage, string> = {
  dashboard: '/agent',
  campaigns: '/agent/campagnes',
  calendar: '/agent/calendrier',
  affiliates: '/agent/affilies',
  settings: '/agent/parametres',
};

const NOUN: Record<AgentKind, string> = {
  screencaster: 'Screencasters',
  screenhost: 'Screenhosts',
};

/** The sidebar label of the portfolio entry: « Mes Screencasters » / « Mes Screenhosts ». */
export const affiliatesNavLabel = (kind: AgentKind): string => `Mes ${NOUN[kind]}`;

/** The page title and subtitle (§3 table). */
export function agentPageHeading(
  kind: AgentKind,
  page: AgentPage,
  firstName: string | null,
): { title: string; subtitle: string } {
  const sc = kind === 'screencaster';
  switch (page) {
    case 'dashboard':
      return {
        title: `Bonjour, ${firstName?.trim() || 'agent'}`,
        subtitle: sc
          ? 'Suivez l’activité de vos Screencasters affiliés, les campagnes en cours de diffusion et consultez vos revenus.'
          : 'Suivez l’activité de vos Screenhosts affiliés et les campagnes actuellement diffusées, et consultez vos revenus.',
      };
    case 'campaigns':
      return {
        title: 'Mes campagnes affiliées',
        subtitle: sc
          ? 'Consultez les campagnes diffusées par vos Screencasters affiliés'
          : 'Consultez les campagnes diffusées au sein de vos Screenhosts affiliés',
      };
    case 'affiliates':
      return {
        title: `Mes ${NOUN[kind]} affiliés`,
        subtitle: sc
          ? 'Consultez la liste de vos Screencasters affiliés'
          : 'Consultez la liste de vos Screenhosts affiliés et suivez leur engagement',
      };
    case 'calendar':
      return {
        title: 'Mon calendrier',
        subtitle: `Définissez vos disponibilités et suivez vos rendez-vous avec vos ${NOUN[kind]} affiliés`,
      };
    case 'settings':
      return {
        title: 'Paramètres',
        subtitle: 'Gérez vos préférences et configurez différentes options.',
      };
  }
}

/** §9 — the Support reasons (the hub list's initial content). */
export const agentSupportObjectives = (kind: AgentKind): string[] => [
  'Mon compte et mes informations',
  'Mes revenus et versements',
  kind === 'screencaster' ? 'Un Screencaster affilié' : 'Un Screenhost affilié',
  'Mes rendez-vous',
  'Problème technique',
  'Autre',
];

export type SettingsTab = 'profil' | 'legal' | 'notifications' | 'securite';

export const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: 'profil', label: 'Profil' },
  { key: 'legal', label: 'Informations légales' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'securite', label: 'Confidentialité et sécurité' },
];

export const settingsTabOf = (raw: string | null): SettingsTab =>
  SETTINGS_TABS.some((t) => t.key === raw) ? (raw as SettingsTab) : 'profil';

export interface OnboardingStepView {
  key: 'cge' | 'photo' | 'info' | 'rib';
  done: boolean;
  mandatory: boolean;
  pending?: boolean;
}

/** §2 — each step of « Finalisez votre compte »: its label, button and the tab it opens. */
export function onboardingStepCopy(step: OnboardingStepView): {
  label: string;
  status: string;
  tab: SettingsTab | null;
} {
  switch (step.key) {
    case 'cge':
      return {
        label: 'Accepter les CGE',
        status: step.done ? 'Acceptées' : 'À faire',
        tab: 'securite',
      };
    case 'photo':
      return {
        label: 'Ajouter ma photo de profil',
        status: step.done ? 'Ajoutée' : 'Facultatif',
        tab: 'legal',
      };
    case 'info':
      return {
        label: 'Vérifier mes informations',
        status: step.done ? 'Vérifiées' : 'À faire',
        tab: 'profil',
      };
    case 'rib':
      return {
        label: 'Téléverser mon RIB',
        status: step.done ? 'Validé' : step.pending ? 'En attente de validation' : 'À faire',
        tab: 'legal',
      };
  }
}

/** « 2 étapes sur 4 ». */
export const onboardingProgress = (done: number, total: number): string =>
  `${done} étape${done > 1 ? 's' : ''} sur ${total}`;

/** The password rule (spec §2): the platform floor of 10, one uppercase letter, one digit. */
export const passwordCriteria = (pw: string) => ({
  length: pw.length >= 10,
  upper: /[A-Z]/.test(pw),
  digit: /\d/.test(pw),
});

/** 0–3 strength for the gauge. */
export const passwordStrength = (pw: string): number =>
  Object.values(passwordCriteria(pw)).filter(Boolean).length;
