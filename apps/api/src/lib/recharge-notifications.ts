import { inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import { type NewNotification, type Recharge, users } from '../db/schema.js';

// FCT1 — the recharge parcours' notification copy, ONE home (US-FCT-10: EVERY status change
// notifies the screencaster in French). PURE builders returning insert values — the routes insert
// them inline (the house idiom: producers write db.insert(notifications).values(...) themselves,
// copy hoisted to module constants). `type` stays free-text per the notifications table charter;
// the advertiser bell renders unknown types plainly, so no FE change is REQUIRED for these to land.
//
// Admin-side: virement creation and signed-bon deposit are admin-ACTIONABLE, so they fan out one
// row per admin/superadmin (the notifications table has no role broadcast — user_id NOT NULL — and
// the owner-dedupe fan-out is the established shape). NOTE the admin bell surface is decorative
// today (AdminLayout renders a dead <Bell/>): the rows land and are readable via
// GET /api/notifications, awaiting a live admin bell. Bon ISSUANCE fans out nothing — « Bon émis »
// is screencaster-only by charter.

export type RechargeAdvertiserEvent =
  | 'virement_created'
  | 'bon_issued'
  | 'bon_returned'
  | 'credited'
  | 'funds_received'
  | 'cancelled';

export type RechargeAdminEvent = 'virement_created' | 'bon_returned';

const amountLine = (row: Pick<Recharge, 'amountTnd'>): string =>
  `${Number(row.amountTnd).toFixed(2)} TND`;

// The advertiser-facing copy per transition — per-method French, mirroring the web status labels.
const ADVERTISER_COPY: Record<
  RechargeAdvertiserEvent,
  (row: Pick<Recharge, 'reference' | 'amountTnd' | 'rejectReason'>) => {
    title: string;
    body: string;
  }
> = {
  virement_created: (row) => ({
    title: 'Demande de recharge enregistrée',
    body: `Votre demande ${row.reference} de ${amountLine(row)} est en attente de réception du virement.`,
  }),
  // US-FCT-6 — the sign invite, PERSISTED in notifications (the popup is ephemeral, this is not).
  bon_issued: (row) => ({
    title: 'Votre bon de commande est prêt',
    body: `Votre bon de commande ${row.reference} (${amountLine(row)}) est prêt : téléchargez-le, imprimez-le, signez-le puis redéposez-le sur votre espace.`,
  }),
  bon_returned: (row) => ({
    title: 'Bon signé bien reçu',
    body: `Votre bon signé ${row.reference} a bien été déposé. Les fonds seront crédités à réception.`,
  }),
  credited: (row) => ({
    title: 'Recharge créditée',
    body: `Votre recharge ${row.reference} de ${amountLine(row)} a été créditée sur votre solde.`,
  }),
  funds_received: (row) => ({
    title: 'Fonds reçus',
    body: `Les fonds du bon ${row.reference} ont été reçus : ${amountLine(row)} crédités sur votre solde.`,
  }),
  cancelled: (row) => ({
    title: 'Demande de recharge annulée',
    body:
      row.rejectReason === null
        ? `Votre demande ${row.reference} a été annulée.`
        : `Votre demande ${row.reference} a été annulée. Raison : ${row.rejectReason}`,
  }),
};

const ADMIN_COPY: Record<
  RechargeAdminEvent,
  (row: Pick<Recharge, 'reference' | 'amountTnd'>) => { title: string; body: string }
> = {
  virement_created: (row) => ({
    title: 'Nouvelle demande de recharge par virement',
    body: `La demande ${row.reference} (${amountLine(row)}) attend la vérification du virement.`,
  }),
  bon_returned: (row) => ({
    title: 'Bon de commande signé déposé',
    body: `Le bon signé ${row.reference} (${amountLine(row)}) attend la validation.`,
  }),
};

/** The screencaster's row for one transition — insert value for tx.insert(notifications). */
export const advertiserRechargeNotification = (
  event: RechargeAdvertiserEvent,
  row: Pick<Recharge, 'advertiserId' | 'reference' | 'amountTnd' | 'rejectReason'>,
): NewNotification => ({
  userId: row.advertiserId,
  type: `recharge_${event}`,
  ...ADVERTISER_COPY[event](row),
});

/** The per-admin fan-out rows for an actionable transition (empty when no admin exists). */
export const adminRechargeNotifications = (
  event: RechargeAdminEvent,
  row: Pick<Recharge, 'reference' | 'amountTnd'>,
  adminIds: readonly string[],
): NewNotification[] =>
  adminIds.map((adminId) => ({
    userId: adminId,
    type: 'recharge_action_required',
    ...ADMIN_COPY[event](row),
  }));

/** Every admin/superadmin id — the fan-out recipient list (require-auth's ADMIN_ROLES set). */
export const listAdminIds = async (): Promise<string[]> => {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.role, ['admin', 'superadmin']));
  return rows.map((r) => r.id);
};
