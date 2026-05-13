import {
  Calendar,
  Search,
  Filter,
  Eye,
  Edit,
  Trash2,
  Plus,
  Star,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';

import AdminLayout from '../../components/admin/AdminLayout';
import { logger } from '../../lib/logger';
import { supabase } from '../../lib/supabase';
import { adminEventsService } from '../../services/admin-events.service';
import { useAdminStore } from '../../stores/admin.store';
import { SpecialEvent, CreateEventDTO, EventStats } from '../../types/event';

const log = logger.child({ module: 'EventManagement' });

const EVENT_IMAGES_BUCKET = 'event-images';

export default function EventManagement() {
  const { admin } = useAdminStore();
  const [events, setEvents] = useState<SpecialEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<SpecialEvent | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [stats, setStats] = useState<EventStats>({
    total_events: 0,
    active_events: 0,
    upcoming_events: 0,
    past_events: 0,
    featured_events: 0,
  });

  const [formData, setFormData] = useState<CreateEventDTO>({
    name: '',
    description: '',
    event_type: 'concert',
    start_date: '',
    end_date: '',
    location: '',
    city: '',
    address: '',
    category: 'cultural',
    is_active: true,
    is_featured: false,
    expected_attendance: undefined,
    target_audience: '',
    image_url: '',
    pricing_multiplier: 1.0,
    priority_level: 5,
  });

  // Charger les événements
  useEffect(() => {
    loadEvents();
    loadStats();
  }, []);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const eventsData = await adminEventsService.getEvents();
      setEvents(eventsData);
    } catch (error: any) {
      toast.error(`Erreur lors du chargement des événements: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const statsData = await adminEventsService.getStats();
      setStats(statsData);
    } catch (error) {
      log.error({ error }, 'Error loading stats');
    }
  };

  const filteredEvents = events.filter((event) => {
    const matchesSearch =
      event.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      event.city?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      event.location?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = typeFilter === 'all' || event.event_type === typeFilter;

    const now = new Date();
    const startDate = new Date(event.start_date);
    const endDate = new Date(event.end_date);

    let matchesStatus = true;
    if (statusFilter === 'upcoming') {
      matchesStatus = startDate > now;
    } else if (statusFilter === 'ongoing') {
      matchesStatus = startDate <= now && endDate >= now;
    } else if (statusFilter === 'past') {
      matchesStatus = endDate < now;
    } else if (statusFilter === 'active') {
      matchesStatus = event.is_active;
    } else if (statusFilter === 'inactive') {
      matchesStatus = !event.is_active;
    }

    return matchesSearch && matchesType && matchesStatus;
  });

  // Pagination
  const totalPages = Math.ceil(filteredEvents.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedEvents = filteredEvents.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, typeFilter, statusFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admin?.id) return;

    try {
      // Validation côté client
      const startDate = new Date(formData.start_date);
      const endDate = new Date(formData.end_date);

      if (endDate <= startDate) {
        toast.error('La date de fin doit être après la date de début');
        return;
      }

      // Convertir les dates au format ISO avec timezone
      const eventData = {
        ...formData,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
      };

      const newEvent = await adminEventsService.createEvent(eventData, admin.id);
      if (newEvent) {
        setEvents([newEvent, ...events]);
        toast.success('Événement créé avec succès');
        setShowCreateModal(false);
        resetForm();
        loadStats();
      }
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de la création');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent) return;

    try {
      // Convertir les dates au format ISO avec timezone
      const eventData = {
        ...formData,
        start_date: new Date(formData.start_date).toISOString(),
        end_date: new Date(formData.end_date).toISOString(),
      };

      const success = await adminEventsService.updateEvent(selectedEvent.id, eventData);
      if (success) {
        setEvents(
          events.map((evt) => (evt.id === selectedEvent.id ? { ...evt, ...eventData } : evt)),
        );
        toast.success('Événement modifié avec succès');
        setShowEditModal(false);
        setSelectedEvent(null);
        resetForm();
      }
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de la modification');
    }
  };

  const handleDelete = async () => {
    if (!selectedEvent) return;

    try {
      const success = await adminEventsService.deleteEvent(selectedEvent.id);
      if (success) {
        setEvents(events.filter((evt) => evt.id !== selectedEvent.id));
        toast.success('Événement supprimé');
        setShowDeleteModal(false);
        setSelectedEvent(null);
        loadStats();
      }
    } catch (error) {
      toast.error('Erreur lors de la suppression');
    }
  };

  const handleToggleStatus = async (eventId: string, isActive: boolean) => {
    try {
      const success = await adminEventsService.toggleEventStatus(eventId, isActive);
      if (success) {
        setEvents(
          events.map((evt) => (evt.id === eventId ? { ...evt, is_active: isActive } : evt)),
        );
        toast.success(isActive ? 'Événement activé' : 'Événement désactivé');
        loadStats();
      }
    } catch (error) {
      toast.error('Erreur lors du changement de statut');
    }
  };

  const handleToggleFeatured = async (eventId: string, isFeatured: boolean) => {
    try {
      const success = await adminEventsService.toggleFeatured(eventId, isFeatured);
      if (success) {
        setEvents(
          events.map((evt) => (evt.id === eventId ? { ...evt, is_featured: isFeatured } : evt)),
        );
        toast.success(
          isFeatured ? 'Événement mis en avant' : 'Événement retiré de la mise en avant',
        );
        loadStats();
      }
    } catch (error) {
      toast.error('Erreur lors du changement de statut');
    }
  };

  const openEditModal = (event: SpecialEvent) => {
    setSelectedEvent(event);
    setFormData({
      name: event.name,
      description: event.description || '',
      event_type: event.event_type,
      start_date: event.start_date.substring(0, 16), // Format: YYYY-MM-DDTHH:mm
      end_date: event.end_date.substring(0, 16), // Format: YYYY-MM-DDTHH:mm
      location: event.location,
      city: event.city,
      address: event.address || '',
      category: event.category,
      is_active: event.is_active,
      is_featured: event.is_featured,
      expected_attendance: event.expected_attendance,
      image_url: event.image_url || '',
      target_audience: event.target_audience || '',
      pricing_multiplier: event.pricing_multiplier,
      priority_level: event.priority_level,
    });
    setShowEditModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      event_type: 'concert',
      start_date: '',
      end_date: '',
      location: '',
      city: '',
      address: '',
      category: 'cultural',
      is_active: true,
      is_featured: false,
      expected_attendance: undefined,
      target_audience: '',
      image_url: '',
      pricing_multiplier: 1.0,
      priority_level: 5,
    });
  };

  const getEventTypeBadge = (type: string) => {
    const typeConfig: any = {
      concert: { color: 'bg-purple-100 text-purple-800', text: 'Concert' },
      sport: { color: 'bg-blue-100 text-blue-800', text: 'Sport' },
      festival: { color: 'bg-pink-100 text-pink-800', text: 'Festival' },
      ramadan: { color: 'bg-amber-100 text-amber-900', text: 'Ramadan' },
      culture: { color: 'bg-purple-100 text-purple-800', text: 'Culture' },
      conference: { color: 'bg-indigo-100 text-indigo-800', text: 'Conférence' },
      exposition: { color: 'bg-green-100 text-green-800', text: 'Exposition' },
      salon: { color: 'bg-orange-100 text-orange-800', text: 'Salon' },
      autre: { color: 'bg-gray-100 text-gray-800', text: 'Autre' },
    };
    const config = typeConfig[type] || typeConfig.autre;
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}
      >
        {config.text}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getEventStatus = (event: SpecialEvent) => {
    const now = new Date();
    const start = new Date(event.start_date);
    const end = new Date(event.end_date);

    if (!event.is_active)
      return { color: 'bg-gray-100 text-gray-800', icon: XCircle, text: 'Inactif' };
    if (start > now) return { color: 'bg-blue-100 text-blue-800', icon: Clock, text: 'À venir' };
    if (end < now)
      return { color: 'bg-gray-100 text-gray-800', icon: CheckCircle, text: 'Terminé' };
    return { color: 'bg-green-100 text-green-800', icon: CheckCircle, text: 'En cours' };
  };

  if (loading) {
    return (
      <AdminLayout title="Gestion des Événements" subtitle="Créez et gérez les événements spéciaux">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement des événements...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // Vérifier que c'est bien le super admin
  if (admin?.role !== 'superadmin') {
    return (
      <AdminLayout title="Accès Refusé">
        <div className="flex flex-col items-center justify-center h-full text-center p-6">
          <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Accès Refusé</h2>
          <p className="text-gray-600">Seul le Super Admin peut gérer les événements spéciaux.</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Gestion des Événements" subtitle="Créez et gérez les événements spéciaux">
      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total_events}</p>
            </div>
            <Calendar className="h-8 w-8 text-gray-400" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Actifs</p>
              <p className="text-2xl font-bold text-gray-900">{stats.active_events}</p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">À venir</p>
              <p className="text-2xl font-bold text-gray-900">{stats.upcoming_events}</p>
            </div>
            <Clock className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Passés</p>
              <p className="text-2xl font-bold text-gray-900">{stats.past_events}</p>
            </div>
            <XCircle className="h-8 w-8 text-gray-400" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">En avant</p>
              <p className="text-2xl font-bold text-gray-900">{stats.featured_events}</p>
            </div>
            <Star className="h-8 w-8 text-yellow-500" />
          </div>
        </div>
      </div>

      {/* Bouton créer + Filtres */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <button
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            className="inline-flex items-center px-4 py-2 bg-[#00B3A6] text-white rounded-lg hover:bg-[#00B3A6]/90 transition-colors"
          >
            <Plus className="h-5 w-5 mr-2" />
            Nouvel événement
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Recherche */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher par nom, ville ou lieu..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
            />
          </div>

          {/* Filtre type */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <select
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">Tous les types</option>
              <option value="concert">Concert</option>
              <option value="sport">Sport</option>
              <option value="festival">Festival</option>
              <option value="conference">Conférence</option>
              <option value="exposition">Exposition</option>
              <option value="salon">Salon</option>
              <option value="autre">Autre</option>
            </select>
          </div>

          {/* Filtre statut */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <select
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Tous les statuts</option>
              <option value="upcoming">À venir</option>
              <option value="ongoing">En cours</option>
              <option value="past">Passés</option>
              <option value="active">Actifs</option>
              <option value="inactive">Inactifs</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tableau des événements */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Événement
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Dates
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lieu
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campagnes
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedEvents.map((event) => {
                const status = getEventStatus(event);
                const StatusIcon = status.icon;

                return (
                  <tr key={event.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        {event.is_featured && (
                          <Star className="h-5 w-5 text-yellow-500 mr-2 fill-yellow-500" />
                        )}
                        <div>
                          <div className="text-sm font-medium text-gray-900">{event.name}</div>
                          {event.description && (
                            <div className="text-xs text-gray-500 truncate max-w-xs">
                              {event.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getEventTypeBadge(event.event_type)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{formatDate(event.start_date)}</div>
                      <div className="text-xs text-gray-500">{formatDate(event.end_date)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{event.city}</div>
                      <div className="text-xs text-gray-500">{event.location}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                      >
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {status.text}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {event.campaigns_count || 0} campagne(s)
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => {
                            setSelectedEvent(event);
                            setShowDetailsModal(true);
                          }}
                          className="text-indigo-600 hover:text-indigo-900 p-2 rounded-md hover:bg-gray-100"
                          title="Voir détails"
                        >
                          <Eye className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => openEditModal(event)}
                          className="text-blue-600 hover:text-blue-900 p-2 rounded-md hover:bg-blue-50"
                          title="Modifier"
                        >
                          <Edit className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleToggleFeatured(event.id, !event.is_featured)}
                          className={`p-2 rounded-md ${event.is_featured ? 'text-yellow-600 hover:text-yellow-900 hover:bg-yellow-50' : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'}`}
                          title={
                            event.is_featured ? 'Retirer de la mise en avant' : 'Mettre en avant'
                          }
                        >
                          <Star
                            className={`h-5 w-5 ${event.is_featured ? 'fill-yellow-500' : ''}`}
                          />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedEvent(event);
                            setShowDeleteModal(true);
                          }}
                          className="text-red-600 hover:text-red-900 p-2 rounded-md hover:bg-red-50"
                          title="Supprimer"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Précédent
              </button>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Suivant
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Affichage de <span className="font-medium">{startIndex + 1}</span> à{' '}
                  <span className="font-medium">{Math.min(endIndex, filteredEvents.length)}</span>{' '}
                  sur <span className="font-medium">{filteredEvents.length}</span> résultats
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    ‹
                  </button>
                  {[...Array(totalPages)].map((_, idx) => (
                    <button
                      key={idx + 1}
                      onClick={() => setCurrentPage(idx + 1)}
                      className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                        currentPage === idx + 1
                          ? 'z-10 bg-[#00B3A6] border-[#00B3A6] text-white'
                          : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    ›
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de création */}
      {showCreateModal && (
        <EventFormModal
          title="Créer un nouvel événement"
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleCreate}
          onClose={() => {
            setShowCreateModal(false);
            resetForm();
          }}
        />
      )}

      {/* Modal de modification */}
      {showEditModal && selectedEvent && (
        <EventFormModal
          title="Modifier l'événement"
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleUpdate}
          onClose={() => {
            setShowEditModal(false);
            setSelectedEvent(null);
            resetForm();
          }}
          isEdit
        />
      )}

      {/* Modal de suppression */}
      {showDeleteModal && selectedEvent && (
        <DeleteConfirmModal
          eventName={selectedEvent.name}
          onConfirm={handleDelete}
          onCancel={() => {
            setShowDeleteModal(false);
            setSelectedEvent(null);
          }}
        />
      )}

      {/* Modal de détails */}
      {showDetailsModal && selectedEvent && (
        <EventDetailsModal
          event={selectedEvent}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedEvent(null);
          }}
        />
      )}
    </AdminLayout>
  );
}

// Composant upload d'image pour l'événement
function EventImageUpload({
  imageUrl,
  onImageUrlChange,
  disabled,
}: {
  imageUrl: string;
  onImageUrlChange: (url: string) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner une image (JPG, PNG, GIF, WebP).');
      return;
    }
    try {
      setUploading(true);
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(EVENT_IMAGES_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

      if (uploadError) {
        toast.error(uploadError.message || "Erreur lors de l'upload.");
        return;
      }

      const { data: urlData } = supabase.storage.from(EVENT_IMAGES_BUCKET).getPublicUrl(path);

      onImageUrlChange(urlData.publicUrl);
      toast.success('Image uploadée.');
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'upload.");
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="md:col-span-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Image de l&apos;événement
      </label>
      <div className="flex flex-col gap-2">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={disabled || uploading}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#00B3A6] file:text-white hover:file:bg-[#00B3A6]/90"
        />
        {uploading && <p className="text-xs text-gray-500">Upload en cours...</p>}
        {imageUrl && (
          <div className="mt-2 flex items-center gap-3">
            <img
              src={imageUrl}
              alt="Aperçu"
              className="h-20 w-20 rounded-lg object-cover border border-gray-200"
            />
            <button
              type="button"
              onClick={() => onImageUrlChange('')}
              className="text-sm text-red-600 hover:underline"
            >
              Supprimer l&apos;image
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Composant Modal de formulaire (Création/Modification)
interface EventFormModalProps {
  title: string;
  formData: CreateEventDTO;
  setFormData: (data: CreateEventDTO) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  isEdit?: boolean;
}

function EventFormModal({
  title,
  formData,
  setFormData,
  onSubmit,
  onClose,
  isEdit,
}: EventFormModalProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 opacity-75"
          onClick={onClose}
        ></div>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
          <form onSubmit={onSubmit}>
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <div className="mb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900">{title}</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Nom */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nom de l'événement *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  />
                </div>

                {/* Description */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  />
                </div>

                {/* Image (upload) */}
                <EventImageUpload
                  imageUrl={formData.image_url || ''}
                  onImageUrlChange={(url) => setFormData({ ...formData, image_url: url })}
                  disabled={false}
                />

                {/* Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Type d'événement *
                  </label>
                  <select
                    required
                    value={formData.event_type}
                    onChange={(e) =>
                      setFormData({ ...formData, event_type: e.target.value as any })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  >
                    <option value="concert">Concert</option>
                    <option value="sport">Sport</option>
                    <option value="festival">Festival</option>
                    <option value="ramadan">Ramadan</option>
                    <option value="culture">Culture</option>
                    <option value="conference">Conférence</option>
                    <option value="exposition">Exposition</option>
                    <option value="salon">Salon</option>
                    <option value="autre">Autre</option>
                  </select>
                </div>

                {/* Catégorie */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  >
                    <option value="commercial">Commercial</option>
                    <option value="cultural">Culturel</option>
                    <option value="promotional">Promotionnel</option>
                    <option value="institutional">Institutionnel</option>
                  </select>
                </div>

                {/* Date et heure de début */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date et heure de début *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  />
                </div>

                {/* Date et heure de fin */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date et heure de fin *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  />
                </div>

                {/* Ville */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ville *</label>
                  <input
                    type="text"
                    required
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  />
                </div>

                {/* Lieu */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lieu *</label>
                  <input
                    type="text"
                    required
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                    placeholder="Ex: Stade de France, Zénith de Paris..."
                  />
                </div>

                {/* Adresse complète */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Adresse complète
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  />
                </div>

                {/* Audience attendue */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Audience attendue
                  </label>
                  <input
                    type="number"
                    value={formData.expected_attendance || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        expected_attendance: e.target.value ? parseInt(e.target.value) : undefined,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                    placeholder="Nombre de personnes"
                  />
                </div>

                {/* Priorité */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Niveau de priorité (1-10)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.priority_level}
                    onChange={(e) =>
                      setFormData({ ...formData, priority_level: parseInt(e.target.value) })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                  />
                </div>

                {/* Checkboxes */}
                <div className="md:col-span-2 flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="h-4 w-4 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Actif</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.is_featured}
                      onChange={(e) => setFormData({ ...formData, is_featured: e.target.checked })}
                      className="h-4 w-4 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Mettre en avant</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-2">
              <button
                type="submit"
                className="w-full inline-flex justify-center items-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-[#00B3A6] text-base font-medium text-white hover:bg-[#00B3A6]/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00B3A6] sm:w-auto sm:text-sm"
              >
                {isEdit ? 'Modifier' : 'Créer'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00B3A6] sm:mt-0 sm:w-auto sm:text-sm"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Composant Modal de confirmation de suppression
interface DeleteConfirmModalProps {
  eventName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmModal({ eventName, onConfirm, onCancel }: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 opacity-75"
          onClick={onCancel}
        ></div>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                <Trash2 className="h-6 w-6 text-red-600" />
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Supprimer l'événement
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-gray-500">
                    Êtes-vous sûr de vouloir supprimer l'événement <strong>"{eventName}"</strong> ?
                    Cette action est irréversible.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-2">
            <button
              onClick={onConfirm}
              className="w-full inline-flex justify-center items-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:w-auto sm:text-sm"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Supprimer
            </button>
            <button
              onClick={onCancel}
              className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:w-auto sm:text-sm"
            >
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Composant Modal de détails
interface EventDetailsModalProps {
  event: SpecialEvent;
  onClose: () => void;
}

function EventDetailsModal({ event, onClose }: EventDetailsModalProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 opacity-75"
          onClick={onClose}
        ></div>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-[#00B3A6] sm:mx-0 sm:h-10 sm:w-10">
                <Calendar className="h-6 w-6 text-white" />
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4 flex items-center">
                  {event.name}
                  {event.is_featured && (
                    <Star className="ml-2 h-5 w-5 text-yellow-500 fill-yellow-500" />
                  )}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-gray-900 mb-2">Informations générales</h4>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-600">Type:</span>{' '}
                        <span className="font-medium">{event.event_type}</span>
                      </div>
                      {event.description && (
                        <div>
                          <span className="text-gray-600">Description:</span>{' '}
                          <p className="mt-1">{event.description}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-600">Catégorie:</span>{' '}
                        <span className="font-medium">{event.category}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-gray-900 mb-2">Dates et lieu</h4>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-600">Début:</span>{' '}
                        <span className="font-medium">{formatDate(event.start_date)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Fin:</span>{' '}
                        <span className="font-medium">{formatDate(event.end_date)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Ville:</span>{' '}
                        <span className="font-medium">{event.city}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Lieu:</span>{' '}
                        <span className="font-medium">{event.location}</span>
                      </div>
                    </div>
                  </div>

                  {event.expected_attendance && (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <h4 className="font-semibold text-gray-900 mb-2">Audience</h4>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-gray-600">Attendus:</span>{' '}
                          <span className="font-medium">
                            {event.expected_attendance.toLocaleString('fr-FR')} personnes
                          </span>
                        </div>
                        {event.target_audience && (
                          <div>
                            <span className="text-gray-600">Cible:</span>{' '}
                            <p className="mt-1">{event.target_audience}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-gray-900 mb-2">Campagnes</h4>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-600">Nombre:</span>{' '}
                        <span className="font-medium">{event.campaigns_count || 0}</span>
                      </div>
                      {event.campaign_names && (
                        <div>
                          <span className="text-gray-600">Noms:</span>{' '}
                          <p className="mt-1">{event.campaign_names}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              onClick={onClose}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-[#00B3A6] text-base font-medium text-white hover:bg-[#00B3A6]/90 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
