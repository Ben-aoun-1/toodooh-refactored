import { Video as VideoIcon, Search, Filter, Eye, Check, X, Clock, FileVideo } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation } from 'react-router-dom';

import AdminLayout from '../../components/admin/AdminLayout';
import { adminVideoService } from '../../services/admin-video.service';
import { useAdminStore } from '../../stores/admin.store';
import { Video, VideoValidationStats } from '../../types/video';

export default function VideoManagement() {
  const { admin } = useAdminStore();
  const location = useLocation();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'all',
  );

  // Détecter le filtre depuis l'URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('status');
    if (status === 'pending' || status === 'approved' || status === 'rejected') {
      setStatusFilter(status);
    }
  }, [location.search]);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [stats, setStats] = useState<VideoValidationStats>({
    total_videos: 0,
    pending_videos: 0,
    approved_videos: 0,
    rejected_videos: 0,
  });

  // Charger les vidéos et statistiques
  useEffect(() => {
    loadVideos();
    loadStats();
  }, [statusFilter]);

  const loadVideos = async () => {
    try {
      setLoading(true);
      const videosData = await adminVideoService.getVideos(statusFilter);
      setVideos(videosData);
    } catch (error: any) {
      console.error('Error loading videos:', error);
      toast.error(`Erreur lors du chargement des vidéos: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const statsData = await adminVideoService.getValidationStats();
      setStats(statsData);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const filteredVideos = videos.filter((video) => {
    const matchesSearch =
      video.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
      video.uploaded_by_business?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      video.uploaded_by_contact?.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesSearch;
  });

  // Pagination
  const totalPages = Math.ceil(filteredVideos.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedVideos = filteredVideos.slice(startIndex, endIndex);

  // Reset à la page 1 quand les filtres changent
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  const handleApprove = async (videoId: string) => {
    if (!admin?.id) {
      toast.error('Vous devez être connecté pour approuver une vidéo');
      return;
    }

    try {
      const success = await adminVideoService.approveVideo(videoId, admin.id);

      if (success) {
        toast.success('Vidéo approuvée avec succès');
        // Recharger les vidéos pour avoir les données à jour
        await loadVideos();
        await loadStats();
      } else {
        toast.error("Erreur lors de l'approbation de la vidéo");
      }
    } catch (error: any) {
      console.error('Error approving video:', error);
      toast.error(`Erreur: ${error.message || "Impossible d'approuver la vidéo"}`);
    }
  };

  const handleReject = async (videoId: string) => {
    if (!admin?.id) {
      toast.error('Vous devez être connecté pour rejeter une vidéo');
      return;
    }

    try {
      const success = await adminVideoService.rejectVideo(videoId, admin.id);

      if (success) {
        toast.success('Vidéo rejetée avec succès');
        // Recharger les vidéos pour avoir les données à jour
        await loadVideos();
        await loadStats();
      } else {
        toast.error('Erreur lors du rejet de la vidéo');
      }
    } catch (error: any) {
      console.error('Error rejecting video:', error);
      toast.error(`Erreur: ${error.message || 'Impossible de rejeter la vidéo'}`);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { color: 'bg-yellow-100 text-yellow-800', icon: Clock, text: 'En attente' },
      approved: { color: 'bg-green-100 text-green-800', icon: Check, text: 'Approuvé' },
      rejected: { color: 'bg-red-100 text-red-800', icon: X, text: 'Rejeté' },
    };
    const config = statusConfig[status as keyof typeof statusConfig];
    const Icon = config.icon;
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color}`}
      >
        <Icon className="mr-1 h-3 w-3" />
        {config.text}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <AdminLayout title="Gestion des Vidéos" subtitle="Validez et gérez les vidéos des campagnes">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement des vidéos...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Gestion des Vidéos" subtitle="Validez et gérez les vidéos des campagnes">
      {/* Statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">Total Vidéos</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total_videos}</p>
          </div>
          <VideoIcon className="h-8 w-8 text-gray-400" />
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">En Attente</p>
            <p className="text-2xl font-bold text-gray-900">{stats.pending_videos}</p>
          </div>
          <Clock className="h-8 w-8 text-yellow-500" />
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">Approuvées</p>
            <p className="text-2xl font-bold text-gray-900">{stats.approved_videos}</p>
          </div>
          <Check className="h-8 w-8 text-green-500" />
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">Rejetées</p>
            <p className="text-2xl font-bold text-gray-900">{stats.rejected_videos}</p>
          </div>
          <X className="h-8 w-8 text-red-500" />
        </div>
      </div>

      {/* Filtres et recherche */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Recherche */}
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher par nom de fichier ou annonceur..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
              />
            </div>
          </div>

          {/* Filtre statut */}
          <div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <select
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="all">Tous les statuts</option>
                <option value="pending">En attente</option>
                <option value="approved">Approuvées</option>
                <option value="rejected">Rejetées</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Liste des vidéos */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Vidéo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Annonceur
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Uploadé le
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
              {paginatedVideos.map((video) => (
                <tr key={video.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 bg-[#00B3A6] rounded flex items-center justify-center">
                        <FileVideo className="h-5 w-5 text-white" />
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{video.filename}</div>
                        <div className="text-xs text-gray-500">
                          {formatFileSize(video.file_size)} • {formatDuration(video.duration)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {video.uploaded_by_business || 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {video.uploaded_by_contact || 'N/A'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(video.validation_status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(video.created_at)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">
                      {video.campaign_names || 'Aucune campagne'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {video.campaigns_count || 0} campagne(s)
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => {
                          setSelectedVideo(video);
                          setShowDetailsModal(true);
                        }}
                        className="text-indigo-600 hover:text-indigo-900 p-2 rounded-md hover:bg-gray-100"
                        title="Voir les détails"
                      >
                        <Eye className="h-5 w-5" />
                      </button>

                      {/* Bouton Approuver - Toujours visible sauf si déjà approuvé */}
                      {video.validation_status !== 'approved' && (
                        <button
                          onClick={() => handleApprove(video.id)}
                          className="text-green-600 hover:text-green-900 p-2 rounded-md hover:bg-green-50"
                          title="Approuver"
                        >
                          <Check className="h-5 w-5" />
                        </button>
                      )}

                      {/* Bouton Rejeter - Toujours visible sauf si déjà rejeté */}
                      {video.validation_status !== 'rejected' && (
                        <button
                          onClick={() => handleReject(video.id)}
                          className="text-red-600 hover:text-red-900 p-2 rounded-md hover:bg-red-50"
                          title="Rejeter"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
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
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Affichage de <span className="font-medium">{startIndex + 1}</span> à{' '}
                  <span className="font-medium">{Math.min(endIndex, filteredVideos.length)}</span>{' '}
                  sur <span className="font-medium">{filteredVideos.length}</span> résultats
                </p>
              </div>
              <div>
                <nav
                  className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px"
                  aria-label="Pagination"
                >
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ›
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de détails */}
      {showDetailsModal && selectedVideo && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-[#00B3A6] sm:mx-0 sm:h-10 sm:w-10">
                    <VideoIcon className="h-6 w-6 text-white" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                      Détails de la vidéo
                    </h3>

                    {/* Lecteur vidéo */}
                    <div className="mb-6 bg-black rounded-lg overflow-hidden">
                      <video
                        controls
                        className="w-full max-h-96"
                        poster={selectedVideo.thumbnail_url}
                      >
                        <source
                          src={selectedVideo.url}
                          type={selectedVideo.mime_type || 'video/mp4'}
                        />
                        Votre navigateur ne supporte pas la lecture de vidéos.
                      </video>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-medium text-gray-700">Nom du fichier:</p>
                        <p className="text-sm text-gray-900">{selectedVideo.filename}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Statut:</p>
                        {getStatusBadge(selectedVideo.validation_status)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Taille:</p>
                        <p className="text-sm text-gray-900">
                          {formatFileSize(selectedVideo.file_size)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Durée:</p>
                        <p className="text-sm text-gray-900">
                          {formatDuration(selectedVideo.duration)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Uploadée par:</p>
                        <p className="text-sm text-gray-900">
                          {selectedVideo.uploaded_by_business}
                        </p>
                        <p className="text-xs text-gray-500">{selectedVideo.uploaded_by_contact}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Nombre de campagnes:</p>
                        <p className="text-sm text-gray-900">
                          {selectedVideo.campaigns_count || 0}
                        </p>
                      </div>
                      {selectedVideo.validated_at && (
                        <div>
                          <p className="text-sm font-medium text-gray-700">Validée le:</p>
                          <p className="text-sm text-gray-900">
                            {formatDate(selectedVideo.validated_at)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-2">
                {selectedVideo.validation_status === 'pending' && (
                  <>
                    <button
                      onClick={() => {
                        handleApprove(selectedVideo.id);
                        setShowDetailsModal(false);
                      }}
                      className="w-full inline-flex justify-center items-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 sm:w-auto sm:text-sm"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Approuver
                    </button>
                    <button
                      onClick={() => {
                        handleReject(selectedVideo.id);
                        setShowDetailsModal(false);
                      }}
                      className="w-full inline-flex justify-center items-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:w-auto sm:text-sm"
                    >
                      <X className="h-4 w-4 mr-2" />
                      Rejeter
                    </button>
                  </>
                )}
                <button
                  onClick={() => setShowDetailsModal(false)}
                  className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00B3A6] sm:w-auto sm:text-sm"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
