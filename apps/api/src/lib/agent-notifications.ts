import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import { agentNews, agents, notifications, users } from '../db/schema.js';
import {
  agentNoticeEmailPlainText,
  agentNoticeEmailTemplate,
} from '../email/agent-notice-template.js';
import type { EmailSender } from '../email/sender.js';
import { env } from '../env.js';

import { userLabel } from './user-label.js';

// AGT-6 (agent specs v1.0 §8) — the agent notification catalogue's cross-cutting rules, one home:
// the preference category of each type (only « Actualités et mises à jour » and « Rappels et
// événements » can be switched off — money, affiliations and appointment requests always go), the
// page « Consulter » opens, and the email double of every notification, on the same preferences.

const AGENT_ROLES = ['screenhost_agent', 'screencast_agent'] as const;

export type NoticeCategory = 'always' | 'reminders' | 'news';

export const noticeCategory = (type: string): NoticeCategory =>
  type === 'agent_news'
    ? 'news'
    : type === 'agent_appointment_reminder' || type === 'agent_affiliation_ending'
      ? 'reminders'
      : 'always';

const DEFAULT_LINKS: Record<string, string> = {
  agent_affiliate_new: '/agent/affilies',
  agent_affiliate_activated: '/agent/affilies',
  agent_affiliation_ending: '/agent/affilies',
  agent_campaign_launched: '/agent/campagnes',
  agent_payout_done: '/agent',
  agent_rib_validated: '/agent/parametres',
  agent_rib_refused: '/agent/parametres',
  agent_news: '/agent',
};

/** Where « Consulter » goes: the notification's own link, else its type's page, else none. */
export const noticeLink = (type: string, link: string | null): string | null =>
  link ??
  DEFAULT_LINKS[type] ??
  (type.startsWith('agent_appointment') ? '/agent/calendrier' : null);

const allowed = (
  category: NoticeCategory,
  prefs: { notifyNewsUpdates: boolean; notifyRemindersEvents: boolean },
) =>
  category === 'always' ||
  (category === 'news' ? prefs.notifyNewsUpdates : prefs.notifyRemindersEvents);

/**
 * Email every agent notification not yet emailed, once (the row is claimed before the send, so
 * a crash never double-sends; a failed send is logged, not retried).
 */
export const runAgentNoticeEmailTick = async (
  sender: EmailSender,
  log?: FastifyBaseLogger,
): Promise<{ sent: number; skipped: number }> => {
  const rows = await db
    .select({ n: notifications, user: users })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(isNull(notifications.emailedAt), inArray(users.role, [...AGENT_ROLES])))
    .orderBy(asc(notifications.createdAt))
    .limit(100);
  let sent = 0;
  let skipped = 0;
  for (const { n, user } of rows) {
    const claimed = await db
      .update(notifications)
      .set({ emailedAt: new Date() })
      .where(and(eq(notifications.id, n.id), isNull(notifications.emailedAt)))
      .returning({ id: notifications.id });
    if (claimed.length === 0) continue;
    if (!allowed(noticeCategory(n.type), user)) {
      skipped += 1;
      continue;
    }
    const url = `${env.WEB_ORIGIN}${noticeLink(n.type, n.link) ?? '/agent'}`;
    const name = userLabel(user);
    const result = await sender.send({
      to: user.email,
      subject: n.title,
      html: agentNoticeEmailTemplate({ name, title: n.title, body: n.body, url }),
      text: agentNoticeEmailPlainText({ name, title: n.title, body: n.body, url }),
    });
    if ('error' in result)
      log?.warn({ notificationId: n.id, error: result.error }, 'agent notice email failed');
    else sent += 1;
  }
  return { sent, skipped };
};

/** Every minute, unref'd. */
export function startAgentNoticeEmailJob(sender: EmailSender, log: FastifyBaseLogger): void {
  const tick = () =>
    void runAgentNoticeEmailTick(sender, log).catch((err: unknown) =>
      log.warn({ err }, 'agent notice email tick failed'),
    );
  setInterval(tick, 60 * 1000).unref();
}

/**
 * « Actualité Toodooh » — the hub publishes a post; every agent of the audience who keeps
 * « Actualités et mises à jour » on gets it (a closed account gets nothing).
 */
export const publishAgentNews = async (
  input: { title: string; body: string; audience: 'all' | 'screencast_agent' | 'screenhost_agent' },
  publishedBy: string | null,
): Promise<{ id: string; recipients: number }> => {
  const [news] = await db
    .insert(agentNews)
    .values({ ...input, publishedBy })
    .returning({ id: agentNews.id });
  const roles = input.audience === 'all' ? [...AGENT_ROLES] : [input.audience];
  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(agents, eq(agents.userId, users.id))
    .where(
      and(
        inArray(users.role, roles),
        eq(users.notifyNewsUpdates, true),
        ne(agents.accountStatus, 'cloture'),
      ),
    );
  if (recipients.length > 0) {
    await db.insert(notifications).values(
      recipients.map((r) => ({
        userId: r.id,
        type: 'agent_news',
        title: `Actualité Toodooh : ${input.title}`,
        body: input.body,
        link: '/agent',
      })),
    );
  }
  return { id: news?.id ?? '', recipients: recipients.length };
};
