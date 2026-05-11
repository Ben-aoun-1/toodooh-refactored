import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem {
  campaignId: string;
  name: string;
  budget: number;
  videoThumbnail?: string;
  videoUrl?: string;
  startDate?: string;
  endDate?: string;
  addedAt: string;
}

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (campaignId: string) => void;
  clearCart: () => void;
  getSubtotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) =>
        set((state) => {
          if (state.items.some((i) => i.campaignId === item.campaignId)) return state;
          return { items: [...state.items, item] };
        }),

      removeItem: (campaignId) =>
        set((state) => ({
          items: state.items.filter((i) => i.campaignId !== campaignId),
        })),

      clearCart: () => set({ items: [] }),

      getSubtotal: () =>
        get().items.reduce((sum, i) => sum + (i.budget || 0), 0),
    }),
    {
      name: 'toodooh-cart',
    }
  )
);
