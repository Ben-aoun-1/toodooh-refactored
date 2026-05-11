import React, { useEffect, useState } from 'react';
import { adminScreensService } from '../../services/admin-screens.service';
import type { AdminLocation, AdminLocationStatus } from '../../services/admin-screens.service';
import AdminLayout from '../../components/admin/AdminLayout';
import AffluenceModal from '../../components/admin/AffluenceModal';
import { ChevronDown, ChevronRight, MapPin, Monitor, Search, Activity } from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function ScreenManagement() {
  const [locations, setLocations] = useState<AdminLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AdminLocationStatus>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [selectedLocationForAffluence, setSelectedLocationForAffluence] =
    useState<AdminLocation | null>(null);
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);

  useEffect(() => {
    loadOwners();
  }, []);

  useEffect(() => {
    loadLocations();
  }, [currentPage, statusFilter, ownerFilter, searchTerm, itemsPerPage]);

  const loadOwners = async () => {
    try {
      const ownersData = await adminScreensService.getOwners();
      console.log('✅ Propriétaires chargés:', ownersData.length);
      setOwners(ownersData.map((o) => ({ id: o.user_id, name: o.business_name })));
    } catch (error) {
      console.error('Error loading owners:', error);
      toast.error('Erreur lors du chargement des propriétaires');
    }
  };

  const loadLocations = async () => {
    try {
      setLoading(true);
      const result = await adminScreensService.getLocationsWithScreens(currentPage, itemsPerPage, {
        status: statusFilter !== 'all' ? statusFilter : undefined,
        owner_id: ownerFilter !== 'all' ? ownerFilter : undefined,
        search: searchTerm || undefined,
      });
      setLocations(result.locations);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error: any) {
      console.error('Error loading locations:', error);
      toast.error('Erreur lors du chargement des localités');
    } finally {
      setLoading(false);
    }
  };

  const getLocationStatusBadge = (status: AdminLocationStatus) => {
    const config = {
      active: 'bg-green-100 text-green-800',
      maintenance: 'bg-yellow-100 text-yellow-800',
      inactive: 'bg-gray-100 text-gray-800',
      unavailable: 'bg-red-100 text-red-800',
      no_screens: 'bg-slate-100 text-slate-700',
    };
    const label = {
      active: 'Active',
      maintenance: 'Maintenance',
      inactive: 'Inactive',
      unavailable: 'Indisponible',
      no_screens: 'Sans écran',
    };
    return (
      <span
        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${config[status]}`}
      >
        {label[status]}
      </span>
    );
  };

  const getScreenStatusBadge = (status: string) => {
    const classes =
      status === 'active'
        ? 'bg-green-100 text-green-800'
        : status === 'maintenance'
          ? 'bg-yellow-100 text-yellow-800'
          : status === 'inactive'
            ? 'bg-gray-100 text-gray-800'
            : 'bg-red-100 text-red-800';
    const label =
      status === 'active'
        ? 'Actif'
        : status === 'maintenance'
          ? 'Maintenance'
          : status === 'inactive'
            ? 'Inactif'
            : 'Indisponible';
    return (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${classes}`}>
        {label}
      </span>
    );
  };

  return (
    <AdminLayout
      title="Gestion des Localités et écrans"
      subtitle="Affichez les localités, leurs statuts et l'affluence par localité"
    >
      <div className="space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Recherche */}
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Rechercher une localité..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Filtre par statut */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | AdminLocationStatus)}
              className="px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">Tous les statuts</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="maintenance">Maintenance</option>
              <option value="unavailable">Indisponible</option>
              <option value="no_screens">Sans écran</option>
            </select>

            {/* Filtre par propriétaire */}
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">Tous les propriétaires</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>

            {/* Pagination */}
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(parseInt(e.target.value));
                setCurrentPage(1);
              }}
              className="px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="10">10 par page</option>
              <option value="20">20 par page</option>
              <option value="50">50 par page</option>
              <option value="100">100 par page</option>
            </select>
          </div>

          {/* Résumé des filtres */}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {total} localité{total > 1 ? 's' : ''} trouvée{total > 1 ? 's' : ''}
              {(statusFilter !== 'all' || ownerFilter !== 'all' || searchTerm) && (
                <button
                  onClick={() => {
                    setStatusFilter('all');
                    setOwnerFilter('all');
                    setSearchTerm('');
                    setCurrentPage(1);
                  }}
                  className="ml-2 text-blue-600 hover:text-blue-800 underline"
                >
                  Réinitialiser les filtres
                </button>
              )}
            </div>
            <div className="text-sm text-gray-600">
              Page {currentPage} sur {totalPages}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Chargement...</p>
              </div>
            </div>
          ) : locations.length === 0 ? (
            <div className="text-center py-12">
              <Monitor className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">Aucune localité</h3>
              <p className="mt-1 text-sm text-gray-500">Aucune localité trouvée</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Localité
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Propriétaire
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Statut
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Écrans
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      En ligne
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Revenu mensuel
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {locations.map((location) => {
                    const isExpanded = expandedLocationId === location.id;
                    return (
                      <React.Fragment key={location.id}>
                        <tr className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <button
                              onClick={() => setExpandedLocationId(isExpanded ? null : location.id)}
                              className="flex items-center text-left"
                            >
                              {isExpanded ? (
                                <ChevronDown className="mr-2 h-4 w-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="mr-2 h-4 w-4 text-gray-500" />
                              )}
                              <div>
                                <div className="text-sm font-medium text-gray-900">
                                  {location.name}
                                </div>
                                <div className="text-sm text-gray-500 flex items-center mt-1">
                                  <MapPin className="w-3 h-3 mr-1" />
                                  {location.address || 'Adresse non renseignée'}
                                </div>
                              </div>
                            </button>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {location.owner_business_name}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getLocationStatusBadge(location.status)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {location.screens_count}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                location.online_screens_count > 0
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {location.online_screens_count}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {location.monthly_revenue.toFixed(2)} TND
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => setSelectedLocationForAffluence(location)}
                              className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                              title="Gérer l'affluence de la localité"
                            >
                              <Activity className="w-5 h-5" />
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} className="bg-gray-50 px-6 py-4">
                              {location.screens.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
                                  Aucun écran rattaché à cette localité.
                                </div>
                              ) : (
                                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                                  <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                          Écran
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                          Type
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                          Statut
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                          Connexion
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                          Revenu
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                      {location.screens.map((screen) => (
                                        <tr key={screen.id}>
                                          <td className="px-4 py-2 text-sm text-gray-900">
                                            {screen.name}
                                          </td>
                                          <td className="px-4 py-2 text-sm text-gray-700">
                                            {screen.screen_type.toUpperCase()}
                                          </td>
                                          <td className="px-4 py-2 text-sm">
                                            {getScreenStatusBadge(screen.status)}
                                          </td>
                                          <td className="px-4 py-2 text-sm text-gray-700">
                                            {screen.is_online ? 'En ligne' : 'Hors ligne'}
                                          </td>
                                          <td className="px-4 py-2 text-sm text-gray-700">
                                            {(Number(screen.monthly_revenue) || 0).toFixed(2)} TND
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Affichage de{' '}
                    <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> à{' '}
                    <span className="font-medium">
                      {Math.min(currentPage * itemsPerPage, total)}
                    </span>{' '}
                    sur <span className="font-medium">{total}</span> résultats
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                    {/* Première page */}
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                      title="Première page"
                    >
                      «
                    </button>

                    {/* Précédent */}
                    <button
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-2 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      ‹
                    </button>

                    {/* Pages */}
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNumber;
                      if (totalPages <= 5) {
                        pageNumber = i + 1;
                      } else if (currentPage <= 3) {
                        pageNumber = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNumber = totalPages - 4 + i;
                      } else {
                        pageNumber = currentPage - 2 + i;
                      }
                      return (
                        <button
                          key={i}
                          onClick={() => setCurrentPage(pageNumber)}
                          className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                            pageNumber === currentPage
                              ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                              : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {pageNumber}
                        </button>
                      );
                    })}

                    {/* Suivant */}
                    <button
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      className="relative inline-flex items-center px-2 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      ›
                    </button>

                    {/* Dernière page */}
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                      title="Dernière page"
                    >
                      »
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal d'affluence de localité */}
        {selectedLocationForAffluence && (
          <AffluenceModal
            location={selectedLocationForAffluence}
            onClose={() => setSelectedLocationForAffluence(null)}
          />
        )}
      </div>
    </AdminLayout>
  );
}
