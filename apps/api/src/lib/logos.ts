import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import { type Logo, logos, notifications, screenhosts, users } from '../db/schema.js';
import { storage } from '../storage/s3-storage.js';

import { notifyAdmins } from './admin-notifications.js';
import { imageDims } from './image-dims.js';
import { userLabel, userLabelById } from './user-label.js';

// Mariem 12/11/2026 (Agent Screenhost spec VF §6, Agent Screencaster spec VF §5) — logos, one home.
// A venue (Screenhost) or an account (Screencaster) has at most one VALIDATED logo, shown to
// everyone, and at most one PENDING logo, shown only to the agent who sent it (« En attente de
// validation »). An agent's upload waits for an admin; the owner's own upload and an admin's are
// validated at once. PNG or JPEG, 400 × 400 px minimum (the agent photo's own gate).

export const LOGO_MIN_PX = 400;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

export type LogoSubject = { kind: 'screenhost' | 'advertiser'; id: string };
export type LogoUploaderRole = 'agent' | 'owner' | 'admin';

export type LogoFileProblem = 'UNSUPPORTED_FILE' | 'LOGO_TOO_SMALL';

export const LOGO_FILE_MESSAGES: Record<LogoFileProblem, string> = {
  UNSUPPORTED_FILE: 'Formats acceptés : PNG, JPEG.',
  LOGO_TOO_SMALL: `Le logo doit faire au moins ${LOGO_MIN_PX} × ${LOGO_MIN_PX} px.`,
};

/** The image's content type when it is an acceptable logo, else why not (read from the bytes). */
export const logoFileCheck = (
  body: Buffer,
):
  | { ok: true; contentType: 'image/png' | 'image/jpeg' }
  | { ok: false; error: LogoFileProblem } => {
  const dims = imageDims(body);
  if (!dims) return { ok: false, error: 'UNSUPPORTED_FILE' };
  if (dims.width < LOGO_MIN_PX || dims.height < LOGO_MIN_PX) {
    return { ok: false, error: 'LOGO_TOO_SMALL' };
  }
  return { ok: true, contentType: dims.format === 'png' ? 'image/png' : 'image/jpeg' };
};

const subjectWhere = (s: LogoSubject) =>
  s.kind === 'screenhost' ? eq(logos.screenhostId, s.id) : eq(logos.userId, s.id);

export const subjectName = async (s: LogoSubject): Promise<string> => {
  if (s.kind === 'screenhost') {
    const [v] = await db
      .select({ name: screenhosts.name })
      .from(screenhosts)
      .where(eq(screenhosts.id, s.id))
      .limit(1);
    return v?.name ?? '–';
  }
  return userLabelById(s.id);
};

export type SubmitLogoResult =
  | { ok: true; logo: Logo }
  | { ok: false; error: LogoFileProblem | 'STORAGE_ERROR' };

/**
 * Store a logo for a subject. From an agent it is pending (a previous pending one is replaced)
 * and the admins are told; from the owner or an admin it is the validated logo at once.
 */
export const submitLogo = async (
  subject: LogoSubject,
  body: Buffer,
  by: { userId: string; role: LogoUploaderRole },
  now: Date = new Date(),
): Promise<SubmitLogoResult> => {
  const check = logoFileCheck(body);
  if (!check.ok) return check;
  const key = `logo/${subject.kind}/${subject.id}/${randomUUID()}`;
  const up = await storage.upload({ key, body, contentType: check.contentType });
  if ('error' in up) return { ok: false, error: 'STORAGE_ERROR' };
  const pending = by.role === 'agent';
  const row = await db.transaction(async (tx) => {
    await tx
      .update(logos)
      .set({ status: 'remplace' })
      .where(
        and(
          subjectWhere(subject),
          inArray(logos.status, pending ? ['en_attente'] : ['en_attente', 'valide']),
        ),
      );
    const [created] = await tx
      .insert(logos)
      .values({
        subjectKind: subject.kind,
        screenhostId: subject.kind === 'screenhost' ? subject.id : null,
        userId: subject.kind === 'advertiser' ? subject.id : null,
        storageKey: key,
        contentType: check.contentType,
        status: pending ? 'en_attente' : 'valide',
        uploadedBy: by.userId,
        uploadedByRole: by.role,
        ...(pending ? {} : { decidedBy: by.userId, decidedAt: now }),
      })
      .returning();
    return created;
  });
  if (!row) throw new Error('logo insert failed');
  if (pending) {
    const [name, agent] = await Promise.all([subjectName(subject), userLabelById(by.userId)]);
    await notifyAdmins(db, {
      type: 'admin_logo_pending',
      title: `Logo à valider : ${name}`,
      body: `Ajouté par l’agent ${agent}.`,
    });
  }
  return { ok: true, logo: row };
};

export type DecideLogoResult =
  | { ok: true; logo: Logo }
  | { ok: false; error: 'NOT_FOUND' | 'ALREADY_DECIDED' };

/** Admin: validate (it becomes THE logo, the previous one is kept as replaced) or refuse. */
export const decideLogo = async (
  id: string,
  adminId: string,
  accept: boolean,
  reason: string | null,
  now: Date = new Date(),
): Promise<DecideLogoResult> => {
  const [row] = await db.select().from(logos).where(eq(logos.id, id)).limit(1);
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  const subject: LogoSubject =
    row.subjectKind === 'screenhost'
      ? { kind: 'screenhost', id: row.screenhostId ?? '' }
      : { kind: 'advertiser', id: row.userId ?? '' };
  const done = await db.transaction(async (tx) => {
    if (accept) {
      await tx
        .update(logos)
        .set({ status: 'remplace' })
        .where(and(subjectWhere(subject), eq(logos.status, 'valide')));
    }
    return tx
      .update(logos)
      .set({
        status: accept ? 'valide' : 'refuse',
        decidedBy: adminId,
        decidedAt: now,
        refusalReason: accept ? null : reason,
      })
      .where(and(eq(logos.id, id), eq(logos.status, 'en_attente')))
      .returning();
  });
  const decided = done[0];
  if (!decided) return { ok: false, error: 'ALREADY_DECIDED' };
  if (row.uploadedBy && row.uploadedByRole === 'agent') {
    const name = await subjectName(subject);
    await db.insert(notifications).values({
      userId: row.uploadedBy,
      type: accept ? 'agent_logo_validated' : 'agent_logo_refused',
      title: accept ? `Logo validé : ${name}` : `Logo refusé : ${name}`,
      body: accept
        ? 'Le logo est maintenant visible de tous.'
        : (reason ?? 'Envoyez un autre logo depuis la fiche.'),
      link: '/agent/affilies',
    });
  }
  return { ok: true, logo: decided };
};

export interface LogoView {
  url: string;
  status: 'valide' | 'en_attente';
}

const urlOf = async (key: string): Promise<string | null> => {
  const signed = await storage.getPresignedUrl({ key });
  return 'error' in signed ? null : signed.url;
};

/**
 * The logo each subject shows to a viewer: the validated one, or — for the agent who sent it —
 * his pending one with its mention. Keyed by the subject's id (venue id or account id).
 */
export const logosFor = async (
  subjects: readonly LogoSubject[],
  viewerUserId: string | null,
): Promise<Map<string, LogoView>> => {
  const out = new Map<string, LogoView>();
  const venueIds = subjects.filter((s) => s.kind === 'screenhost').map((s) => s.id);
  const userIds = subjects.filter((s) => s.kind === 'advertiser').map((s) => s.id);
  const rows = [
    ...(venueIds.length
      ? await db
          .select()
          .from(logos)
          .where(
            and(
              inArray(logos.screenhostId, venueIds),
              inArray(logos.status, ['valide', 'en_attente']),
            ),
          )
      : []),
    ...(userIds.length
      ? await db
          .select()
          .from(logos)
          .where(
            and(inArray(logos.userId, userIds), inArray(logos.status, ['valide', 'en_attente'])),
          )
      : []),
  ];
  // The viewer's own pending logo wins over the validated one (he sees what he sent).
  const ranked = rows
    .filter(
      (r) => r.status === 'valide' || (viewerUserId !== null && r.uploadedBy === viewerUserId),
    )
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'valide' ? -1 : 1));
  for (const r of ranked) {
    const id = r.screenhostId ?? r.userId;
    const url = id ? await urlOf(r.storageKey) : null;
    if (id && url) out.set(id, { url, status: r.status === 'valide' ? 'valide' : 'en_attente' });
  }
  return out;
};

export interface PendingLogoView {
  id: string;
  subject_kind: 'screenhost' | 'advertiser';
  subject_id: string;
  subject_name: string;
  agent_name: string;
  url: string | null;
  current_url: string | null;
  created_at: string;
}

/** The admin's queue: every pending logo with who it is for, who sent it and the current logo. */
export const pendingLogos = async (): Promise<PendingLogoView[]> => {
  const rows = await db
    .select({ l: logos, venue: screenhosts.name, account: users })
    .from(logos)
    .leftJoin(screenhosts, eq(screenhosts.id, logos.screenhostId))
    .leftJoin(users, eq(users.id, logos.userId))
    .where(eq(logos.status, 'en_attente'))
    .orderBy(asc(logos.createdAt));
  const out: PendingLogoView[] = [];
  for (const { l, venue, account } of rows) {
    const subject: LogoSubject =
      l.subjectKind === 'screenhost'
        ? { kind: 'screenhost', id: l.screenhostId ?? '' }
        : { kind: 'advertiser', id: l.userId ?? '' };
    const current = (await logosFor([subject], null)).get(subject.id);
    out.push({
      id: l.id,
      subject_kind: l.subjectKind,
      subject_id: subject.id,
      subject_name: venue ?? (account ? userLabel(account) : '–'),
      agent_name: l.uploadedBy ? await userLabelById(l.uploadedBy) : '–',
      url: await urlOf(l.storageKey),
      current_url: current?.url ?? null,
      created_at: l.createdAt.toISOString(),
    });
  }
  return out;
};
