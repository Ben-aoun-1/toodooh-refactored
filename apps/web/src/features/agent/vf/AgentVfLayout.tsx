import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast as hotToast } from 'react-hot-toast';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import ContentErrorBoundary from '@/components/ContentErrorBoundary';
import { useAgentAccount } from '@/features/agent/hooks/useAgentAccount';
import {
  AGENT_PAGE_ICON,
  AGENT_PATHS,
  type AgentKind,
  type AgentPage,
  agentKindOf,
  agentNav,
  agentPageHeading,
} from '@/features/agent/lib/agent-shell';
import logo from '@/features/agent/styles/img/vf-logo.png';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';

import { useVfMotion } from './useVfMotion';
import { VfBell } from './VfBell';
import { VfIcon } from './VfIcon';
import { VfOverlayProvider, useVfOverlay } from './VfOverlay';
import { VfSupportModal } from './VfSupportModal';

import '@/features/agent/styles/agent-vf.css';
import '@/features/agent/styles/agent-vf-extra.css';

interface AgentVfLayoutProps {
  page: AgentPage;
  children: ReactNode;
}

/**
 * AGENT-VF (Mariem's final prototypes, 12/11) — the agent shell exactly as the prototype draws it:
 * the glass sidebar (order of spec VF §0, then Paramètres, Support and the agent's name, which
 * signs out), the editorial header (page icon, title, subtitle, bell) and the overlay layer.
 * Everything inside `.agt` is styled by the ported stylesheet, not by Tailwind.
 */
export default function AgentVfLayout({ page, children }: AgentVfLayoutProps) {
  return (
    <div className="agt">
      <VfOverlayProvider>
        <Shell page={page}>{children}</Shell>
      </VfOverlayProvider>
    </div>
  );
}

function Shell({ page, children }: AgentVfLayoutProps) {
  const location = useLocation();
  const role = useAuthStore((s) => s.role);
  const contactName = useAuthStore((s) => s.contactName);
  const account = useAgentAccount();
  const { openModal } = useVfOverlay();
  const [mini, setMini] = useState(false);
  const [menu, setMenu] = useState(false);
  const view = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLElement>(null);

  const kind: AgentKind = agentKindOf(role) ?? 'screencaster';
  const firstName = account.data?.first_name ?? contactName?.split(' ')[0] ?? null;
  const heading = agentPageHeading(kind, page, firstName);
  const shownName = firstName ?? contactName ?? 'Agent';

  useVfMotion(view, top, location.pathname);
  useEffect(() => {
    window.scrollTo(0, 0);
    setMenu(false);
  }, [location.pathname]);

  const askLogout = () => openModal(<LogoutModal initial={shownName.charAt(0).toUpperCase()} />);

  return (
    <>
      <div className={`shell${mini ? ' mini' : ''}${menu ? ' vf-menu' : ''}`}>
        <aside className="side">
          <div className="brand">
            <img src={logo} alt="toodooh" />
            <span className="sym">t</span>
            <button
              type="button"
              className="tog"
              aria-label={mini ? 'Ouvrir le menu' : 'Réduire le menu'}
              onClick={() => setMini((v) => !v)}
            >
              {mini ? '›' : '‹'}
            </button>
          </div>
          <nav className="nav">
            {agentNav(kind).map((item) => (
              <Link
                key={item.page}
                to={AGENT_PATHS[item.page]}
                className={page === item.page ? 'on' : undefined}
              >
                <VfIcon k={AGENT_PAGE_ICON[item.page]} size={17} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
          <div className="low">
            <nav className="nav vf-low-nav">
              <Link to={AGENT_PATHS.settings} className={page === 'settings' ? 'on' : undefined}>
                <VfIcon k="gear" plain />
                <span>Paramètres</span>
              </Link>
              <Link
                to="#support"
                onClick={(e) => {
                  e.preventDefault();
                  openModal(<VfSupportModal kind={kind} />);
                }}
              >
                <VfIcon k="headset" plain />
                <span>Support</span>
              </Link>
            </nav>
            <div
              className="who"
              role="button"
              tabIndex={0}
              onClick={askLogout}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') askLogout();
              }}
            >
              <span className="av">{shownName.charAt(0).toUpperCase()}</span>
              <span>{shownName}</span>
              <span className="chev">›</span>
            </div>
          </div>
        </aside>
        <main className="main">
          <header className="top" ref={top}>
            <button
              type="button"
              className="vf-burger"
              aria-label="Ouvrir le menu"
              onClick={() => setMenu((v) => !v)}
            >
              ☰
            </button>
            <span className="pi">
              <VfIcon k={AGENT_PAGE_ICON[page]} size={17} />
            </span>
            <div>
              <h1>{heading.title}</h1>
              <p>{heading.subtitle}</p>
            </div>
            <span className="sp" />
            <VfBell />
          </header>
          <div className="content" id="view" ref={view}>
            <ContentErrorBoundary>{children}</ContentErrorBoundary>
          </div>
        </main>
      </div>
    </>
  );
}

/** « Vous allez être déconnecté. » (spec VF: a click on the name at the bottom of the sidebar). */
function LogoutModal({ initial }: { initial: string }) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const { closeAll } = useVfOverlay();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
      hotToast.success('Déconnexion réussie');
    } catch (error) {
      hotToast.error(getErrorMessage(error) || "Une erreur inattendue s'est produite");
    }
    navigate('/login');
  };

  return (
    <>
      <div className="mb2 vf-logout">
        <span className="av">{initial}</span>
        <b>Vous allez être déconnecté.</b>
      </div>
      <div className="mf vf-center">
        <button type="button" className="btn" onClick={closeAll}>
          Annuler
        </button>
        <button type="button" className="btn pri" disabled={busy} onClick={() => void signOut()}>
          Se déconnecter
        </button>
      </div>
    </>
  );
}
