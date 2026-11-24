import { useMemo } from 'react';

import NetworkShell from '@/features/network/components/NetworkShell';
import NetworkState from '@/features/network/components/NetworkState';
import NetworkView from '@/features/network/components/NetworkView';
import { useNetworkVenues } from '@/features/network/hooks/useNetwork';
import { NETWORK_COPY } from '@/features/network/lib/network-copy';
import { venueEntries } from '@/features/network/lib/network-entries';

/**
 * RESEAU-1 — « Réseau Screenhosts »: the Screencaster consults the network's venues, excludes
 * one or several (« Ne plus diffuser dans ces établissements ») and reintegrates them at will.
 */
export default function NetworkScreenhosts() {
  const query = useNetworkVenues();
  const entries = useMemo(() => venueEntries(query.data?.venues ?? []), [query.data]);

  return (
    <NetworkShell>
      {query.isPending ? (
        <NetworkState message="Chargement…" />
      ) : query.isError ? (
        <NetworkState
          message={NETWORK_COPY.venues.loadError}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <NetworkView
          kind="venues"
          entries={entries}
          personsPerMonth={query.data.persons_per_month}
        />
      )}
    </NetworkShell>
  );
}
