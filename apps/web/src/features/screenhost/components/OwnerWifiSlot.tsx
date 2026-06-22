import { useRevealScreenhostWifi } from '../hooks/useRevealScreenhostWifi';
import { useScreenhostsMine } from '../hooks/useScreenhostsMine';
import { useUpdateScreenhostWifi } from '../hooks/useUpdateScreenhostWifi';

import ScreenhostWifiEditorCard from './ScreenhostWifiEditorCard';

/**
 * Owner-only "WiFi du lieu" sub-tab, passed to the shared `ProfileSettings` via its `wifiSlot`
 * prop (mirrors `bankSlot`). Lists every screenhost the owner owns and gives each its own editor
 * (the shared `ScreenhostWifiEditorCard`). A venue's WiFi can change (Kais 2026-06); saving
 * re-pushes the credentials to the hub server-side (handled by the API; nothing here waits on it).
 */
export default function OwnerWifiSlot({ userId }: { userId: string }) {
  const { data: screenhosts, isLoading, isError } = useScreenhostsMine(userId);
  const updateWifi = useUpdateScreenhostWifi();
  const revealWifi = useRevealScreenhostWifi();

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-primary border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return <div className="p-6 text-sm text-gray-600">Impossible de charger vos lieux.</div>;
  }

  if (!screenhosts || screenhosts.length === 0) {
    return <div className="p-6 text-sm text-gray-600">Aucun lieu enregistré pour le moment.</div>;
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <p className="text-sm text-gray-500">
        Mettez à jour le réseau WiFi de chaque lieu. Le décodeur utilise ces identifiants pour se
        connecter à Internet.
      </p>
      {screenhosts.map((sh) => (
        <ScreenhostWifiEditorCard
          key={sh.id}
          screenhost={sh}
          onSave={(patch) =>
            updateWifi
              .mutateAsync({ userId, screenhostId: sh.id, wifi: patch })
              .then(() => undefined)
          }
          onReveal={() => revealWifi.mutateAsync(sh.id).then((r) => r.wifi_password)}
        />
      ))}
    </div>
  );
}
