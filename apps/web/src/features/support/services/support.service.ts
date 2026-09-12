import type { SupportPayload } from '@/features/support/lib/support-form';
import { apiClient } from '@/lib/api-client';

// SUP-1 — POST /api/support (any authenticated role). The 201 is the only « envoyé ».
export const supportService = {
  send(payload: SupportPayload): Promise<{ id: string; kind: string; status: string }> {
    return apiClient.post('/support', payload);
  },
};
