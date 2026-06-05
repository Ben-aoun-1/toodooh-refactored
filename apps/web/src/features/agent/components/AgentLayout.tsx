import { Building2, LogOut, Menu, X } from 'lucide-react';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/stores/auth.store';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'AgentLayout' });

interface AgentLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

// Slice-2 E — the screenhost-agent workspace shell. TOODOOH-branded header + sidebar mirroring
// AdminLayout's structure/tokens (brand-primary/brand-deep, font-poppins, rounded-xl), trimmed to the
// single agent surface (Établissements). Logout returns to /login (agents use the public sign-in).
export default function AgentLayout({ children, title, subtitle }: AgentLayoutProps) {
  const contactName = useAuthStore((s) => s.contactName);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      log.error({ error }, 'Logout error');
    }
  };

  return (
    <div className="min-h-screen bg-white font-poppins text-[#171717]">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                aria-label="Ouvrir le menu"
              >
                <Menu className="h-6 w-6" />
              </button>
              <div className="ml-4 lg:ml-0">
                <h1 className="text-xl font-semibold text-[#171717]">{title}</h1>
                {subtitle && <p className="text-sm font-normal text-[#5C5C5C]">{subtitle}</p>}
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{contactName}</p>
                <p className="text-xs text-gray-500">Agent ScreenHost</p>
              </div>
              <div className="h-8 w-8 bg-brand-primary rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">{contactName?.charAt(0)}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <div
          className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
              <span className="text-lg font-semibold text-brand-deep">TOODOOH</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                aria-label="Fermer le menu"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <nav className="mt-8 px-4 space-y-2 flex-1">
              <span className="group flex items-center w-full px-4 py-3 text-sm font-medium rounded-xl bg-brand-primary text-brand-deep shadow-lg shadow-brand-primary/25">
                <Building2 className="mr-3 h-5 w-5" />
                Établissements
              </span>
            </nav>

            <div className="p-4 border-t border-gray-200">
              <div className="flex items-center space-x-3 p-3 rounded-lg bg-gray-50">
                <div className="h-10 w-10 bg-brand-primary rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{contactName?.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{contactName}</p>
                  <p className="text-xs text-gray-500 truncate">Agent ScreenHost</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Déconnexion"
                  aria-label="Déconnexion"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 lg:ml-0">
          <main className="p-6 text-[15px] leading-6">
            <div className="max-w-7xl mx-auto">{children}</div>
          </main>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-600 bg-opacity-75 lg:hidden"
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
          aria-label="Fermer le menu"
        />
      )}
    </div>
  );
}
