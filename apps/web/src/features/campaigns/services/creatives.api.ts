import { apiClient } from '@/lib/api-client';

// The advertiser creative library (L-spot) over REST — POST (multipart) /api/creatives + GET
// /mine + /:id + /:id/url, replacing the legacy Supabase `videos` upload for the wizard's Creative
// step. snake_case wire shapes mirror lib/creatives.ts creativeView exactly. Scalars (type /
// duration_seconds / title) ride the querystring; the multipart body is file-only (the route is
// configured fields:0), so the FormData carries ONLY the file.

export type CreativeType = 'video' | 'photo';

export interface CreativeView {
  id: string;
  creative_type: CreativeType;
  title: string | null;
  duration_seconds: number | null;
  validation_status: string;
  validation_notes: string | null;
  validated_at: string | null;
  original_filename: string | null;
  /** Nullable — backfilled prod rows don't know their mime (db comment); guard before .startsWith. */
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface UploadCreativeInput {
  file: File;
  type: CreativeType;
  /** Diffusion seconds — video 1..30; photo ∈ {10,20,30}. Validated server-side. */
  duration_seconds: number;
  title?: string;
}

export const creativesApi = {
  upload(input: UploadCreativeInput): Promise<CreativeView> {
    const params = new URLSearchParams({
      type: input.type,
      duration_seconds: String(input.duration_seconds),
    });
    if (input.title && input.title.trim()) params.set('title', input.title.trim());
    const form = new FormData();
    form.append('file', input.file);
    return apiClient.postForm<CreativeView>(`/creatives?${params.toString()}`, form);
  },
  mine(): Promise<CreativeView[]> {
    return apiClient.get<CreativeView[]>('/creatives/mine');
  },
  get(id: string): Promise<CreativeView> {
    return apiClient.get<CreativeView>(`/creatives/${id}`);
  },
  /** Presign the object on demand (owner-scoped) for preview. */
  presignedUrl(id: string): Promise<{ url: string }> {
    return apiClient.get<{ url: string }>(`/creatives/${id}/url`);
  },
};
