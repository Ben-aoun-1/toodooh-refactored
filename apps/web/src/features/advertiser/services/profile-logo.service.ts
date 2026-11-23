import { apiClient } from '@/lib/api-client';

// The Screencaster's own logo (apps/api routes/logos.ts — GET/POST /api/profile/logo). His own
// upload is validated at once; the read returns the validated logo, or null.

export interface ProfileLogo {
  url: string;
  status: 'valide' | 'en_attente';
}

export const profileLogoService = {
  get(): Promise<{ logo: ProfileLogo | null }> {
    return apiClient.get<{ logo: ProfileLogo | null }>('/profile/logo');
  },
  /** Multipart field `file` — PNG or JPEG, 400 × 400 px minimum, 5 MB maximum. */
  upload(file: File): Promise<{ url: string | null; status: ProfileLogo['status'] }> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm('/profile/logo', form);
  },
};
