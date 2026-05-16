

import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
export default function OwnerMaintenance() {
  return (
    <div className="min-h-screen bg-white flex">
      <OwnerNavigation />
      <div className="flex-1 flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold mb-4">Maintenance</h1>
        <p className="text-gray-600">
          Page de gestion de la maintenance propriétaire (à compléter).
        </p>
      </div>
    </div>
  );
}
