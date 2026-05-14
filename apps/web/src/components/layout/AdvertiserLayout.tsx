import { ChevronLeft, ChevronRight, Users, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import deconnexionIcon from '../../assets/deconnexion.png';
import logoImage from '../../assets/logo.png';
import paramIcon from '../../assets/param.png';
import paramIconActive from '../../assets/params.png';
import agendaIcon from '../../assets/sidebar/agenda.png';
import agendaIconActive from '../../assets/sidebar/agendas.png';
import campagneIcon from '../../assets/sidebar/campagnes.png';
import campagneIconActive from '../../assets/sidebar/campagness.png';
import dashboardIcon from '../../assets/sidebar/dashboard.png';
import dashboardIconActive from '../../assets/sidebar/dashboards.png';
import logoCompany from '../../assets/sidebar/logo.png';
import performanceIcon from '../../assets/sidebar/performance.png';
import performanceIconActive from '../../assets/sidebar/performances.png';
import financeIcon from '../../assets/sidebar/portefeuille.png';
import financeIconActive from '../../assets/sidebar/portefeuilles.png';
import supportIcon from '../../assets/support.png';
import supportIconActive from '../../assets/supports.png';
import { ModalProvider, useModal } from '../../contexts/ModalContext';
import { useAuthStore } from '../../stores/auth.store';
import { useCartStore } from '../../stores/cart.store';
import CartSidebar from '../CartSidebar';
import ContentErrorBoundary from '../ContentErrorBoundary';

import PageHeader from './PageHeader';
import SidebarNavItem from './SidebarNavItem';

interface AdvertiserLayoutProps {
  children: ReactNode;
  /** Optional override for the greeting name when on `/dashboard`. */
  userName?: string;
}

/**
 * Public layout wrapper for advertiser routes. Mounts <ModalProvider>
 * so the inner chrome and the page content both see modal triggers.
 */
export default function AdvertiserLayout({ children, userName }: AdvertiserLayoutProps) {
  return (
    <ModalProvider>
      <AdvertiserLayoutChrome userName={userName}>{children}</AdvertiserLayoutChrome>
    </ModalProvider>
  );
}

function AdvertiserLayoutChrome({ children, userName }: AdvertiserLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const profileType = useAuthStore((s) => s.profileType);
  const needsApproval = useAuthStore((s) => s.needsApproval);
  const validationStatus = useAuthStore((s) => s.validationStatus);
  const contactName = useAuthStore((s) => s.contactName);
  const cartCount = useCartStore((s) => s.items.length);
  const { openLogout, openSupport, openAppointment, isSupportOpen } = useModal();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);

  const isDisabled = needsApproval && validationStatus === 'pending';
  const showClientsLink = profileType === 'advertising_agency' || profileType === 'event_organizer';
  const fallbackName = user?.email?.split('@')[0] || 'Utilisateur';
  const displayName = userName || contactName || fallbackName;
  const isProfileRoute = location.pathname === '/profile';

  return (
    <div className="min-h-screen bg-white flex flex-col lg:flex-row">
      <aside
        className={`
          ${isMenuOpen ? 'flex' : 'hidden'} lg:flex
          fixed left-0 z-30 flex flex-col bg-white border-r border-[#E1E4EA] isolate transition-[width] duration-200 ease-in-out overflow-hidden
          top-0 bottom-0 h-full lg:h-screen lg:sticky lg:top-0
          w-[272px] ${sidebarExpanded ? 'lg:w-[272px]' : 'lg:w-[80px]'} lg:flex-shrink-0
        `}
      >
        <div className="flex flex-col justify-center items-start p-3 gap-2.5 h-[88px] border-b border-[#E1E4EA] flex-none">
          <div className="flex flex-row items-center w-full gap-2">
            <div
              className={`flex items-center justify-center overflow-hidden transition-all ${
                sidebarExpanded ? 'flex-1 min-w-0' : 'w-10 h-10 flex-shrink-0'
              }`}
            >
              {sidebarExpanded ? (
                <img
                  src={logoImage}
                  alt="Logo"
                  className="h-10 w-auto max-w-[178px] object-contain"
                />
              ) : (
                <img src={logoCompany} alt="Logo" className="w-10 h-10 object-contain" />
              )}
            </div>
            <button
              type="button"
              onClick={() => setSidebarExpanded((v) => !v)}
              className="flex-shrink-0 p-2 rounded-lg text-[#5C5C5C] hover:bg-gray-100 transition-colors hidden lg:flex"
              title={sidebarExpanded ? 'Réduire le menu' : 'Ouvrir le menu'}
            >
              {sidebarExpanded ? (
                <ChevronLeft className="h-5 w-5" />
              ) : (
                <ChevronRight className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsMenuOpen(false)}
              className="lg:hidden p-2 rounded-lg text-[#5C5C5C] hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <nav className="flex flex-col flex-1 py-5 gap-2 px-3">
          <SidebarNavItem
            path="/dashboard"
            label="Dashboard"
            activeIcon={dashboardIconActive}
            inactiveIcon={dashboardIcon}
            expanded={sidebarExpanded}
            onNavigate={() => setIsMenuOpen(false)}
          />
          <SidebarNavItem
            path="/my-campaigns"
            label="Mes campagnes"
            activeIcon={campagneIconActive}
            inactiveIcon={campagneIcon}
            expanded={sidebarExpanded}
            disabled={isDisabled}
            onNavigate={() => setIsMenuOpen(false)}
          />
          <SidebarNavItem
            path="/evenements"
            label="Événements"
            activeIcon={agendaIconActive}
            inactiveIcon={agendaIcon}
            expanded={sidebarExpanded}
            disabled={isDisabled}
            onNavigate={() => setIsMenuOpen(false)}
          />
          <SidebarNavItem
            path="/my-recharges"
            label="Mes finances"
            activeIcon={financeIconActive}
            inactiveIcon={financeIcon}
            expanded={sidebarExpanded}
            disabled={isDisabled}
            onNavigate={() => setIsMenuOpen(false)}
          />
          <SidebarNavItem
            path="/perfor"
            label="Mes performances"
            activeIcon={performanceIconActive}
            inactiveIcon={performanceIcon}
            expanded={sidebarExpanded}
            disabled={isDisabled}
            onNavigate={() => setIsMenuOpen(false)}
          />
          {showClientsLink && (
            <button
              onClick={() => {
                if (isDisabled) return;
                navigate('/my-clients');
                setIsMenuOpen(false);
              }}
              disabled={isDisabled}
              title={!sidebarExpanded ? 'Mes clients' : undefined}
              className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
                sidebarExpanded
                  ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                  : 'w-10 justify-center mx-auto'
              } ${
                isDisabled
                  ? 'text-[#5C5C5C] opacity-50 cursor-not-allowed'
                  : location.pathname === '/my-clients'
                    ? 'bg-[#E4F9EB] text-[#132B1B]'
                    : 'text-[#5C5C5C] hover:bg-gray-100/80'
              }`}
            >
              <Users className="h-5 w-5 flex-shrink-0" strokeWidth={1.5} />
              {sidebarExpanded && <span className="leading-5 truncate">Mes clients</span>}
            </button>
          )}
        </nav>

        <div
          className={`flex flex-col flex-none pt-2 pb-2 gap-2 px-3 ${
            sidebarExpanded ? '' : 'items-center'
          }`}
        >
          <button
            onClick={() => {
              navigate('/profile');
              setIsMenuOpen(false);
            }}
            title={!sidebarExpanded ? 'Mes informations' : undefined}
            className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
              sidebarExpanded
                ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                : 'w-10 justify-center mx-auto'
            } ${
              isProfileRoute ? 'bg-[#E6F7ED] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'
            }`}
          >
            <img
              src={isProfileRoute ? paramIconActive : paramIcon}
              alt=""
              className="h-5 w-5 flex-shrink-0 object-contain"
            />
            {sidebarExpanded && <span className="leading-5 truncate">Paramètres</span>}
          </button>
          <button
            onClick={() => {
              openSupport();
              setIsMenuOpen(false);
            }}
            title={!sidebarExpanded ? 'Support' : undefined}
            className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
              sidebarExpanded
                ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                : 'w-10 justify-center mx-auto'
            } ${
              isSupportOpen ? 'bg-[#E6F7ED] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'
            }`}
          >
            <img
              src={isSupportOpen ? supportIconActive : supportIcon}
              alt=""
              className="h-5 w-5 flex-shrink-0 object-contain"
            />
            {sidebarExpanded && <span className="leading-5 truncate">Support</span>}
          </button>
        </div>

        <div
          className={`flex flex-col flex-none border-t border-[#E1E4EA] ${
            sidebarExpanded ? '' : 'items-center'
          }`}
        >
          <button
            type="button"
            onClick={openLogout}
            title={sidebarExpanded ? 'Déconnexion' : undefined}
            className={`w-full h-12 flex flex-row items-center gap-3 rounded-none text-left ${
              sidebarExpanded ? 'px-3 py-3' : 'justify-center p-2'
            }`}
          >
            <img src={deconnexionIcon} alt="" className="h-9 w-9 flex-shrink-0 object-contain" />
            {sidebarExpanded && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#5C5C5C] leading-5 tracking-[-0.006em] truncate">
                    {displayName}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 flex-shrink-0 text-[#5C5C5C]" strokeWidth={1.5} />
              </>
            )}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        <PageHeader
          onMobileMenuClick={() => setIsMenuOpen(!isMenuOpen)}
          onContactClick={openAppointment}
          onCartToggle={() => setCartOpen((v) => !v)}
          cartCount={cartCount}
          userId={user?.id}
          userName={displayName}
        />
        <main className="flex-1 min-h-0 overflow-auto p-8">
          <ContentErrorBoundary>{children}</ContentErrorBoundary>
        </main>
      </div>

      <CartSidebar open={cartOpen} />
    </div>
  );
}
