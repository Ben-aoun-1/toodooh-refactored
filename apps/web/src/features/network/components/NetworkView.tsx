import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  useExcludeScreenhosts,
  useReintegrateScreenhosts,
} from '@/features/network/hooks/useNetwork';
import { useNetworkMotion } from '@/features/network/hooks/useNetworkMotion';
import {
  NETWORK_COPY,
  countLine,
  dockText,
  emptyText,
  heroStats,
  mineText,
  toastText,
} from '@/features/network/lib/network-copy';
import {
  NO_FILTERS,
  allSpots,
  categoryOptions,
  filterEntries,
  networkCells,
  networkCounts,
  pickedEntries,
  quartierOptions,
  regionOptions,
  screenhostIdsToExclude,
  screenhostIdsToReintegrate,
  type NetworkEntry,
  type NetworkFilters,
  type NetworkKind,
} from '@/features/network/lib/network-entries';
import { logger } from '@/lib/logger';

import NetworkCard from './NetworkCard';
import NetworkConfirmDialog from './NetworkConfirmDialog';
import NetworkDock from './NetworkDock';
import NetworkHero from './NetworkHero';
import NetworkMap from './NetworkMap';
import NetworkPortrait from './NetworkPortrait';
import NetworkToolbar from './NetworkToolbar';

const log = logger.child({ module: 'network.view' });

interface NetworkViewProps {
  kind: NetworkKind;
  entries: NetworkEntry[];
  /** « personnes par mois » of the whole network (the Screenhost page only). */
  personsPerMonth?: number | null;
}

/**
 * RESEAU-1 — one page of the network feature, for venues or for parks: hero + map, portrait,
 * then the list with its exclusion flow (select → dock → confirm → toast, and « Réintégrer »).
 */
export default function NetworkView({ kind, entries, personsPerMonth = null }: NetworkViewProps) {
  const copy = NETWORK_COPY[kind];
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const [filters, setFilters] = useState<NetworkFilters>(NO_FILTERS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(0);
  const exclude = useExcludeScreenhosts();
  const reintegrate = useReintegrateScreenhosts();
  useNetworkMotion(root);

  const counts = useMemo(() => networkCounts(entries), [entries]);
  const spots = useMemo(() => allSpots(entries), [entries]);
  const rows = useMemo(() => filterEntries(entries, filters), [entries, filters]);
  const picked = useMemo(() => pickedEntries(entries, selected), [entries, selected]);
  const patch = useCallback(
    (change: Partial<NetworkFilters>) => setFilters((f) => ({ ...f, ...change })),
    [],
  );
  const closeDialog = useCallback(() => setConfirming(false), []);

  const select = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const pickQuartier = (quartier: string) => {
    patch({ quartier: filters.quartier === quartier ? '' : quartier });
    list.current?.scrollIntoView({ block: 'start' });
  };

  const confirm = () => {
    const count = picked.length;
    exclude.mutate(screenhostIdsToExclude(picked), {
      onSuccess: () => {
        setSelected(new Set());
        setDone(count);
        setConfirming(false);
      },
      onError: (err) => {
        log.error({ err, kind }, 'network exclusion failed');
        toast.error("Votre choix n'a pas pu être enregistré. Veuillez réessayer.");
      },
    });
  };

  const bringBack = (entry: NetworkEntry) => {
    setDone(0);
    reintegrate.mutate(screenhostIdsToReintegrate(entry), {
      onError: (err) => {
        log.error({ err, kind }, 'network reintegration failed');
        toast.error("La réintégration n'a pas pu être enregistrée. Veuillez réessayer.");
      },
    });
  };

  return (
    <>
      <div className="wrap" ref={root}>
        <NetworkHero
          copy={copy}
          summary={{
            stats: heroStats(kind, counts, personsPerMonth),
            mine: mineText(kind, counts),
            cells: networkCells(entries, selected),
          }}
          aside={
            <NetworkMap
              kind={kind}
              spots={spots}
              label={copy.mapLabel}
              caption={copy.mapCaption}
              quartier={filters.quartier}
              onPick={pickQuartier}
            />
          }
        />

        <NetworkPortrait copy={copy} headingId={`${kind}-portrait`} entries={entries} />

        <section aria-labelledby={`${kind}-list`} ref={list}>
          <div className="head">
            <h3 id={`${kind}-list`}>
              {copy.listTitle}
              <em>{copy.listAccent}</em>
            </h3>
            <p>{copy.listIntro}</p>
          </div>
          <div className={done > 0 ? 'toast show' : 'toast'} role="status">
            <span>{done > 0 ? toastText(kind, done) : ''}</span>
            <button type="button" className="mini" onClick={() => setDone(0)}>
              Fermer
            </button>
          </div>
          <NetworkToolbar
            filters={filters}
            onChange={patch}
            counts={counts}
            searchLabel={copy.searchLabel}
            regions={regionOptions(entries)}
            categories={categoryOptions(kind, entries)}
            quartiers={quartierOptions(entries)}
          />
          <div className="grid">
            {rows.map((entry) => (
              <NetworkCard
                key={entry.id}
                kind={kind}
                entry={entry}
                selected={selected.has(entry.id)}
                onSelect={(on) => select(entry.id, on)}
                onReintegrate={() => bringBack(entry)}
                busy={reintegrate.isPending}
              />
            ))}
          </div>
          {rows.length === 0 && (
            <div className="empty">{emptyText(kind, filters.tab, counts.excluded)}</div>
          )}
          <div className="count">{countLine(kind, rows.length, counts.total)}</div>
        </section>
      </div>

      <NetworkDock
        label={copy.dockLabel}
        text={dockText(kind, picked.length)}
        action={copy.dockAction}
        show={picked.length > 0}
        onCancel={() => setSelected(new Set())}
        onConfirm={() => setConfirming(true)}
      />
      <NetworkConfirmDialog
        kind={kind}
        copy={copy}
        open={confirming && picked.length > 0}
        picked={picked}
        pending={exclude.isPending}
        onClose={closeDialog}
        onConfirm={confirm}
      />
    </>
  );
}
