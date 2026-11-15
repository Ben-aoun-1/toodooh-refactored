import { and, asc, desc, eq, ne } from 'drizzle-orm';

import { db } from '../db/client.js';
import { agentChecklists, screenhosts } from '../db/schema.js';

import { type HubChecklistRow, hubChecklist } from './agent-checklists.js';

// Mariem 15/11/2026 — « Pour le moment, l'opération se fera manuellement via l'Admin, avec une
// interface simple permettant d'identifier directement le lien entre une fiche et un Host. » When
// the manager decides a fiche, the venue has no Screenhost account yet; once it signs up, the
// Admin links the fiche to it here, and the fiche's recap shows on that Host's Fiche Host.
// ONE home for the link: the admin list, the link itself and the Fiche Host recap read it.
// A Screenhost carries at most one fiche (a second link is refused until the first is undone).

export interface AdminChecklistRow extends HubChecklistRow {
  screenhost: { id: string; name: string } | null;
}

const toRow = (
  r: typeof agentChecklists.$inferSelect,
  venue: { id: string; name: string } | null,
): AdminChecklistRow => ({
  id: r.id,
  name: r.name ?? 'Sans nom',
  category: r.category ?? '',
  governorate: r.governorate ?? '',
  delegation: r.delegation,
  agent_name: r.agentName ?? '',
  agent_code: r.agentCode,
  result: r.result ?? 'inc',
  agent_opinion: r.agentOpinion,
  status: r.status === 'draft' ? 'sent' : r.status,
  sent_at: (r.sentAt ?? r.createdAt).toISOString(),
  decided_at: r.decidedAt?.toISOString() ?? null,
  decided_by_name: r.decidedByName,
  manager_comment: r.managerComment,
  screenhost: venue,
});

/** Every fiche sent to the manager (drafts stay the agent's), newest first, with its Host. */
export const adminChecklists = async (): Promise<AdminChecklistRow[]> => {
  const rows = await db
    .select({ c: agentChecklists, venueId: screenhosts.id, venueName: screenhosts.name })
    .from(agentChecklists)
    .leftJoin(screenhosts, eq(screenhosts.id, agentChecklists.screenhostId))
    .where(ne(agentChecklists.status, 'draft'))
    .orderBy(desc(agentChecklists.sentAt));
  return rows.map((r) =>
    toRow(r.c, r.venueId && r.venueName ? { id: r.venueId, name: r.venueName } : null),
  );
};

/** One fiche in full (answers rendered, Wi-Fi masked) with its Host, or null. */
export const adminChecklist = async (id: string) => {
  const full = await hubChecklist(id);
  if (!full) return null;
  const [link] = await db
    .select({ id: screenhosts.id, name: screenhosts.name })
    .from(agentChecklists)
    .innerJoin(screenhosts, eq(screenhosts.id, agentChecklists.screenhostId))
    .where(eq(agentChecklists.id, id))
    .limit(1);
  return { ...full, screenhost: link ?? null };
};

export type LinkResult =
  | { ok: true }
  | { ok: false; error: 'NOT_FOUND' | 'SCREENHOST_NOT_FOUND' | 'SCREENHOST_TAKEN' };

/** Link a sent fiche to a Screenhost, or undo the link (`screenhostId` null). */
export const linkChecklist = async (id: string, screenhostId: string | null): Promise<LinkResult> =>
  db.transaction(async (tx): Promise<LinkResult> => {
    const [fiche] = await tx
      .select({ id: agentChecklists.id })
      .from(agentChecklists)
      .where(and(eq(agentChecklists.id, id), ne(agentChecklists.status, 'draft')))
      .limit(1)
      .for('update');
    if (!fiche) return { ok: false, error: 'NOT_FOUND' };
    if (screenhostId !== null) {
      const [venue] = await tx
        .select({ id: screenhosts.id })
        .from(screenhosts)
        .where(eq(screenhosts.id, screenhostId))
        .limit(1);
      if (!venue) return { ok: false, error: 'SCREENHOST_NOT_FOUND' };
      const [taken] = await tx
        .select({ id: agentChecklists.id })
        .from(agentChecklists)
        .where(and(eq(agentChecklists.screenhostId, screenhostId), ne(agentChecklists.id, id)))
        .limit(1);
      if (taken) return { ok: false, error: 'SCREENHOST_TAKEN' };
    }
    await tx
      .update(agentChecklists)
      .set({ screenhostId, updatedAt: new Date() })
      .where(eq(agentChecklists.id, id));
    return { ok: true };
  });

/** The Fiche Host recap: the fiche linked to this Screenhost, or null. */
export const checklistOfScreenhost = async (
  screenhostId: string,
): Promise<AdminChecklistRow | null> => {
  const [row] = await db
    .select({ c: agentChecklists, venueName: screenhosts.name })
    .from(agentChecklists)
    .innerJoin(screenhosts, eq(screenhosts.id, agentChecklists.screenhostId))
    .where(eq(agentChecklists.screenhostId, screenhostId))
    .orderBy(asc(agentChecklists.createdAt))
    .limit(1);
  return row ? toRow(row.c, { id: screenhostId, name: row.venueName }) : null;
};
