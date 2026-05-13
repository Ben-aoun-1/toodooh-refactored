import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { adminService } from '../services/admin.service';
import { AdminProfile } from '../types/admin';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'admin.store' });


interface AdminState {
  admin: AdminProfile | null;
  loading: boolean;
  initialized: boolean;

  // Actions
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setAdmin: (admin: AdminProfile | null) => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      admin: null,
      loading: false,
      initialized: false,

      initialize: async () => {
        try {
          set({ loading: true });

          // Vérifier la session actuelle d'abord
          const admin = await adminService.getCurrentAdmin();

          set({ admin, initialized: true, loading: false });
        } catch (error) {
          log.error({ error }, '❌ Admin store: Error initializing');
          set({ admin: null, initialized: true, loading: false });
        }
      },

      login: async (email: string, password: string) => {
        try {
          set({ loading: true });
          const admin = await adminService.login(email, password);
          set({ admin, loading: false });
        } catch (error: any) {
          set({ loading: false });
          throw error;
        }
      },

      logout: async () => {
        try {
          set({ loading: true });
          await adminService.logout();
          set({ admin: null, loading: false });
        } catch (error) {
          log.error({ error }, 'Error during logout');
          set({ loading: false });
        }
      },

      setAdmin: (admin: AdminProfile | null) => {
        set({ admin });
      },
    }),
    {
      name: 'admin-storage',
      partialize: (state) => ({
        admin: state.admin,
        initialized: state.admin ? state.initialized : false,
      }),
    },
  ),
);
