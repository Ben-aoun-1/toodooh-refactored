import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { authService } from '@/features/auth/services/auth.service';
import type { SessionUser } from '@/features/auth/types/auth';

// Mock the wire layer — the store only calls login/logout/getCurrentUser (hoisted by vitest).
vi.mock('@/features/auth/services/auth.service', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), getCurrentUser: vi.fn() },
}));

// In-memory localStorage so zustand `persist` initializes in the node env (no jsdom, D10).
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

// Imported dynamically AFTER the localStorage stub so persist init is safe.
let useAuthStore: (typeof import('./auth.store'))['useAuthStore'];

const approved: SessionUser = {
  id: 'u1',
  email: 'a@b.c',
  role: 'advertiser',
  status: 'approved',
  validation_notes: null,
  rejection_topics: null,
  onboarding_completed: true,
  business_type: null,
  profile_type: 'advertiser',
  contact_name: 'Alice',
  agent_code: null,
};
const pendingOwner: SessionUser = {
  id: 'u2',
  email: 'o@b.c',
  role: 'individual_owner',
  status: 'pending',
  validation_notes: null,
  rejection_topics: null,
  onboarding_completed: false,
  business_type: null,
  profile_type: 'individual_owner',
  contact_name: 'Omar',
  agent_code: null,
};
const rejected: SessionUser = {
  id: 'u3',
  email: 'r@b.c',
  role: 'advertiser',
  status: 'rejected',
  validation_notes: 'Documents illisibles, merci de renvoyer.',
  rejection_topics: ['legal', 'bank'],
  onboarding_completed: false,
  business_type: null,
  profile_type: 'advertiser',
  contact_name: 'Rania',
  agent_code: null,
};
// R5 — an agent session carries its own issued code (agents.code), threaded into the store.
const agentSession: SessionUser = {
  id: 'u4',
  email: 'agent@b.c',
  role: 'screenhost_agent',
  status: 'approved',
  validation_notes: null,
  rejection_topics: null,
  onboarding_completed: true,
  business_type: null,
  profile_type: null,
  contact_name: 'Sami',
  agent_code: 'SH123456',
};

beforeAll(async () => {
  vi.stubGlobal('localStorage', memoryStorage());
  ({ useAuthStore } = await import('./auth.store'));
});

beforeEach(() => {
  vi.mocked(authService.login).mockReset();
  vi.mocked(authService.logout).mockReset();
  vi.mocked(authService.getCurrentUser).mockReset();
  useAuthStore.setState({
    user: null,
    loading: false,
    initialized: false,
    rehydrateError: false,
    profileType: null,
    contactName: null,
    onboardingCompleted: false,
    shouldOnboard: false,
    needsApproval: false,
    validationStatus: undefined,
  });
});

describe('auth.store — rehydration (initialize → /api/me)', () => {
  it('200 (approved) → logged-in with the mapped routing fields', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(approved);
    await useAuthStore.getState().initialize();
    const s = useAuthStore.getState();
    expect(s.user).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(s.profileType).toBe('advertiser');
    expect(s.contactName).toBe('Alice');
    expect(s.validationStatus).toBe('approved');
    expect(s.needsApproval).toBe(false);
    expect(s.initialized).toBe(true);
    expect(s.rehydrateError).toBe(false);
  });

  it('200 (agent) → the agent code is threaded into the store (R5)', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(agentSession);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().agentCode).toBe('SH123456');
  });

  it('200 (non-agent) → agentCode is null', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(approved);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().agentCode).toBeNull();
  });

  it('200 (pending owner) → needsApproval true (status-derived, D5)', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(pendingOwner);
    await useAuthStore.getState().initialize();
    const s = useAuthStore.getState();
    expect(s.profileType).toBe('individual_owner');
    expect(s.validationStatus).toBe('pending');
    expect(s.needsApproval).toBe(true);
  });

  it('200 (rejected) → needsApproval true + the rejection reason mapped to the store (N3)', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(rejected);
    await useAuthStore.getState().initialize();
    const s = useAuthStore.getState();
    expect(s.validationStatus).toBe('rejected');
    expect(s.needsApproval).toBe(true);
    expect(s.validationNotes).toBe('Documents illisibles, merci de renvoyer.');
    expect(s.rejectionTopics).toEqual(['legal', 'bank']);
  });

  it('401 (null) → logged-out, initialized, no error', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue(null);
    await useAuthStore.getState().initialize();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.initialized).toBe(true);
    expect(s.rehydrateError).toBe(false);
  });

  it('non-401 (throw) → auth fails closed (user null) + cushion retained + retry state (D3)', async () => {
    // Seed the persisted cushion (a previously-known approved user).
    useAuthStore.setState({
      profileType: 'advertiser',
      validationStatus: 'approved',
      contactName: 'Alice',
    });
    vi.mocked(authService.getCurrentUser).mockRejectedValue(new Error('network'));
    await useAuthStore.getState().initialize();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull(); // auth fails closed
    expect(s.rehydrateError).toBe(true); // retry-able
    expect(s.initialized).toBe(true);
    expect(s.profileType).toBe('advertiser'); // cushion retained (paint)
    expect(s.validationStatus).toBe('approved');
  });
});

describe('auth.store — transitions', () => {
  it('login 200 → populates routing from the signin response', async () => {
    vi.mocked(authService.login).mockResolvedValue(approved);
    await useAuthStore.getState().login('a@b.c', 'pw');
    const s = useAuthStore.getState();
    expect(s.user).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(s.profileType).toBe('advertiser');
    expect(s.loading).toBe(false);
  });

  it('login failure → logged-out and rethrows', async () => {
    vi.mocked(authService.login).mockRejectedValue(new Error('Email ou mot de passe incorrect.'));
    await expect(useAuthStore.getState().login('a@b.c', 'bad')).rejects.toThrow('incorrect');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('logout → clears identity (server ok)', async () => {
    useAuthStore.setState({ user: { id: 'u1', email: 'a@b.c' }, profileType: 'advertiser' });
    vi.mocked(authService.logout).mockResolvedValue(undefined);
    await useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.profileType).toBeNull();
    expect(authService.logout).toHaveBeenCalledTimes(1);
  });

  it('logout → clears locally even when the server signout fails', async () => {
    useAuthStore.setState({ user: { id: 'u1', email: 'a@b.c' } });
    vi.mocked(authService.logout).mockRejectedValue(new Error('signout failed'));
    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('clearSession → wipes identity without a server call (the mid-session 401 handler, D6)', () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@b.c' },
      profileType: 'advertiser',
      validationStatus: 'approved',
    });
    useAuthStore.getState().clearSession();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.profileType).toBeNull();
    expect(s.validationStatus).toBeUndefined();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('refreshUserStatus is a no-op when logged out', async () => {
    useAuthStore.setState({ user: null });
    await useAuthStore.getState().refreshUserStatus();
    expect(authService.getCurrentUser).not.toHaveBeenCalled();
  });
});
