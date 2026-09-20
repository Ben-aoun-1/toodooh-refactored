import type { CreativeView } from '@/features/campaigns/services/creatives.api';

// The admin moderation view of a creative (L-spot CONTENT gate). It is the advertiser projection
// (CreativeView, the snake_case shape of lib/creatives.ts `creativeView`) PLUS the owning advertiser
// id and the moderating admin id — mirroring the server's `adminCreativeView`
// (apps/api routes/admin-creatives.ts): `{ ...creativeView(row), advertiser_id, validated_by }`.
// Wire-exact (snake_case, nullable where the column is nullable); the page null-guards, it does not
// coalesce in the service.
export interface AdminCreativeView extends CreativeView {
  advertiser_id: string;
  /**
   * ADM-FIX1 — the advertiser's NAME (api lib/user-label: business_name, else contact_name). The
   * moderation queue and the examen modal show this; the uuid stays as a muted support line.
   */
  advertiser_label: string;
  validated_by: string | null;
}

// The three moderation states the backend list endpoint accepts as a `?status=` filter. There is no
// 'all' value — the server returns every creative when the param is omitted.
export type CreativeStatusFilter = 'pending' | 'approved' | 'rejected';
