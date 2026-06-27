import { requireRole } from './require-auth.js';

// Advertiser-only role gate. Composes AFTER requireAuth (which attaches request.user):
// { preHandler: [requireAuth, requireAdvertiser] }. An authenticated non-advertiser gets 403
// (mirrors requireAdmin). The campaign draft lifecycle is advertiser-owned, so every campaigns
// route sits behind this gate.
export const requireAdvertiser = requireRole('advertiser');
