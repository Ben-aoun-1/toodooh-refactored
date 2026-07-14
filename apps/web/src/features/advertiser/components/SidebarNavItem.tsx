import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import { consultNavigationGuard } from '@/features/campaigns/lib/navigation-guard';

interface SidebarNavItemProps {
  path: string;
  label: string;
  /** Active-state icon (asset image) */
  activeIcon: string;
  /** Inactive-state icon (asset image) */
  inactiveIcon: string;
  expanded: boolean;
  /** If true, click shows toast instead of navigating */
  disabled?: boolean;
  /** Toast message when disabled and clicked */
  disabledMessage?: string;
  onNavigate?: () => void;
}

export default function SidebarNavItem({
  path,
  label,
  activeIcon,
  inactiveIcon,
  expanded,
  disabled = false,
  disabledMessage = '⚠️ Veuillez compléter vos informations pour accéder à cette fonctionnalité',
  onNavigate,
}: SidebarNavItemProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === path;

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) {
          toast.error(disabledMessage);
          return;
        }
        // CF-W1 (§1.9) — the campaign wizard may hold unsaved work: its guard takes over the
        // exit (confirm popup) and navigates itself; everywhere else this is a pass-through.
        if (!consultNavigationGuard(path)) return;
        navigate(path);
        onNavigate?.();
      }}
      disabled={disabled}
      title={!expanded ? label : undefined}
      className={`h-9 flex items-center rounded-lg text-sm font-medium transition-colors tracking-[-0.006em] ${
        expanded ? 'w-full max-w-[232px] px-3 py-2 gap-3' : 'w-10 justify-center px-0 mx-auto'
      } ${
        disabled
          ? 'text-[#5C5C5C] opacity-50 cursor-not-allowed'
          : isActive
            ? 'bg-[#E4F9EB] text-[#132B1B]'
            : 'text-[#5C5C5C] hover:bg-gray-100/80'
      }`}
    >
      <img
        src={isActive ? activeIcon : inactiveIcon}
        alt=""
        className="h-5 w-5 flex-shrink-0 object-contain"
      />
      {expanded && <span className="leading-5 truncate">{label}</span>}
    </button>
  );
}
