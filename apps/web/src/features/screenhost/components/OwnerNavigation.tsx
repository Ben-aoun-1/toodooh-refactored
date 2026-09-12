import {
  BarChart3,
  Menu,
  X,
  Home,
  Banknote,
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Megaphone,
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate, useLocation } from 'react-router-dom';

import deconnexionIcon from '@/assets/deconnexion.png';
import logoImage from '@/assets/logo.png';
import paramIcon from '@/assets/param.png';
import paramIconActive from '@/assets/params.png';
import campagneIcon from '@/assets/sidebar/campagnes.png';
import campagneIconActive from '@/assets/sidebar/campagness.png';
import dashboardIcon from '@/assets/sidebar/dashboard.png';
import dashboardIconActive from '@/assets/sidebar/dashboards.png';
import parcTvIcon from '@/assets/sidebar/ecrans.png';
import parcTvIconActive from '@/assets/sidebar/ecranss.png';
import logoCompany from '@/assets/sidebar/logo.png';
import performanceIcon from '@/assets/sidebar/performance.png';
import performanceIconActive from '@/assets/sidebar/performances.png';
import financeIcon from '@/assets/sidebar/portefeuille.png';
import financeIconActive from '@/assets/sidebar/portefeuilles.png';
import supportIcon from '@/assets/support.png';
import supportIconActive from '@/assets/supports.png';
import { useAppointmentObjectives } from '@/features/auth/hooks/useAppointmentObjectives';
import { useBusinessProfile } from '@/features/auth/hooks/useBusinessProfile';
import { useAuthStore } from '@/features/auth/stores/auth.store';

const APPOINTMENT_OBJECTIVES_FALLBACK = [
  'Renseignements',
  'Inscription',
  'Diffusion',
  'Ciblage',
  'Budget',
  'Accompagnement',
  'Support',
  'Facturation',
  'Autre',
];

function isAutreObjective(value: string): boolean {
  return value.trim().toLowerCase() === 'autre';
}

const navigation = [
  {
    name: 'Dashboard',
    href: '/owner-dashboard',
    icon: Home,
    iconSrc: dashboardIcon,
    iconSrcActive: dashboardIconActive,
  },
  {
    name: 'Mes campagnes',
    href: '/owner-campaigns',
    icon: Megaphone,
    iconSrc: campagneIcon,
    iconSrcActive: campagneIconActive,
  },
  {
    name: 'Calendrier de diffusion',
    href: '/owner-campaign-calendar',
    icon: CalendarDays,
  },
  {
    name: 'Mon calendrier et Mes dispositifs de diffusion',
    href: '/owner-calendar-devices',
    icon: Calendar,
    iconSrc: parcTvIcon,
    iconSrcActive: parcTvIconActive,
  },
  {
    name: 'Mes performances',
    href: '/owner-performance',
    icon: BarChart3,
    iconSrc: performanceIcon,
    iconSrcActive: performanceIconActive,
  },
  {
    name: 'Mes revenus',
    href: '/owner-revenue',
    icon: Banknote,
    iconSrc: financeIcon,
    iconSrcActive: financeIconActive,
  },
];

interface OwnerNavigationProps {
  isDisabled?: boolean;
}

// NAV-1 (Mejri 09/09, operator 2026-09-12): while the account is pending, every entry is disabled
// EXCEPT the Dashboard — the owner must always be able to get back to the page that shows the
// status and the « pour bien commencer » block.
export default function OwnerNavigation({ isDisabled = false }: OwnerNavigationProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true); // desktop: true = 272px, false = 80px
  const [_showUserMenu, _setShowUserMenu] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportObjective, setSupportObjective] = useState('');
  const [supportOtherDetail, setSupportOtherDetail] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const { profile } = useBusinessProfile(user?.id);
  const { data: objectiveRows } = useAppointmentObjectives();

  const displayName = profile?.contact_name || user?.email || 'Non connecté';

  // Liste serveur si non vide, sinon repli local.
  const appointmentObjectives = useMemo(
    () =>
      objectiveRows && objectiveRows.length > 0
        ? objectiveRows.map((r) => r.label)
        : APPOINTMENT_OBJECTIVES_FALLBACK,
    [objectiveRows],
  );

  useEffect(() => {
    const handleOpenSupportModal = () => {
      setShowSupportModal(true);
    };

    window.addEventListener('owner-open-support-modal', handleOpenSupportModal);
    return () => {
      window.removeEventListener('owner-open-support-modal', handleOpenSupportModal);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await logout();

      navigate('/login');

      toast.success('Déconnexion réussie');
    } catch (_error) {
      toast.error('Erreur lors de la déconnexion');

      // En cas d'erreur, forcer la redirection
      navigate('/login');
    }
  };

  const isActive = (href: string) => {
    return location.pathname === href;
  };

  return (
    <>
      {/* Mobile menu button */}
      <div className="lg:hidden">
        <button
          type="button"
          className="text-gray-600 hover:text-gray-900 p-2 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {/* Sidebar for mobile - same Figma tokens */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            role="button"
            tabIndex={0}
            onClick={() => setSidebarOpen(false)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                e.preventDefault();
                setSidebarOpen(false);
              }
            }}
          />
          <div className="fixed inset-y-0 left-0 flex w-[272px] flex-col bg-white border-r border-[#E1E4EA] shadow-lg">
            <div className="flex h-[88px] items-center justify-between p-3 border-b border-[#E1E4EA]">
              <div className="flex-1 flex justify-center">
                <img
                  src={logoImage}
                  alt="Logo"
                  className="h-10 w-auto max-w-[178px] object-contain"
                />
              </div>
              <button
                type="button"
                className="text-[#5C5C5C] hover:bg-gray-100 p-2 rounded-lg transition-colors"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 py-5 px-5 gap-2 flex flex-col">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                const iconSrc =
                  'iconSrc' in item ? (item as { iconSrc?: string }).iconSrc : undefined;
                const iconSrcActive =
                  'iconSrcActive' in item
                    ? (item as { iconSrcActive?: string }).iconSrcActive
                    : undefined;
                const imgSrc = iconSrc && (active && iconSrcActive ? iconSrcActive : iconSrc);
                return (
                  <button
                    key={item.name}
                    onClick={() => {
                      navigate(item.href);
                      setSidebarOpen(false);
                    }}
                    disabled={isDisabled && item.href !== '/owner-dashboard'}
                    className={`w-full min-h-9 h-auto flex items-start px-3 py-2 gap-3 rounded-lg text-sm font-medium transition-colors tracking-[-0.006em] ${
                      active
                        ? 'bg-[#E4F9EB] text-[#132B1B]'
                        : isDisabled && item.href !== '/owner-dashboard'
                          ? 'text-[#5C5C5C] opacity-50 cursor-not-allowed'
                          : 'text-[#5C5C5C] hover:bg-gray-100/80'
                    }`}
                  >
                    {imgSrc ? (
                      <img src={imgSrc} alt="" className="h-5 w-5 flex-shrink-0 object-contain" />
                    ) : (
                      <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={1.5} />
                    )}
                    <span className="leading-5 text-left whitespace-normal break-words">
                      {item.name}
                    </span>
                  </button>
                );
              })}
            </nav>
            <div className="flex flex-col flex-none pt-2 pb-2 gap-2 px-3">
              <button
                onClick={() => {
                  navigate('/owner-settings');
                  setSidebarOpen(false);
                }}
                className="h-9 flex items-center w-full px-3 py-2 gap-3 rounded-lg text-sm font-medium transition-colors text-[#5C5C5C] hover:bg-gray-100/80"
              >
                <img
                  src={location.pathname === '/owner-settings' ? paramIconActive : paramIcon}
                  alt=""
                  className="h-5 w-5 flex-shrink-0 object-contain"
                />
                <span className="leading-5 truncate">Paramètres</span>
              </button>
              <button
                onClick={() => {
                  setShowSupportModal(true);
                  setSidebarOpen(false);
                }}
                className="h-9 flex items-center w-full px-3 py-2 gap-3 rounded-lg text-sm font-medium transition-colors text-[#5C5C5C] hover:bg-gray-100/80"
              >
                <img src={supportIcon} alt="" className="h-5 w-5 flex-shrink-0 object-contain" />
                <span className="leading-5 truncate">Support</span>
              </button>
            </div>
            <div className="flex flex-col flex-none border-t border-[#E1E4EA]">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                className="w-full h-12 flex flex-row items-center gap-3 rounded-none text-left px-3 py-3"
              >
                <img
                  src={deconnexionIcon}
                  alt=""
                  className="h-9 w-9 flex-shrink-0 object-contain"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#5C5C5C] leading-5 tracking-[-0.006em] truncate">
                    {displayName}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 flex-shrink-0 text-[#5C5C5C]" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar for desktop - repliable: 272px ouvert / 80px fermé */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <div
          className={`flex min-h-screen flex-col bg-white border-r border-[#E1E4EA] isolate transition-[width] duration-200 ease-in-out overflow-hidden ${
            sidebarExpanded ? 'w-[272px]' : 'w-[80px]'
          }`}
        >
          {/* Header / Logo + bouton toggle */}
          <div className="flex flex-col justify-center items-start p-3 gap-2.5 h-[88px] border-b border-[#E1E4EA] flex-none">
            <div className="flex flex-row items-center w-full gap-2">
              <div
                className={`flex items-center justify-center overflow-hidden transition-all ${sidebarExpanded ? 'flex-1 min-w-0' : 'w-10 h-10 flex-shrink-0'}`}
              >
                {sidebarExpanded ? (
                  <img
                    src={logoImage}
                    alt="Logo"
                    className="h-10 w-auto max-w-[178px] object-contain"
                  />
                ) : (
                  <img
                    src={logoCompany}
                    alt="Logo"
                    className="w-10 h-10 object-contain"
                    title="Toodooh"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => setSidebarExpanded((v) => !v)}
                className="flex-shrink-0 p-2 rounded-lg text-[#5C5C5C] hover:bg-gray-100 transition-colors"
                title={sidebarExpanded ? 'Réduire le menu' : 'Ouvrir le menu'}
              >
                {sidebarExpanded ? (
                  <ChevronLeft className="h-5 w-5" />
                ) : (
                  <ChevronRight className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
          {/* Nav */}
          <nav className="flex flex-col flex-1 py-5 gap-2 px-3">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              const iconSrc =
                'iconSrc' in item ? (item as { iconSrc?: string }).iconSrc : undefined;
              const iconSrcActive =
                'iconSrcActive' in item
                  ? (item as { iconSrcActive?: string }).iconSrcActive
                  : undefined;
              const imgSrc = iconSrc && (active && iconSrcActive ? iconSrcActive : iconSrc);
              return (
                <button
                  key={item.name}
                  onClick={() => navigate(item.href)}
                  disabled={isDisabled && item.href !== '/owner-dashboard'}
                  title={!sidebarExpanded ? item.name : undefined}
                  className={`min-h-9 h-auto flex rounded-lg text-sm font-medium transition-colors tracking-[-0.006em] ${
                    sidebarExpanded
                      ? 'w-full max-w-[232px] px-3 py-2 gap-3 items-start'
                      : 'w-10 justify-center items-center px-0 mx-auto'
                  } ${
                    active
                      ? 'bg-[#E4F9EB] text-[#132B1B]'
                      : isDisabled && item.href !== '/owner-dashboard'
                        ? 'text-[#5C5C5C] opacity-50 cursor-not-allowed'
                        : 'text-[#5C5C5C] hover:bg-gray-100/80'
                  }`}
                >
                  {imgSrc ? (
                    <img src={imgSrc} alt="" className="h-5 w-5 flex-shrink-0 object-contain" />
                  ) : (
                    <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={1.5} />
                  )}
                  {sidebarExpanded && (
                    <span className="leading-5 text-left whitespace-normal break-words">
                      {item.name}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          {/* Paramètres + Support juste au-dessus de déconnexion (identique annonceur) */}
          <div
            className={`flex flex-col flex-none pt-2 pb-2 gap-2 px-3 ${sidebarExpanded ? '' : 'items-center'}`}
          >
            <button
              onClick={() => navigate('/owner-settings')}
              title={!sidebarExpanded ? 'Mes informations' : undefined}
              className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
                sidebarExpanded
                  ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                  : 'w-10 justify-center mx-auto'
              } ${location.pathname === '/owner-settings' ? 'bg-[#E6F7ED] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
            >
              <img
                src={location.pathname === '/owner-settings' ? paramIconActive : paramIcon}
                alt=""
                className="h-5 w-5 flex-shrink-0 object-contain"
              />
              {sidebarExpanded && <span className="leading-5 truncate">Paramètres</span>}
            </button>
            <button
              onClick={() => setShowSupportModal(true)}
              title={!sidebarExpanded ? 'Support' : undefined}
              className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors ${
                sidebarExpanded
                  ? 'w-full max-w-[232px] px-3 py-2 gap-3'
                  : 'w-10 justify-center mx-auto'
              } ${showSupportModal ? 'bg-[#E6F7ED] text-[#132B1B]' : 'text-[#5C5C5C] hover:bg-gray-100/80'}`}
            >
              <img
                src={showSupportModal ? supportIconActive : supportIcon}
                alt=""
                className="h-5 w-5 flex-shrink-0 object-contain"
              />
              {sidebarExpanded && <span className="leading-5 truncate">Support</span>}
            </button>
          </div>
          {/* Bloc utilisateur déconnexion (icône + nom, clic = confirmation) */}
          <div
            className={`flex flex-col flex-none border-t border-[#E1E4EA] ${sidebarExpanded ? '' : 'items-center'}`}
          >
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
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
                      {profile?.contact_name || user?.email?.split('@')[0] || 'Utilisateur'}
                    </p>
                  </div>
                  <ChevronRight
                    className="h-5 w-5 flex-shrink-0 text-[#5C5C5C]"
                    strokeWidth={1.5}
                  />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Modal confirmation déconnexion */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="button"
          tabIndex={0}
          onClick={() => setShowLogoutConfirm(false)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              setShowLogoutConfirm(false);
            }
          }}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl border border-gray-200"
            role="button"
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <p className="text-gray-800 text-center mb-6">Vous allez être déconnecté.</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowLogoutConfirm(false);
                  await handleLogout();
                }}
                className="flex-1 py-2.5 px-4 rounded-xl font-medium text-brand-deep transition-colors hover:opacity-90"
                style={{ background: '#76E6AB' }}
              >
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Support Modal (identique annonceur) */}
      {showSupportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full overflow-hidden">
            <div className="p-4 pb-3 border-b border-dashed border-sky-200">
              <div className="flex justify-between items-start gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 border border-gray-300 flex items-center justify-center p-1.5">
                    <img src={supportIcon} alt="" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-gray-900">Support</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Prendre rendez-vous avec un agent toodooh
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSupportModal(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form
              className="p-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (isAutreObjective(supportObjective) && !supportOtherDetail.trim()) {
                  toast.error('Veuillez préciser dans la description');
                  return;
                }
                toast.success('Message envoyé');
                setShowSupportModal(false);
                setSupportObjective('');
                setSupportOtherDetail('');
                setSupportMessage('');
              }}
            >
              <div>
                <label
                  className="block text-sm font-bold text-gray-900 mb-1.5"
                  htmlFor="support-objective"
                >
                  Choisissez vos objectifs *
                </label>
                <select
                  value={supportObjective}
                  onChange={(e) => setSupportObjective(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '1.25rem',
                    paddingRight: '2.5rem',
                  }}
                  id="support-objective"
                >
                  <option value="">Choisissez vos objectifs</option>
                  {appointmentObjectives.map((obj) => (
                    <option key={obj} value={obj}>
                      {obj}
                    </option>
                  ))}
                </select>
              </div>
              {isAutreObjective(supportObjective) && (
                <div>
                  <label
                    className="block text-sm font-bold text-gray-900 mb-1.5"
                    htmlFor="support-other-detail"
                  >
                    Précision *
                  </label>
                  <input
                    type="text"
                    value={supportOtherDetail}
                    onChange={(e) => setSupportOtherDetail(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                    placeholder="Veuillez préciser dans la description"
                    id="support-other-detail"
                  />
                </div>
              )}
              <div>
                <label
                  className="block text-sm font-bold text-gray-900 mb-1.5"
                  htmlFor="support-message"
                >
                  Commentaire additionnels
                </label>
                <textarea
                  rows={3}
                  value={supportMessage}
                  onChange={(e) => setSupportMessage(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary resize-none"
                  placeholder="Votre Message ici.."
                  id="support-message"
                />
              </div>
              <div className="pt-1 border-t border-dashed border-sky-200 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowSupportModal(false)}
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-900 border border-gray-300 bg-white hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl font-medium text-black transition-opacity hover:opacity-90"
                  style={{ background: '#76E6AB' }}
                >
                  Envoyer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
