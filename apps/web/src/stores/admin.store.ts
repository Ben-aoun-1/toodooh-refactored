import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { adminService } from '../services/admin.service';
import { AdminProfile } from '../types/admin';
import { supabase } from '../lib/supabase';

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
          console.log('🔄 Admin store: Starting initialization...');
          set({ loading: true });

          // Vérifier la session actuelle d'abord
          console.log('🔄 Admin store: Getting current admin...');
          const admin = await adminService.getCurrentAdmin();
          console.log('✅ Admin store: Current admin:', admin);

          set({ admin, initialized: true, loading: false });
          console.log('✅ Admin store: Initialization complete');
        } catch (error) {
          console.error('❌ Admin store: Error initializing:', error);
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
          console.error('Error during logout:', error);
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
