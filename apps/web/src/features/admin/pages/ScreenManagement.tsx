import { ChevronDown, ChevronRight, ExternalLink, MapPin, Monitor, Search } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '@/features/admin/components/AdminLayout';
import AdminLocationsPagination from '@/features/admin/components/AdminLocationsPagination';
import { useAdminLocations, useScreenOwners } from '@/features/admin/hooks/useAdminScreens';
import { formatAdminDateTime } from '@/features/admin/lib/admin-dates';
import {
  LOCATION_STATUS_BADGE,
  LOCATION_STATUS_FILTER_OPTIONS,
  SCREEN_STATUS_BADGE,
  screenInstallNote,
  screenStatusOf,
  screensCountLabel,
} from '@/features/admin/lib/venue-screens';
import type {
  AdminLocationStatus,
  AdminScreenRow,
} from '@/features/admin/services/admin-screens.service';

// Affluence is HUB-OWNED (ruling 2026-08-26): the hub's PAX readings + its manual grid are the ONE
// merged truth, pushed into toodooh's read-only screenhost_affluence mirror. The legacy
// AffluenceModal edited a Supabase table nothing reads any more — the action now links to the hub.
const HUB_URL = 'https://hub.too-dooh.com';

const BADGE_CLASSES = 'inline-flex rounded-full px-2 py-1 text-xs font-semibold';

function LocationStatusBadge({ status }: { status: AdminLocationStatus }) {
  const badge = LOCATION_STATUS_BADGE[status];
  return <span className={`${BADGE_CLASSES} ${badge.classes}`}>{badge.label}</span>;
}

/** ADM-FIX1 — connected / offline / never, the vocabulary the rest of the product already uses. */
function ScreenStatusBadge({ screen }: { screen: AdminScreenRow }) {
  const badge = SCREEN_STATUS_BADGE[screenStatusOf(screen)];
  return <span className={`${BADGE_CLASSES} ${badge.classes}`}>{badge.label}</span>;
}

function ScreensTable({ screens }: { screens: AdminScreenRow[] }) {
  if (screens.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
        Aucun écran rattaché à cette localité.
      </div>
    );
  }
  const th = 'px-4 py-2 text-left text-xs font-medium uppercase text-gray-500';
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className={th}>Écran</th>
            <th className={th}>Statut</th>
            <th className={th}>Dernier signal</th>
            <th className={th}>Appairé le</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {screens.map((screen) => {
            const installNote = screenInstallNote(screen);
            return (
              <tr key={screen.id}>
                <td className="px-4 py-2 text-sm text-gray-900">{screen.name}</td>
                <td className="px-4 py-2 text-sm">
                  <ScreenStatusBadge screen={screen} />
                  {installNote && <div className="mt-1 text-xs text-gray-500">{installNote}</div>}
                </td>
                <td className="px-4 py-2 text-sm text-gray-700">
                  {screen.last_seen_at ? formatAdminDateTime(screen.last_seen_at) : '—'}
                </td>
                <td className="px-4 py-2 text-sm text-gray-700">
                  {screen.paired_at ? formatAdminDateTime(screen.paired_at) : 'Jamais'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ScreenManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AdminLocationStatus>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);

  const { locations, total, totalPages, loading, isError } = useAdminLocations({
    status: statusFilter,
    ownerId: ownerFilter,
    search: searchTerm,
    page: currentPage,
    perPage: itemsPerPage,
  });
  const { owners } = useScreenOwners();

  useEffect(() => {
    if (isError) toast.error('Erreur lors du chargement des localités');
  }, [isError]);

  const selectClasses =
    'px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent';
  const th = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase';
  const hasFilters = statusFilter !== 'all' || ownerFilter !== 'all' || searchTerm !== '';

  return (
    <AdminLayout
      title="Gestion des Localités et écrans"
      subtitle="Affichez les localités, leurs écrans et leur état de connexion"
    >
      <div className="space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Rechercher une localité..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'all' | AdminLocationStatus);
                setCurrentPage(1);
              }}
              className={selectClasses}
            >
              {LOCATION_STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={ownerFilter}
              onChange={(e) => {
                setOwnerFilter(e.target.value);
                setCurrentPage(1);
              }}
              className={selectClasses}
            >
              <option value="all">Tous les propriétaires</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.business_name}
                </option>
              ))}
            </select>

            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(parseInt(e.target.value));
                setCurrentPage(1);
              }}
              className={selectClasses}
            >
              <option value="10">10 par page</option>
              <option value="20">20 par page</option>
              <option value="50">50 par page</option>
              <option value="100">100 par page</option>
            </select>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {total} localité{total > 1 ? 's' : ''} trouvée{total > 1 ? 's' : ''}
              {hasFilters && (
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
              <p className="mt-1 text-sm text-gray-500">
                {isError ? 'Chargement impossible' : 'Aucune localité trouvée'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className={th}>Localité</th>
                    <th className={th}>Propriétaire</th>
                    <th className={th}>Statut</th>
                    <th className={th}>Écrans</th>
                    <th className={th}>En ligne</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Affluence
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {locations.map((location) => {
                    const isExpanded = expandedLocationId === location.id;
                    const address = [location.address, location.city].filter(Boolean).join(', ');
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
                                  {address || 'Adresse non renseignée'}
                                </div>
                              </div>
                            </button>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {location.owner_business_name ?? '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <LocationStatusBadge status={location.status} />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {screensCountLabel(
                                location.screens_count,
                                location.installed_screens_count,
                              )}
                            </div>
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
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <a
                              href={HUB_URL}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                              title="L'affluence se gère dans le hub"
                            >
                              Gérer dans le hub
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="bg-gray-50 px-6 py-4">
                              <ScreensTable screens={location.screens} />
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

          <AdminLocationsPagination
            currentPage={currentPage}
            totalPages={totalPages}
            itemsPerPage={itemsPerPage}
            total={total}
            onPageChange={setCurrentPage}
          />
        </div>
      </div>
    </AdminLayout>
  );
}
