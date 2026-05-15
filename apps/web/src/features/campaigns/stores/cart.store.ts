import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface CartItem {
  id: string;
  name: string;
  amount: number;
  periodLabel?: string;
  zonesLabel?: string;
}

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  setItems: (items: CartItem[]) => void;
  getSubtotal: () => number;
  getCount: () => number;
}

const STORE_KEY = 'toodooh-cart-v2';
const LEGACY_KEY = 'campaign_cart_items';

function readLegacyItems(): CartItem[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CartItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.amount === 'number',
    );
  } catch {
    return [];
  }
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) =>
        set((state) => {
          if (state.items.some((i) => i.id === item.id)) {
            return { items: state.items.map((i) => (i.id === item.id ? item : i)) };
          }
          return { items: [...state.items, item] };
        }),
      removeItem: (id) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
      clearCart: () => set({ items: [] }),
      setItems: (items) => set({ items }),
      getSubtotal: () => get().items.reduce((sum, i) => sum + (i.amount || 0), 0),
      getCount: () => get().items.length,
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.items.length === 0) {
          const legacy = readLegacyItems();
          if (legacy.length > 0) {
            state.items = legacy;
          }
        }
        try {
          localStorage.removeItem(LEGACY_KEY);
        } catch {
          /* best-effort */
        }
      },
    },
  ),
);
