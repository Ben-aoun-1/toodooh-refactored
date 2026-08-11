import { and, eq, exists, gte, isNotNull, isNull, lt, lte, notExists } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { campaigns, cartItems, events, notifications } from '../db/schema.js';

import { plusCalendarDays, tunisDateOf } from './campaign-dates.js';
import { reconcileCampaignById } from './reconcile/reconcile-service.js';

// CF-S1 (spec §3.1/3.2) — the stored-status lifecycle: admin approval routes a future-dated
// campaign to 'upcoming'; this job flips upcoming→active when the window opens and
// active→completed when it closes. Set-based single UPDATEs, idempotent by construction (a
// re-run matches zero rows), Tunis calendar dates like the rest of the campaign date rules.

/**
 * SETTLE2 (operator ruling 2026-08-10) — the settlement seam, ARMED: each newly-completed
 * campaign settles through the UNTOUCHED reconcile service on the same tick. Failure isolation:
 * a settlement failure logs loudly and never breaks the tick or its siblings — the failed
 * campaign stays unreconciled and retries naturally next tick (the service's unique(campaign_id)
 * guard keeps every path idempotent). Actor: NULL = system (the activated_by-NULL idiom).
 * Every attempt logs ONE line (the INV-1 visibility rule — a silent settlement is as bad as a
 * silent sweep): campaign, outcome, amounts or the error.
 */
export async function onCampaignCompleted(
  campaignId: string,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const result = await reconcileCampaignById(campaignId, null);
    if (result.status === 'OK') {
      log.info(
        {
          campaignId,
          outcome: 'settled',
          status: result.reconciliation.status,
          spendTnd: Number(result.reconciliation.spendTnd),
          refundTnd: Number(result.reconciliation.refundTnd),
        },
        'auto-settlement attempt',
      );
    } else {
      // NO_PLAN (never dispatched — nothing to settle) | ALREADY_RECONCILED (idempotent skip).
      log.info({ campaignId, outcome: result.status }, 'auto-settlement attempt');
    }
  } catch (err) {
    log.error({ err, campaignId, outcome: 'ERROR' }, 'auto-settlement attempt failed');
  }
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

// EV3 (§8) — the positioning reminder: the KICKOFF is the clock (not the snapshotted window
// dates — cross-midnight, windowStart's day can precede the match day). Charter copy, verbatim.
export const EVENT_DRAFT_REMINDER_TITLE = 'Votre positionnement démarre bientôt';
export const eventDraftReminderBody = (matchName: string): string =>
  `Votre positionnement sur ${matchName} doit commencer dans 3 jours. Pour ne pas le perdre, terminez le processus et ajoutez-le au panier.`;

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
  onCompleted: (campaignId: string, log: FastifyBaseLogger) => Promise<void> = onCampaignCompleted,
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

  // SETTLE2 — sequential, and the TICK survives whatever the seam does (the default impl
  // isolates internally; this belt covers injected seams too — the tick must never die).
  for (const c of completed) {
    try {
      await onCompleted(c.id, log);
    } catch (err) {
      log.error({ err, campaignId: c.id }, 'campaign completion hook failed');
    }
  }

  // J-3 reminder: drafts starting in exactly 3 Tunis calendar days, not yet reminded. The stamp
  // makes the pass idempotent; date-less drafts never match (a NULL start never equals a date).
  // EV3 — positionings (event-BOUND rows — the binding, not the type string, discriminates)
  // are EXCLUDED here: their clock is the kickoff (own pass below).
  const reminderTarget = plusCalendarDays(today, 3);
  const due = await db
    .select({ id: campaigns.id, name: campaigns.name, advertiserId: campaigns.advertiserId })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.status, 'draft'),
        isNull(campaigns.eventId),
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

  // EV3 (§8) — the positioning J-3 pass: KICKOFF lands in exactly 3 Tunis calendar days (the
  // day bounds are +01:00 instants — Tunisia has no DST). Same stamp, same idempotence.
  const kickoffDayStart = new Date(`${reminderTarget}T00:00:00+01:00`);
  const kickoffDayEnd = new Date(kickoffDayStart.getTime() + 24 * 60 * 60 * 1000);
  const eventDue = await db
    .select({ id: campaigns.id, advertiserId: campaigns.advertiserId, matchName: events.name })
    .from(campaigns)
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .where(
      and(
        eq(campaigns.status, 'draft'),
        isNotNull(campaigns.eventId),
        isNull(campaigns.draftReminderSentAt),
        gte(events.kickoffAt, kickoffDayStart),
        lt(events.kickoffAt, kickoffDayEnd),
      ),
    );
  for (const draft of eventDue) {
    await db.insert(notifications).values({
      userId: draft.advertiserId,
      type: 'campaign_draft_reminder',
      title: EVENT_DRAFT_REMINDER_TITLE,
      body: eventDraftReminderBody(draft.matchName),
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
  // EV3 — positionings (event-BOUND rows) are EXCLUDED here (own pass below: the kickoff
  // INSTANT, not the snapshotted windowStart day, decides when a positioning draft dies).
  const deleted = await db
    .delete(campaigns)
    .where(
      and(
        eq(campaigns.status, 'draft'),
        isNull(campaigns.eventId),
        isNotNull(campaigns.startDate),
        lt(campaigns.startDate, today),
        notExists(db.select().from(cartItems).where(eq(cartItems.campaignId, campaigns.id))),
      ),
    )
    .returning({ id: campaigns.id });

  // EV3 (§8) — a positioning still a DRAFT when its kickoff passes is auto-deleted: the match
  // has started, the positioning can no longer be saved. « Unconfirmed » is literal — a carted
  // but unconfirmed positioning dies too (the CF-C1 panier exemption is a CLASSIC-draft rule:
  // there the panier protects a launchable intent; here kickoff-passed means there is nothing
  // left to launch, and keeping it would let the panier confirm a dead positioning). The cart
  // row cascades; the reminder notification survives with campaign_id nulled (FK set-null).
  const eventDeleted = await db
    .delete(campaigns)
    .where(
      and(
        eq(campaigns.status, 'draft'),
        isNotNull(campaigns.eventId),
        exists(
          db
            .select()
            .from(events)
            .where(and(eq(events.id, campaigns.eventId), lt(events.kickoffAt, now))),
        ),
      ),
    )
    .returning({ id: campaigns.id });

  const reminded = due.length + eventDue.length;
  const deletedCount = deleted.length + eventDeleted.length;
  if (activated.length > 0 || completed.length > 0 || reminded > 0 || deletedCount > 0) {
    log.info(
      {
        activated: activated.length,
        completed: completed.length,
        reminded,
        deleted: deletedCount,
        today,
      },
      'campaign lifecycle tick applied transitions',
    );
  }
  return {
    activated: activated.length,
    completed: completed.length,
    reminded,
    deleted: deletedCount,
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
