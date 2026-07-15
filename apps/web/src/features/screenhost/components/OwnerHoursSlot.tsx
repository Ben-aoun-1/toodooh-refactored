import { useScreenhostsMine } from '../hooks/useScreenhostsMine';
import { useUpdateScreenhostHours } from '../hooks/useUpdateScreenhostHours';

import ScreenhostHoursEditorCard from './ScreenhostHoursEditorCard';

/**
 * H2 — owner-only « Horaires d'ouverture » sub-tab, passed to the shared `ProfileSettings` via its
 * `hoursSlot` prop (the `wifiSlot` pattern). Lists every venue the owner owns and gives each its
 * own hours editor — fleet owners get one card per establishment, an individual owner gets one.
 */
export default function OwnerHoursSlot({ userId }: { userId: string }) {
  const { data: screenhosts, isLoading, isError } = useScreenhostsMine(userId);
  const updateHours = useUpdateScreenhostHours();

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
        Définissez la plage horaire de diffusion de chaque lieu (une plage unique, appliquée à toute
        la semaine). Ces horaires déterminent l'éligibilité aux campagnes et la heatmap de vos
        rapports.
      </p>
      {screenhosts.map((sh) => (
        <ScreenhostHoursEditorCard
          key={sh.id}
          screenhost={sh}
          onSave={(patch) =>
            updateHours
              .mutateAsync({ userId, screenhostId: sh.id, hours: patch })
              .then(() => undefined)
          }
        />
      ))}
    </div>
  );
}
