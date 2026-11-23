import { useMemo } from 'react';

import NetworkHero from '@/features/network/components/NetworkHero';
import NetworkShell from '@/features/network/components/NetworkShell';
import NetworkState from '@/features/network/components/NetworkState';
import NetworkView from '@/features/network/components/NetworkView';
import { useNetworkParks } from '@/features/network/hooks/useNetwork';
import { NETWORK_COPY, SOON_BODY, SOON_TITLE } from '@/features/network/lib/network-copy';
import { parkEntries } from '@/features/network/lib/network-entries';

/**
 * RESEAU-1 — « Parcs TV »: one brand, several locations; excluding a park excludes all of them.
 * While the platform has no park the page exists and says « Bientôt disponible » — it never
 * shows example parks.
 */
export default function NetworkParks() {
  const query = useNetworkParks();
  const entries = useMemo(() => parkEntries(query.data?.parks ?? []), [query.data]);

  return (
    <NetworkShell>
      {query.isPending ? (
        <NetworkState message="Chargement…" />
      ) : query.isError ? (
        <NetworkState message={NETWORK_COPY.parks.loadError} onRetry={() => void query.refetch()} />
      ) : entries.length === 0 ? (
        <div className="wrap">
          <NetworkHero copy={NETWORK_COPY.parks}>
            <div className="mine rsx-soon" role="status">
              <strong>{SOON_TITLE}</strong>
              <p>{SOON_BODY}</p>
            </div>
          </NetworkHero>
        </div>
      ) : (
        <NetworkView kind="parks" entries={entries} />
      )}
    </NetworkShell>
  );
}
