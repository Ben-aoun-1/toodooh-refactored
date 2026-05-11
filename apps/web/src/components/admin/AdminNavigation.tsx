import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '../../stores/admin.store';
import {
  BarChart3,
  Users,
  Monitor,
  Activity,
  CheckCircle,
  Settings,
  LogOut,
  Bell,
  MenuIcon,
  X,
  MapPin,
} from 'lucide-react';

interface AdminNavigationProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export default function AdminNavigation({ children, title, subtitle }: AdminNavigationProps) {
  const navigate = useNavigate();
  const { admin, logout } = useAdminStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/admin-login');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'superadmin':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'admin':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'moderator':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'superadmin':
        return 'Super Administrateur';
      case 'admin':
        return 'Administrateur';
      case 'moderator':
        return 'Modérateur';
      default:
        return role;
    }
  };

  const navigationItems = [
    {
      name: 'Dashboard',
      href: '/admin-dashboard',
      icon: BarChart3,
      roles: ['superadmin', 'admin', 'moderator'],
    },
    {
      name: 'Gestion des utilisateurs',
      href: '/admin-users',
      icon: Users,
      roles: ['superadmin', 'admin'],
    },
    {
      name: 'Gestion des écrans',
      href: '/admin-screens',
      icon: Monitor,
      roles: ['superadmin', 'admin', 'moderator'],
    },
    {
      name: 'Gestion des campagnes',
      href: '/admin-campaigns',
      icon: Activity,
      roles: ['superadmin', 'admin', 'moderator'],
    },
    {
      name: 'Zones géographiques',
      href: '/admin-zones',
      icon: MapPin,
      roles: ['superadmin', 'admin'],
    },
    {
      name: 'Vérifications',
      href: '/admin-verifications',
      icon: CheckCircle,
      roles: ['superadmin', 'admin'],
    },
    {
      name: 'Administrateurs',
      href: '/admin-admins',
      icon: Settings,
      roles: ['superadmin'],
    },
    // Masqué : Rapports
    // {
    //   name: 'Rapports',
    //   href: '/admin-reports',
    //   icon: BarChart3,
    //   roles: ['superadmin', 'admin']
    // }
  ];

  const filteredNavigationItems = navigationItems.filter(
    (item) => admin && item.roles.includes(admin.role),
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        {/* Sidebar */}
        <aside
          className={`
          ${isMenuOpen ? 'block' : 'hidden'} 
          lg:block fixed lg:relative inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 shadow-lg flex flex-col
        `}
        >
          {/* Logo */}
          <div className="flex items-center justify-center h-16 px-4 border-b border-gray-200">
            <h1 className="text-xl font-bold text-[#00B3A6]">Admin Panel</h1>
          </div>

          {/* Navigation */}
          <nav className="mt-8 px-4 space-y-2 flex-1">
            {filteredNavigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.href;

              return (
                <button
                  key={item.name}
                  onClick={() => navigate(item.href)}
                  className={`group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-[#00B3A6] text-white shadow-lg shadow-[#00B3A6]/25'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-[#00B3A6]'
                  }`}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  {item.name}
                </button>
              );
            })}
          </nav>

          {/* Admin Profile */}
          <div className="border-t border-gray-200 p-4 mt-auto mb-4">
            <div className="flex items-center mb-3">
              <div className="flex-shrink-0">
                <div className="h-8 w-8 bg-[#00B3A6] rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {admin?.first_name?.[0]}
                    {admin?.last_name?.[0]}
                  </span>
                </div>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-900">
                  {admin?.first_name} {admin?.last_name}
                </p>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium border ${getRoleColor(admin?.role || '')}`}
                >
                  {getRoleLabel(admin?.role || '')}
                </span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors"
            >
              <LogOut className="mr-3 h-4 w-4" />
              Déconnexion
            </button>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center space-x-4">
                  <button
                    className="lg:hidden mr-4 p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                  >
                    {isMenuOpen ? <X size={20} /> : <MenuIcon size={20} />}
                  </button>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                    {subtitle && <p className="text-sm text-gray-600 mt-1">{subtitle}</p>}
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative text-gray-600">
                    <Bell className="h-6 w-6" />
                    <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                      3
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          {/* Main content area */}
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
