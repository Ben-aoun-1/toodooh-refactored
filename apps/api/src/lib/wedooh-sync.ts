import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import { governorates, screenhosts, users } from '../db/schema.js';
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

type Logger = { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };

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

type ScreenhostRow = typeof screenhosts.$inferSelect;
type OwnerRow = typeof users.$inferSelect;

export const buildLocationPayload = (
  s: ScreenhostRow,
  owner: OwnerRow,
  governorateName: string | null,
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

  const payload = buildLocationPayload(row.s, row.owner, row.governorateName);
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
