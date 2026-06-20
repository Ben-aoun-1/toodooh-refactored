import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import { agentReferrals, agents, governorates, screenhosts, users } from '../db/schema.js';
import { env } from '../env.js';

import { decryptWifiPassword } from './wifi-crypto.js';

// S-T1 Edge B2 — push approved screenhost locations (with recoverable WiFi) to wedooh's ingest on
// admin approval. The ONLY way a location enters wedooh. Idempotent on the toodooh location UUID
// (wedooh upserts), so a re-push is always safe — which is what makes the sweep correct.
//
// FAILURE ISOLATION: the push must NEVER block or fail an admin approval. The admin route fires it
// fire-and-forget AFTER its commit; here every push is wrapped so a wedooh outage degrades a
// screenhost to export_status='failed' (the sweep retries) rather than throwing into the caller.
// WiFi plaintext + the sync key are never logged — only location ids + status.
//
// Config is resolved from env by default; the public functions accept an override so tests pass it
// directly (mirroring requireSyncKey) and never depend on the eagerly-parsed env singleton.

type Logger = {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
};

export type SyncConfig = { ingestUrl: string; syncKey: string };

const resolveConfig = (override?: Partial<SyncConfig>): SyncConfig | null => {
  const ingestUrl = override?.ingestUrl ?? env.WEDOOH_INGEST_URL;
  const syncKey = override?.syncKey ?? env.TOODOOH_SYNC_KEY;
  return ingestUrl && syncKey ? { ingestUrl, syncKey } : null;
};

export const isSyncEnabled = (override?: Partial<SyncConfig>): boolean =>
  resolveConfig(override) !== null;

const num = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const decryptWifi = (encrypted: string | null): string | null => {
  if (!encrypted) return null;
  try {
    return decryptWifiPassword(encrypted);
  } catch {
    return null;
  }
};

// The referring agent's canonical code (agents.code) for an owner, via the agent_referrals link
// (referred_user_id is UNIQUE → at most one). null when the owner has no referral. HB3 uses this to
// assign the synced place to the referring agent. Resolved per push (in pushOneLocation) so both the
// owner push AND the sweep re-push carry it — an owner's hosts all resolve to the same code.
const resolveReferringAgentCode = async (ownerId: string): Promise<string | null> => {
  const [row] = await db
    .select({ code: agents.code })
    .from(agentReferrals)
    .innerJoin(agents, eq(agents.userId, agentReferrals.agentUserId))
    .where(eq(agentReferrals.referredUserId, ownerId))
    .limit(1);
  return row?.code ?? null;
};

type ScreenhostRow = typeof screenhosts.$inferSelect;
type OwnerRow = typeof users.$inferSelect;

export const buildLocationPayload = (
  s: ScreenhostRow,
  owner: OwnerRow,
  governorateName: string | null,
  agentCode: string | null,
) => ({
  location_id: s.id,
  name: s.name,
  latitude: num(s.latitude),
  longitude: num(s.longitude),
  address: s.address,
  city: s.city,
  postal_code: s.postalCode,
  zone: s.zone,
  governorate: governorateName,
  screen_count: s.screenCount,
  wifi_ssid: s.wifiSsid,
  wifi_password: decryptWifi(s.wifiPasswordEncrypted),
  // The referring agent's code (agents.code) if this owner signed up via an agent referral, else
  // null — HB3 assigns the synced place to that agent when present.
  agent_code: agentCode,
  owner: {
    id: owner.id,
    email: owner.email,
    contact_name: owner.contactName,
    business_name: owner.businessName,
    contact_phone: owner.contactPhone,
    phone: owner.phone,
  },
});

// Push ONE screenhost. Resolves to true (exported) / false (failed) / null (skipped: no owner) —
// never rejects. Stamps export_status accordingly.
const pushOneLocation = async (
  screenhostId: string,
  cfg: SyncConfig,
  logger: Logger,
): Promise<boolean | null> => {
  const [row] = await db
    .select({ s: screenhosts, governorateName: governorates.name, owner: users })
    .from(screenhosts)
    .leftJoin(governorates, eq(screenhosts.governorateId, governorates.id))
    .leftJoin(users, eq(screenhosts.ownerId, users.id))
    .where(eq(screenhosts.id, screenhostId))
    .limit(1);
  if (!row || !row.owner) return null; // ownerless screenhost → nothing to transfer

  const agentCode = await resolveReferringAgentCode(row.owner.id);
  const payload = buildLocationPayload(row.s, row.owner, row.governorateName, agentCode);
  try {
    const res = await fetch(`${cfg.ingestUrl}/api/sync/locations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.syncKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      await db
        .update(screenhosts)
        .set({ exportStatus: 'exported', exportedAt: new Date() })
        .where(eq(screenhosts.id, screenhostId));
      return true;
    }
    logger.warn(`wedooh B2 push failed: location ${screenhostId} → ${res.status}`);
  } catch (err) {
    logger.warn(`wedooh B2 push error: location ${screenhostId} → ${(err as Error).message}`);
  }
  await db
    .update(screenhosts)
    .set({ exportStatus: 'failed' })
    .where(eq(screenhosts.id, screenhostId));
  return false;
};

// Push ALL of an approved owner's screenhosts (called fire-and-forget from the approve route).
export const pushApprovedOwnerLocations = async (
  ownerId: string,
  logger: Logger,
  override?: Partial<SyncConfig>,
): Promise<void> => {
  const cfg = resolveConfig(override);
  if (!cfg) return;
  const rows = await db
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .where(eq(screenhosts.ownerId, ownerId));
  for (const { id } of rows) {
    await pushOneLocation(id, cfg, logger);
  }
};

// Re-push every pending/failed screenhost whose owner is approved (boot + interval). Safe because
// wedooh's ingest is UUID-idempotent.
export const sweepUnexported = async (
  logger: Logger,
  override?: Partial<SyncConfig>,
): Promise<void> => {
  const cfg = resolveConfig(override);
  if (!cfg) return;
  const rows = await db
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .innerJoin(users, eq(screenhosts.ownerId, users.id))
    .where(
      and(inArray(screenhosts.exportStatus, ['pending', 'failed']), eq(users.status, 'approved')),
    );
  if (rows.length === 0) return;
  logger.info(`wedooh B2 sweep: re-pushing ${rows.length} unexported location(s)`);
  for (const { id } of rows) {
    await pushOneLocation(id, cfg, logger);
  }
};

// S-T1 Edge — provision a newly-created AGENT to wedooh's hub on admin creation, so the agent can
// log into hub.too-dooh.com with their agent code (= hub username) and the SAME generated password.
// Mirrors the location push: same env-gating, same x-api-key auth, same swallow-and-log. Called
// fire-and-forget from admin-accounts AFTER its commit — it NEVER blocks or fails creation (the
// admin-UI panel + welcome email are the fallback). The plaintext password rides the authenticated
// HTTPS channel and is NEVER logged (only the code + status). Unlike locations there is no
// export-status/sweep retry here — a one-shot push; the hub receiver (HB2) + any retry is separate.
export type AgentSyncPayload = {
  toodooh_user_id: string;
  code: string;
  email: string;
  password: string;
  role: string;
};

// Persist an agent's hub-provisioning status (agents.export_status) for operator visibility (FX3) —
// a hub-down must never SILENTLY strand an agent. Called only on a real push OUTCOME; an env-disabled
// skip leaves the existing status (default 'pending'). Best-effort: a stamp failure (DB hiccup) must
// not break the push's non-blocking contract, so it swallows.
const stampAgentExport = async (userId: string, status: 'exported' | 'failed'): Promise<void> => {
  try {
    await db.update(agents).set({ exportStatus: status }).where(eq(agents.userId, userId));
  } catch {
    // best-effort visibility — never break the push's non-blocking contract.
    return;
  }
};

export const pushAgentToHub = async (
  agent: AgentSyncPayload,
  logger: Logger,
  override?: Partial<SyncConfig>,
): Promise<void> => {
  const cfg = resolveConfig(override);
  if (!cfg) {
    logger.warn(`hub agent sync disabled: agent ${agent.code} not provisioned (sync env unset)`);
    return;
  }
  // The hub's /api/sync/agents accepts ONLY role 'agent' — the SH/SC subtype is already carried by
  // the code prefix. Normalize at the wire so BOTH callers (admin create + reset propagation) are
  // covered: pushing the raw user_role ('screenhost_agent'/'screencast_agent') 400s and the agent
  // would never exist on the hub → login-by-code dead. Failures log at ERROR — a silent 400 here
  // kills the feature, so make it loud.
  try {
    const res = await fetch(`${cfg.ingestUrl}/api/sync/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.syncKey },
      body: JSON.stringify({ ...agent, role: 'agent' }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      logger.info(`hub agent provisioned: ${agent.code}`);
      await stampAgentExport(agent.toodooh_user_id, 'exported');
      return;
    }
    logger.error(`hub agent push failed: agent ${agent.code} → ${res.status}`);
    await stampAgentExport(agent.toodooh_user_id, 'failed');
  } catch (err) {
    logger.error(`hub agent push error: agent ${agent.code} → ${(err as Error).message}`);
    await stampAgentExport(agent.toodooh_user_id, 'failed');
  }
};
