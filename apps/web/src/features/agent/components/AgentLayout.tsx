import { ChevronLeft, ChevronRight, Menu, Users, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import logoImage from '@/assets/logo.png';
import paramIcon from '@/assets/param.png';
import paramIconActive from '@/assets/params.png';
import agendaIcon from '@/assets/sidebar/agenda.png';
import agendaIconActive from '@/assets/sidebar/agendas.png';
import campagneIcon from '@/assets/sidebar/campagnes.png';
import campagneIconActive from '@/assets/sidebar/campagness.png';
import dashboardIcon from '@/assets/sidebar/dashboard.png';
import dashboardIconActive from '@/assets/sidebar/dashboards.png';
import logoCompany from '@/assets/sidebar/logo.png';
import supportIcon from '@/assets/support.png';
import supportIconActive from '@/assets/supports.png';
import ContentErrorBoundary from '@/components/ContentErrorBoundary';
import { ModalProvider, useModal } from '@/contexts/ModalContext';
import AdvertiserNotificationsBell from '@/features/advertiser/components/AdvertiserNotificationsBell';
import SidebarNavItem from '@/features/advertiser/components/SidebarNavItem';
import { useAgentAccount } from '@/features/agent/hooks/useAgentAccount';
import {
  AGENT_PATHS,
  type AgentPage,
  affiliatesNavLabel,
  agentKindOf,
  agentPageHeading,
  agentSupportObjectives,
} from '@/features/agent/lib/agent-shell';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import SupportModal from '@/features/support/components/SupportModal';

interface AgentLayoutProps {
  page: AgentPage;
  children: ReactNode;
}

// AGT-1b (agent specs v1.0 §3) — the agent shell, built from the Screencaster shell's own parts
// (sidebar, SidebarNavItem, collapse, logout modal, Support modal, bell) so nothing shared is
// redefined. Sidebar: Dashboard, Mes campagnes, Mon calendrier, Mes Screencasters|Screenhosts,
// then Paramètres and Support; the header carries the final title / subtitle per page.
export default function AgentLayout(props: AgentLayoutProps) {
  return (
    <ModalProvider>
      <AgentChrome {...props} />
    </ModalProvider>
  );
}

function AgentChrome({ page, children }: AgentLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const contactName = useAuthStore((s) => s.contactName);
  const account = useAgentAccount();
  const { openLogout } = useModal();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [supportOpen, setSupportOpen] = useState(false);

  const kind = agentKindOf(role) ?? 'screencaster';
  const firstName = account.data?.first_name ?? contactName?.split(' ')[0] ?? null;
  const heading = agentPageHeading(kind, page, firstName);
  const settingsActive = location.pathname === AGENT_PATHS.settings;
  const close = () => setMenuOpen(false);

  const bottomButton = (
    label: string,
    active: boolean,
    icons: [string, string],
    onClick: () => void,
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={!expanded ? label : undefined}
      className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
        expanded ? 'w-full max-w-[232px] px-3 py-2 gap-3' : 'w-10 justify-center mx-auto'
      } ${active ? 'bg-[#E6F7ED] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
    >
      <img
        src={active ? icons[1] : icons[0]}
        alt=""
        className="h-5 w-5 flex-shrink-0 object-contain"
      />
      {expanded && <span className="leading-5 truncate">{label}</span>}
    </button>
  );

  return (
    <div className="h-screen overflow-hidden bg-white flex flex-col lg:flex-row font-poppins">
      <aside
        className={`${menuOpen ? 'flex' : 'hidden'} lg:flex fixed left-0 z-30 flex-col bg-white border-r border-[#E1E4EA] isolate transition-[width] duration-200 ease-in-out overflow-hidden top-0 bottom-0 h-full lg:h-screen lg:sticky lg:top-0 w-[272px] ${
          expanded ? 'lg:w-[272px]' : 'lg:w-[80px]'
        } lg:flex-shrink-0`}
      >
        <div className="flex flex-col justify-center items-start p-3 gap-2.5 h-[88px] border-b border-[#E1E4EA] flex-none">
          <div className="flex flex-row items-center w-full gap-2">
            <div
              className={`flex items-center justify-center overflow-hidden transition-all ${
                expanded ? 'flex-1 min-w-0' : 'w-10 h-10 flex-shrink-0'
              }`}
            >
              <img
                src={expanded ? logoImage : logoCompany}
                alt="Toodooh"
                className={
                  expanded ? 'h-10 w-auto max-w-[178px] object-contain' : 'w-10 h-10 object-contain'
                }
              />
            </div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex-shrink-0 p-2 rounded-lg text-[#5C5C5C] hover:bg-gray-100 transition-colors hidden lg:flex"
              title={expanded ? 'Réduire le menu' : 'Ouvrir le menu'}
            >
              {expanded ? (
                <ChevronLeft className="h-5 w-5" />
              ) : (
                <ChevronRight className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={close}
              className="lg:hidden p-2 rounded-lg text-[#5C5C5C] hover:bg-gray-100"
              aria-label="Fermer le menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <nav className="flex flex-col flex-1 min-h-0 overflow-y-auto py-5 gap-2 px-3">
          <SidebarNavItem
            path={AGENT_PATHS.dashboard}
            label="Dashboard"
            activeIcon={dashboardIconActive}
            inactiveIcon={dashboardIcon}
            expanded={expanded}
            onNavigate={close}
          />
          <SidebarNavItem
            path={AGENT_PATHS.campaigns}
            label="Mes campagnes"
            activeIcon={campagneIconActive}
            inactiveIcon={campagneIcon}
            expanded={expanded}
            onNavigate={close}
          />
          <SidebarNavItem
            path={AGENT_PATHS.calendar}
            label="Mon calendrier"
            activeIcon={agendaIconActive}
            inactiveIcon={agendaIcon}
            expanded={expanded}
            onNavigate={close}
          />
          <SidebarNavItem
            path={AGENT_PATHS.affiliates}
            label={affiliatesNavLabel(kind)}
            icon={<Users className="h-5 w-5 flex-shrink-0" strokeWidth={1.7} />}
            expanded={expanded}
            onNavigate={close}
          />
        </nav>

        <div
          className={`flex flex-col flex-none pt-2 pb-2 gap-2 px-3 ${expanded ? '' : 'items-center'}`}
        >
          {bottomButton('Paramètres', settingsActive, [paramIcon, paramIconActive], () => {
            navigate(AGENT_PATHS.settings);
            close();
          })}
          {bottomButton('Support', supportOpen, [supportIcon, supportIconActive], () => {
            setSupportOpen(true);
            close();
          })}
        </div>

        <div
          className={`flex flex-col flex-none border-t border-[#E1E4EA] ${expanded ? '' : 'items-center'}`}
        >
          <button
            type="button"
            onClick={openLogout}
            title={expanded ? 'Se déconnecter' : undefined}
            className={`w-full h-12 flex flex-row items-center gap-3 text-left ${
              expanded ? 'px-3 py-3' : 'justify-center p-2'
            }`}
          >
            <span className="h-9 w-9 flex-shrink-0 rounded-full bg-brand-primary flex items-center justify-center text-sm font-medium text-white">
              {(firstName ?? contactName ?? 'A').charAt(0).toUpperCase()}
            </span>
            {expanded && (
              <>
                <span className="flex-1 min-w-0 text-sm font-medium text-[#5C5C5C] truncate">
                  {firstName ?? contactName}
                </span>
                <ChevronRight className="h-5 w-5 flex-shrink-0 text-[#5C5C5C]" strokeWidth={1.5} />
              </>
            )}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        <header className="flex items-center gap-3 border-b border-[#E1E4EA] px-4 sm:px-6 lg:px-8 py-4">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg text-[#5C5C5C] hover:bg-gray-100"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-[#171717] truncate">{heading.title}</h1>
            <p className="text-sm text-[#5C5C5C]">{heading.subtitle}</p>
          </div>
          <AdvertiserNotificationsBell userId={user?.id} />
        </header>
        <main className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 text-[15px] leading-6 text-[#171717]">
          <ContentErrorBoundary>{children}</ContentErrorBoundary>
        </main>
      </div>
      {supportOpen && (
        <SupportModal
          onClose={() => setSupportOpen(false)}
          objectives={agentSupportObjectives(kind)}
          originPage={location.pathname}
        />
      )}
    </div>
  );
}
