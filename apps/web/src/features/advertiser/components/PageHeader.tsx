import { ChevronRight, LayoutGrid, PanelLeft, ShoppingBag, Users } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import headerAgendaIcon from '@/assets/header/agenda.png';
import headerCampagnesIcon from '@/assets/header/campagnes.png';
import headerFinanceIcon from '@/assets/header/finance.png';
import headerParamsIcon from '@/assets/header/params.png';

import AdvertiserNotificationsBell from './AdvertiserNotificationsBell';

interface PageHeaderProps {
  onMobileMenuClick: () => void;
  onContactClick: () => void;
  onCartToggle: () => void;
  cartCount: number;
  userId?: string;
  userName?: string;
}

/** Pages where the right-side action buttons use the emphasized variant. */
const EMPHASIZED_PATHS = ['/my-campaigns', '/evenements'];

export default function PageHeader({
  onMobileMenuClick,
  onContactClick,
  onCartToggle,
  cartCount,
  userId,
  userName,
}: PageHeaderProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const emphasized = EMPHASIZED_PATHS.includes(pathname);

  return (
    <header className="flex-none h-16 bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="h-full w-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 flex-nowrap">
        <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
          <button
            className="md:hidden p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-500 flex-shrink-0"
            onClick={onMobileMenuClick}
            aria-label="Menu"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
          {pathname === '/my-campaigns' ? (
            <>
              <img src={headerCampagnesIcon} alt="" className="h-12 w-12 flex-shrink-0 object-contain" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">Mes campagnes</h1>
                <p className="text-xs text-gray-500 truncate hidden sm:block">Gérez vos campagnes actives</p>
              </div>
            </>
          ) : pathname === '/evenements' ? (
            <>
              <img src={headerAgendaIcon} alt="" className="h-12 w-12 flex-shrink-0 object-contain" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">Événements</h1>
                <p className="text-xs text-gray-500 truncate hidden sm:block">
                  Profitez des pics d&apos;audience des événements pour amplifier votre impact
                </p>
              </div>
            </>
          ) : pathname === '/my-recharges' ? (
            <>
              <img src={headerFinanceIcon} alt="" className="h-12 w-12 flex-shrink-0 object-contain" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">Mes Finances</h1>
                <p className="text-xs text-gray-500 truncate hidden sm:block">
                  Gérez votre solde et consultez l&apos;historique de vos transactions
                </p>
              </div>
            </>
          ) : pathname === '/my-invoices' ? (
            <>
              <img src={headerFinanceIcon} alt="" className="h-12 w-12 flex-shrink-0 object-contain" />
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-base sm:text-lg font-bold text-gray-400 truncate">Mes Finances</span>
                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">Mes factures</h1>
              </div>
            </>
          ) : pathname === '/profile' ? (
            <>
              <img src={headerParamsIcon} alt="" className="h-12 w-12 flex-shrink-0 object-contain" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">Paramètres</h1>
                <p className="text-xs text-gray-500 truncate hidden sm:block">
                  Gérez vos préférences et configurez différentes options.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="hidden md:flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500"
                  aria-label="Vue grille"
                >
                  <LayoutGrid className="h-5 w-5" />
                </button>
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                  Bonjour, {userName || 'Utilisateur'}
                </h1>
                <p className="text-xs text-gray-500 truncate hidden sm:block">
                  Gérez vos campagnes et suivez vos performances en temps réel
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium text-sm whitespace-nowrap ${
              emphasized
                ? 'bg-[#76E6AB] hover:opacity-90 text-gray-900'
                : 'bg-[#9ae2b0] hover:bg-[#85d99e] text-gray-900'
            }`}
            onClick={onContactClick}
          >
            <Users className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Prendre rendez-vous</span>
          </button>
          <AdvertiserNotificationsBell userId={userId} emphasized={emphasized} />
          <button
            type="button"
            onClick={onCartToggle}
            className={`flex items-center gap-1.5 px-2.5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap ${
              emphasized
                ? 'bg-white border border-gray-200 hover:bg-gray-50 text-gray-700'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            <ShoppingBag className="h-5 w-5 flex-shrink-0" />
            <span className="hidden md:inline">Mon panier</span>
            <span className="text-red-500 font-semibold">{cartCount}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
