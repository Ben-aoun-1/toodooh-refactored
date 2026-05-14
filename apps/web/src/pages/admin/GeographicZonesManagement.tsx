import L from 'leaflet';
import {
  MapPin,
  Plus,
  Edit,
  Trash2,
  Search,
  X,
  Eye,
  EyeOff,
  Save,
  Upload,
  Flame,
} from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { MapContainer, TileLayer, Circle, useMapEvents, Marker } from 'react-leaflet';

import AdminLayout from '../../components/admin/AdminLayout';
import {
  predefinedZonesService,
  type PredefinedZone,
} from '../../services/predefined-zones.service';
import 'leaflet/dist/leaflet.css';
import { getErrorMessage } from '../../lib/errors';

// Fix pour les icônes Leaflet
// TODO(phase-1): typed source [leaflet] — see #15
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Composant pour capturer les clics sur la carte
function MapClickHandler({
  onLocationSelect,
}: {
  onLocationSelect: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function GeographicZonesManagement() {
  const [zones, setZones] = useState<PredefinedZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingZone, setEditingZone] = useState<PredefinedZone | null>(null);
  const [selectedLocations, setSelectedLocations] = useState<Array<{ lat: number; lng: number }>>(
    [],
  );
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number }>({
    lat: 36.8065,
    lng: 10.1815,
  }); // Tunis par défaut
  const [radius, setRadius] = useState(5000); // 5km par défaut
  const [zoneName, setZoneName] = useState('');
  const [zoneDescription, setZoneDescription] = useState('');
  const [zoneImageUrl, setZoneImageUrl] = useState<string | null>(null);
  const [zoneIsHot, setZoneIsHot] = useState(false);
  const [zoneCountry, setZoneCountry] = useState('Tunisie');
  const [zoneRegion, setZoneRegion] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([36.8065, 10.1815]);

  useEffect(() => {
    loadZones();
  }, []);

  const loadZones = async () => {
    try {
      setLoading(true);
      const data = await predefinedZonesService.getAllForAdmin();
      setZones(data);
    } catch (_error) {
      toast.error('Erreur lors du chargement des zones');
    } finally {
      setLoading(false);
    }
  };

  const filteredZones = zones.filter((zone) => {
    const matchesSearch =
      zone.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (zone.description && zone.description.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && zone.is_active) ||
      (statusFilter === 'inactive' && !zone.is_active);
    return matchesSearch && matchesStatus;
  });

  const handleAddLocation = (lat: number, lng: number) => {
    setCurrentLocation({ lat, lng });
    // Ajouter à la liste des emplacements sélectionnés si pas déjà présent
    const exists = selectedLocations.some(
      (loc) => Math.abs(loc.lat - lat) < 0.0001 && Math.abs(loc.lng - lng) < 0.0001,
    );
    if (!exists) {
      setSelectedLocations([...selectedLocations, { lat, lng }]);
    }
  };

  const handleRemoveLocation = (index: number) => {
    setSelectedLocations(selectedLocations.filter((_, i) => i !== index));
  };

  const handleOpenModal = (zone?: PredefinedZone) => {
    if (zone) {
      setEditingZone(zone);
      setZoneName(zone.name);
      setZoneDescription(zone.description || '');
      setZoneImageUrl(zone.image_url || null);
      setZoneIsHot(zone.is_hot ?? false);
      setZoneCountry(zone.country || 'Tunisie');
      setZoneRegion(zone.region || '');
      setCurrentLocation({ lat: zone.latitude, lng: zone.longitude });
      setRadius(zone.radius);
      setSelectedLocations([{ lat: zone.latitude, lng: zone.longitude }]);
      setMapCenter([zone.latitude, zone.longitude]);
    } else {
      setEditingZone(null);
      setZoneName('');
      setZoneDescription('');
      setZoneImageUrl(null);
      setZoneIsHot(false);
      setZoneCountry('Tunisie');
      setZoneRegion('');
      setCurrentLocation({ lat: 36.8065, lng: 10.1815 });
      setRadius(5000);
      setSelectedLocations([]);
      setMapCenter([36.8065, 10.1815]);
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingZone(null);
    setZoneName('');
    setZoneDescription('');
    setZoneImageUrl(null);
    setZoneIsHot(false);
    setZoneCountry('Tunisie');
    setZoneRegion('');
    setSelectedLocations([]);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingZone) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner une image (JPEG, PNG, WebP)');
      return;
    }
    try {
      setUploadingImage(true);
      const url = await predefinedZonesService.uploadZoneImage(editingZone.id, file);
      setZoneImageUrl(url);
      toast.success('Image mise à jour');
    } catch (err) {
      toast.error(getErrorMessage(err) || "Erreur lors de l'upload");
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!zoneName.trim()) {
      toast.error('Le nom de la zone est requis');
      return;
    }

    if (selectedLocations.length === 0) {
      toast.error('Veuillez sélectionner au moins un emplacement sur la carte');
      return;
    }

    try {
      if (editingZone) {
        await predefinedZonesService.update(editingZone.id, {
          name: zoneName,
          description: zoneDescription || null,
          latitude: selectedLocations[0].lat,
          longitude: selectedLocations[0].lng,
          radius: radius,
          image_url: zoneImageUrl || null,
          is_hot: zoneIsHot,
          country: zoneCountry || null,
          region: zoneRegion || null,
        });
        toast.success('Zone mise à jour avec succès');
      } else {
        // Création : créer une zone pour chaque emplacement sélectionné
        for (const location of selectedLocations) {
          await predefinedZonesService.create({
            name: zoneName,
            description: zoneDescription || null,
            latitude: location.lat,
            longitude: location.lng,
            radius: radius,
            is_active: true,
            country: zoneCountry || null,
            region: zoneRegion || null,
          });
        }
        toast.success(`${selectedLocations.length} zone(s) créée(s) avec succès`);
      }
      handleCloseModal();
      loadZones();
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la sauvegarde');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette zone ?')) {
      return;
    }

    try {
      await predefinedZonesService.delete(id);
      toast.success('Zone supprimée avec succès');
      loadZones();
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors de la suppression');
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      await predefinedZonesService.toggleActive(id, !currentStatus);
      toast.success(`Zone ${!currentStatus ? 'publiée' : 'dépubliée'} avec succès`);
      loadZones();
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Erreur lors du changement de statut');
    }
  };


  return (
    <AdminLayout
      title="Gestion des Zones Géographiques"
      subtitle="Gérez les zones géographiques prédéfinies"
    >
      <div className="space-y-6">
        {/* Barre de recherche et filtres */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Rechercher une zone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
              className="px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">Tous les statuts</option>
              <option value="active">Publiées</option>
              <option value="inactive">Dépubliées</option>
            </select>
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#00B3A6] text-white rounded-xl hover:bg-[#00B3A6]/90 transition-colors font-medium"
            >
              <Plus className="w-5 h-5" />
              Ajouter une zone
            </button>
          </div>
        </div>

        {/* Liste des zones */}
        {loading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <p className="text-gray-500">Chargement...</p>
          </div>
        ) : filteredZones.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Aucune zone trouvée</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input type="checkbox" className="rounded border-gray-300" />
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Image
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Nom
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Hot
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Coordonnées
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rayon
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Statut
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredZones.map((zone) => (
                    <tr key={zone.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input type="checkbox" className="rounded border-gray-300" />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {zone.image_url ? (
                          <img
                            src={zone.image_url}
                            alt=""
                            className="w-12 h-12 object-cover rounded-lg border border-gray-200"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center">
                            <MapPin className="w-5 h-5 text-gray-400" />
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{zone.name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {zone.is_hot ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                            <Flame className="w-3 h-3" /> Hot
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-500 max-w-xs truncate">
                          {zone.description || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">
                          {zone.latitude.toFixed(4)}, {zone.longitude.toFixed(4)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">
                          {(zone.radius / 1000).toFixed(1)} km
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            zone.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {zone.is_active ? 'Publiée' : 'Dépubliée'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleActive(zone.id, zone.is_active)}
                            className="text-blue-600 hover:text-blue-900"
                            title={zone.is_active ? 'Dépublier' : 'Publier'}
                          >
                            {zone.is_active ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleOpenModal(zone)}
                            className="text-[#00B3A6] hover:text-[#00B3A6]/80"
                            title="Modifier"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(zone.id)}
                            className="text-red-600 hover:text-red-900"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal d'ajout/modification */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-xl font-bold text-gray-900">
                {editingZone ? 'Modifier la zone' : 'Ajouter une nouvelle zone'}
              </h3>
              <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Formulaire */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nom de la zone *
                    </label>
                    <input
                      type="text"
                      value={zoneName}
                      onChange={(e) => setZoneName(e.target.value)}
                      placeholder="Ex: Centre-ville Tunis"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={zoneDescription}
                      onChange={(e) => setZoneDescription(e.target.value)}
                      placeholder="Description de la zone..."
                      rows={3}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                    />
                  </div>
                  {editingZone && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Image de la zone
                      </label>
                      <div className="flex items-center gap-4">
                        {zoneImageUrl ? (
                          <img
                            src={zoneImageUrl}
                            alt={zoneName}
                            className="w-24 h-24 object-cover rounded-xl border border-gray-200"
                          />
                        ) : (
                          <div className="w-24 h-24 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center">
                            <MapPin className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <label className="cursor-pointer flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                          <Upload className="w-4 h-4" />
                          {uploadingImage
                            ? 'Upload...'
                            : zoneImageUrl
                              ? 'Changer'
                              : 'Ajouter une image'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleImageChange}
                            disabled={uploadingImage}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="zone-is-hot"
                      checked={zoneIsHot}
                      onChange={(e) => setZoneIsHot(e.target.checked)}
                      className="rounded border-gray-300 text-[#00B3A6] focus:ring-[#00B3A6]"
                    />
                    <label
                      htmlFor="zone-is-hot"
                      className="flex items-center gap-1.5 text-sm font-medium text-gray-700"
                    >
                      <Flame className="w-4 h-4 text-orange-500" />
                      Tag &quot;Hot right now&quot; (zone très utilisée)
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Pays</label>
                    <input
                      type="text"
                      value={zoneCountry}
                      onChange={(e) => setZoneCountry(e.target.value)}
                      placeholder="Ex: Tunisie"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Région</label>
                    <input
                      type="text"
                      value={zoneRegion}
                      onChange={(e) => setZoneRegion(e.target.value)}
                      placeholder="Ex: Tunis, Cap Bon"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Rayon: {(radius / 1000).toFixed(1)} km
                    </label>
                    <input
                      type="range"
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                      min="100"
                      max="50000"
                      step="100"
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#00B3A6]"
                      style={{
                        background: `linear-gradient(to right, #00B3A6 0%, #00B3A6 ${((radius - 100) / (50000 - 100)) * 100}%, #e5e7eb ${((radius - 100) / (50000 - 100)) * 100}%, #e5e7eb 100%)`,
                      }}
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>0.1 km</span>
                      <span>50 km</span>
                    </div>
                  </div>

                  {/* Liste des emplacements sélectionnés */}
                  {selectedLocations.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Emplacements sélectionnés ({selectedLocations.length})
                      </label>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {selectedLocations.map((loc, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                          >
                            <span className="text-sm text-gray-700">
                              {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                            </span>
                            <button
                              onClick={() => handleRemoveLocation(index)}
                              className="text-red-600 hover:text-red-800"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Carte */}
                <div className="h-[500px] rounded-xl overflow-hidden border border-gray-200">
                  <MapContainer
                    center={mapCenter}
                    zoom={13}
                    style={{ height: '100%', width: '100%' }}
                    className="rounded-lg"
                  >
                    <TileLayer
                      url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                      subdomains="abcd"
                      maxZoom={14}
                    />
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png"
                      attribution=""
                      opacity={0.5}
                      maxZoom={12}
                      minZoom={8}
                    />
                    <MapClickHandler onLocationSelect={handleAddLocation} />

                    {/* Cercles pour chaque emplacement sélectionné */}
                    {selectedLocations.map((loc, index) => (
                      <Circle
                        key={index}
                        center={[loc.lat, loc.lng]}
                        radius={radius}
                        pathOptions={{
                          fillColor: '#00B3A6',
                          fillOpacity: 0.2,
                          color: '#00B3A6',
                          weight: 2,
                        }}
                      />
                    ))}

                    {/* Marqueur pour l'emplacement actuel */}
                    {currentLocation && (
                      <Marker position={[currentLocation.lat, currentLocation.lng]} />
                    )}
                  </MapContainer>
                </div>
              </div>

              {/* Instructions */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm text-blue-800">
                  <strong>Instructions :</strong> Cliquez sur la carte pour sélectionner un ou
                  plusieurs emplacements. Chaque emplacement créera une zone avec le nom et le rayon
                  spécifiés.
                </p>
              </div>

              {/* Boutons d'action */}
              <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
                <button
                  onClick={handleCloseModal}
                  className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 px-6 py-2.5 bg-[#00B3A6] text-white rounded-xl hover:bg-[#00B3A6]/90 transition-colors font-medium"
                >
                  <Save className="w-5 h-5" />
                  {editingZone ? 'Enregistrer les modifications' : 'Créer la zone'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
