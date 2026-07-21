import { and, eq, isNotNull, isNull, lt, lte, notExists } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaigns, cartItems, notifications } from '../db/schema.js';

import { plusCalendarDays, tunisDateOf } from './campaign-dates.js';

// CF-S1 (spec §3.1/3.2) — the stored-status lifecycle: admin approval routes a future-dated
// campaign to 'upcoming'; this job flips upcoming→active when the window opens and
// active→completed when it closes. Set-based single UPDATEs, idempotent by construction (a
// re-run matches zero rows), Tunis calendar dates like the rest of the campaign date rules.

/**
 * Settlement seam — deliberately a NO-OP: the reconcile/payout auto-trigger at completion is
 * BANKED pending an operator ruling (money-adjacent). The lifecycle job calls it per completed
 * campaign so the wiring point exists and is tested; nothing happens here yet.
 */
export function onCampaignCompleted(campaignId: string): void {
  void campaignId; // intentionally unused — see the seam note above
}

// CF-S1 Commit 2 — the J-3 draft reminder (spec §3.2), folded into this tick (one clock, one
// job). Spec copy with the cart CTA ADAPTED to the current flow (« soumettez-la » — the cart
// does not exist yet; the cart lane restores « ajoutez-la au panier »).
// CF-S2 — the copy now WARNS about the auto-deletion (spec §1.14, reinstated by operator-accepted
// veto): a draft that sails past its start date is deleted by this same tick.
export const DRAFT_REMINDER_TITLE = 'Votre campagne démarre bientôt';
// CF-C1 — the cart exists now: the J-3 copy speaks the panier language again (spec §3.2).
export const draftReminderBody = (name: string): string =>
  `Votre campagne ${name} doit commencer dans 3 jours. Terminez le processus et ajoutez-la au panier pour la lancer — sans quoi elle sera supprimée automatiquement à sa date de début.`;

export interface LifecycleTickResult {
  activated: number;
  completed: number;
  reminded: number;
  deleted: number;
}

/** One transition pass. Order matters: an over-slept 'upcoming' whose whole window already
 * passed flips to 'active' first, then the completion pass catches it in the SAME tick. */
export async function runCampaignLifecycleTick(
  log: FastifyBaseLogger,
  now: Date = new Date(),
  // Injectable so tests can observe the seam (ESM local bindings defeat namespace spies).
  onCompleted: (campaignId: string) => void = onCampaignCompleted,
): Promise<LifecycleTickResult> {
  const today = tunisDateOf(now);

  const activated = await db
    .update(campaigns)
    .set({ status: 'active' })
    .where(and(eq(campaigns.status, 'upcoming'), lte(campaigns.startDate, today)))
    .returning({ id: campaigns.id });

  const completed = await db
    .update(campaigns)
    .set({ status: 'completed' })
    .where(
      and(
        eq(campaigns.status, 'active'),
        isNotNull(campaigns.endDate),
        lt(campaigns.endDate, today),
      ),
    )
    .returning({ id: campaigns.id });

  for (const c of completed) onCompleted(c.id);

  // J-3 reminder: drafts starting in exactly 3 Tunis calendar days, not yet reminded. The stamp
  // makes the pass idempotent; date-less drafts never match (a NULL start never equals a date).
  const reminderTarget = plusCalendarDays(today, 3);
  const due = await db
    .select({ id: campaigns.id, name: campaigns.name, advertiserId: campaigns.advertiserId })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, 'draft'),
        eq(campaigns.startDate, reminderTarget),
        isNull(campaigns.draftReminderSentAt),
      ),
    );
  for (const draft of due) {
    await db.insert(notifications).values({
      userId: draft.advertiserId,
      type: 'campaign_draft_reminder',
      title: DRAFT_REMINDER_TITLE,
      body: draftReminderBody(draft.name),
      campaignId: draft.id,
    });
    await db
      .update(campaigns)
      .set({ draftReminderSentAt: new Date() })
      .where(eq(campaigns.id, draft.id));
  }

  // CF-S2 (spec §1.14) — « si la date de début est dépassée et que la campagne est toujours en
  // statut Brouillon […] elle est supprimée automatiquement. » Deliberately AFTER the reminder
  // pass: a draft at J-3 gets its warning in the same tick that deletes another draft past its
  // start. STRICTLY past (« dépassée ») — a draft starting today survives its whole start day.
  // Set-based + idempotent (a re-run matches nothing); date-less drafts NEVER match (NULL never
  // compares); ONLY status='draft' — pending/rejected/anything-submitted is never touched.
  // targeting + zone rows go via their FK cascades; a reminder notification survives with its
  // campaign_id nulled (FK set-null) so the warning trail outlives the draft.
  // CF-C1 — carted drafts are EXEMPT: the panier is the advertiser's explicit launch intent, so
  // the tick never deletes a campaign sitting in a cart (« les brouillons dans le panier ne
  // s'auto-suppriment jamais »). Removing the item re-exposes the draft to this pass.
  const deleted = await db
    .delete(campaigns)
    .where(
      and(
        eq(campaigns.status, 'draft'),
        isNotNull(campaigns.startDate),
        lt(campaigns.startDate, today),
        notExists(db.select().from(cartItems).where(eq(cartItems.campaignId, campaigns.id))),
      ),
    )
    .returning({ id: campaigns.id });

  if (activated.length > 0 || completed.length > 0 || due.length > 0 || deleted.length > 0) {
    log.info(
      {
        activated: activated.length,
        completed: completed.length,
        reminded: due.length,
        deleted: deleted.length,
        today,
      },
      'campaign lifecycle tick applied transitions',
    );
  }
  return {
    activated: activated.length,
    completed: completed.length,
    reminded: due.length,
    deleted: deleted.length,
  };
}

/** Boot + hourly unref'd interval (the sweepUnexported pattern) — never holds the process open. */
export function startCampaignLifecycleJob(log: FastifyBaseLogger): void {
  void runCampaignLifecycleTick(log).catch((err: unknown) =>
    log.warn({ err }, 'campaign lifecycle boot tick failed'),
  );
  const timer = setInterval(
    () => {
      void runCampaignLifecycleTick(log).catch((err: unknown) =>
        log.warn({ err }, 'campaign lifecycle tick failed'),
      );
    },
    60 * 60 * 1000,
  );
  timer.unref();
}
