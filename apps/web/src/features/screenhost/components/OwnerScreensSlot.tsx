import { useScreenhostsMine } from '../hooks/useScreenhostsMine';
import { useUpdateScreenhostDeclaration } from '../hooks/useUpdateScreenhostDeclaration';
import { DECLARATION_HEADING, DECLARATION_INTRO } from '../lib/venue-declaration';

import ScreenhostDeclarationEditorCard from './ScreenhostDeclarationEditorCard';

/**
 * SCR-DECL1 — owner-only « Écrans et salles », passed to the shared `ProfileSettings` via its
 * `screensSlot` prop (the `hoursSlot` pattern) and shown under « Informations sur l'entreprise »,
 * where the Figma puts « Nombre d'écrans » / « Nombre de salles ». The declaration lives per VENUE,
 * so every venue gets its own card — a fleet owner one per établissement, an individual owner one.
 */
export default function OwnerScreensSlot({ userId }: { userId: string }) {
  const { data: screenhosts, isLoading, isError } = useScreenhostsMine(userId);
  const updateDeclaration = useUpdateScreenhostDeclaration();

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
    <div className="p-6 space-y-5 max-w-3xl border-t border-gray-100">
      <div className="space-y-1">
        <h3 className="font-semibold text-gray-900">{DECLARATION_HEADING}</h3>
        <p className="text-sm text-gray-500">{DECLARATION_INTRO}</p>
      </div>
      {screenhosts.map((sh) => (
        <ScreenhostDeclarationEditorCard
          key={sh.id}
          screenhost={sh}
          onSave={(patch) =>
            updateDeclaration
              .mutateAsync({ userId, screenhostId: sh.id, patch })
              .then(() => undefined)
          }
        />
      ))}
    </div>
  );
}
