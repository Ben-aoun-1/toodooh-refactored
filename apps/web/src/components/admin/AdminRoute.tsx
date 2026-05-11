import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';

import { useAdminStore } from '../../stores/admin.store';

interface AdminRouteProps {
  children: React.ReactNode;
  requiredRoles?: string[];
}

export default function AdminRoute({ children, requiredRoles = [] }: AdminRouteProps) {
  const { admin, initialized, initialize, loading } = useAdminStore();

  useEffect(() => {
    console.log('AdminRoute: useEffect triggered', { initialized, loading, admin: !!admin });
    if (!initialized && !loading) {
      console.log('AdminRoute: Calling initialize...');
      initialize();
    }
  }, [initialized, loading, initialize]);

  // Si on est en train de charger ou pas encore initialisé, afficher le loading
  if (loading || !initialized || (!admin && initialized)) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/admin-login" />;
  }

  // Vérifier les rôles requis (pour l'instant, on skip cette vérification)
  // if (requiredRoles.length > 0 && !requiredRoles.includes(admin.role?.name)) {
  //   return <Navigate to="/admin-dashboard" />;
  // }

  return <>{children}</>;
}
