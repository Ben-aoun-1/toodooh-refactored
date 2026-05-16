import { Plus, X, Save, Info } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'react-hot-toast';

import { screensService, CreateScreenData } from '@/features/screens/services/screens.service';
import { isErrorWithCode } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'AddScreen' });

interface AddScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onScreenAdded?: () => void;
}

export default function AddScreen({ isOpen, onClose, onScreenAdded }: AddScreenProps) {
  const [formData, setFormData] = useState({
    name: '',
    location: '',
    address: '',
    city: '',
    postalCode: '',
    description: '',
    screenType: '',
    resolution: '',
    orientation: 'landscape',
    installationDate: '',
    coordinates: {
      latitude: '',
      longitude: '',
    },
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState(1);

  const screenTypes = [
    { id: 'led', name: 'Écran LED' },
    { id: 'lcd', name: 'Écran LCD' },
    { id: 'oled', name: 'Écran OLED' },
    { id: 'projection', name: 'Projection' },
  ];

  const resolutions = [
    { id: '1920x1080', name: 'Full HD (1920x1080)' },
    { id: '2560x1440', name: 'QHD (2560x1440)' },
    { id: '3840x2160', name: '4K (3840x2160)' },
    { id: 'custom', name: 'Résolution personnalisée' },
  ];

  const handleInputChange = (field: string, value: string) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setFormData((prev) => ({
        ...prev,
        [parent]: {
          // TODO(phase-1): typed source [internal] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(prev[parent as keyof typeof prev] as any),
          [child]: value,
        },
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [field]: value,
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation complète avant soumission
    if (!formData.name || !formData.location || !formData.screenType) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }

    // Validation spécifique pour l'étape 3
    if (step !== 3) {
      toast.error('Veuillez compléter toutes les étapes avant de soumettre');
      return;
    }

    setIsSubmitting(true);

    try {
      // Préparer les données pour l'API
      const screenData: CreateScreenData = {
        name: formData.name,
        location: formData.location,
        address: formData.address || undefined,
        screen_type: formData.screenType as 'led' | 'lcd' | 'projector' | 'other',
        orientation: formData.orientation as 'landscape' | 'portrait' | 'square',
      };

      // Ajouter les coordonnées si disponibles
      if (formData.coordinates.latitude && formData.coordinates.longitude) {
        // TODO(phase-1): typed source [internal] — see #15
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (screenData as any).coordinates = {
          x: parseFloat(formData.coordinates.longitude),
          y: parseFloat(formData.coordinates.latitude),
        };
      }

      // Ajouter la résolution si spécifiée
      if (formData.resolution && formData.resolution !== 'custom') {
        const [width, height] = formData.resolution.split('x').map(Number);
        screenData.resolution_width = width;
        screenData.resolution_height = height;
      }

      // Créer l'écran via le service
      await screensService.createScreen(screenData);

      toast.success('Écran ajouté avec succès !');

      // Appeler le callback pour rafraîchir la liste
      if (onScreenAdded) {
        onScreenAdded();
      }

      // Reset form
      setFormData({
        name: '',
        location: '',
        address: '',
        city: '',
        postalCode: '',
        description: '',
        screenType: '',
        resolution: '',
        orientation: 'landscape',
        installationDate: '',
        coordinates: {
          latitude: '',
          longitude: '',
        },
      });
      setStep(1);
      onClose();
    } catch (error) {
      log.error({ error }, "❌ Erreur lors de la création de l'écran");

      // Afficher un message d'erreur plus détaillé
      let errorMessage = "Erreur lors de la création de l'écran. Veuillez réessayer.";

      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (isErrorWithCode(error)) {
        // Erreur Supabase (forme `{ code, message, details?, hint? }`)
        errorMessage = error.message || error.details || errorMessage;
      }

      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextStep = (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    if (step === 1 && (!formData.name || !formData.location)) {
      toast.error('Veuillez remplir les informations de base');
      return;
    }

    if (step === 2 && !formData.screenType) {
      toast.error("Veuillez sélectionner un type d'écran");
      return;
    }

    setStep(step + 1);
  };

  const prevStep = () => {
    setStep(step - 1);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] sm:max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <Plus className="h-6 w-6 text-green-600" />
            <h2 className="text-xl font-bold text-gray-900">Ajouter un nouvel écran</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="flex items-center justify-center space-x-4">
            <div
              className={`flex items-center space-x-2 ${step >= 1 ? 'text-green-600' : 'text-gray-400'}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= 1 ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}
              >
                1
              </div>
              <span className="text-sm font-medium">Informations de base</span>
            </div>
            <div className={`w-8 h-0.5 ${step >= 2 ? 'bg-green-600' : 'bg-gray-300'}`}></div>
            <div
              className={`flex items-center space-x-2 ${step >= 2 ? 'text-green-600' : 'text-gray-400'}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= 2 ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}
              >
                2
              </div>
              <span className="text-sm font-medium">Spécifications techniques</span>
            </div>
            <div className={`w-8 h-0.5 ${step >= 3 ? 'bg-green-600' : 'bg-gray-300'}`}></div>
            <div
              className={`flex items-center space-x-2 ${step >= 3 ? 'text-green-600' : 'text-gray-400'}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= 3 ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}
              >
                3
              </div>
              <span className="text-sm font-medium">Localisation</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
          <form onSubmit={handleSubmit} className="space-y-6 h-full flex flex-col">
            <div className="flex-1">
              {step === 1 && (
                /* Step 1: Informations de base */
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nom de l'écran <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="Ex: Écran Centre-ville"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Emplacement <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.location}
                      onChange={(e) => handleInputChange('location', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="Ex: Avenue Habib Bourguiba"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => handleInputChange('description', e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="Description détaillée de l'emplacement..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Date d'installation
                    </label>
                    <input
                      type="date"
                      value={formData.installationDate}
                      onChange={(e) => handleInputChange('installationDate', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              {step === 2 && (
                /* Step 2: Spécifications techniques */
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Type d'écran <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.screenType}
                      onChange={(e) => handleInputChange('screenType', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      required
                    >
                      <option value="">Choisir un type d'écran</option>
                      {screenTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Résolution
                    </label>
                    <select
                      value={formData.resolution}
                      onChange={(e) => handleInputChange('resolution', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                      <option value="">Choisir une résolution</option>
                      {resolutions.map((res) => (
                        <option key={res.id} value={res.id}>
                          {res.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Orientation
                    </label>
                    <div className="flex space-x-4">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="orientation"
                          value="landscape"
                          checked={formData.orientation === 'landscape'}
                          onChange={(e) => handleInputChange('orientation', e.target.value)}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700">Paysage</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="orientation"
                          value="portrait"
                          checked={formData.orientation === 'portrait'}
                          onChange={(e) => handleInputChange('orientation', e.target.value)}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700">Portrait</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                /* Step 3: Localisation */
                <div className="space-y-6">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-start space-x-3">
                      <Info className="h-5 w-5 text-green-600 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium text-green-900 mb-1">Dernière étape</h4>
                        <p className="text-sm text-green-800">
                          Remplissez les informations de localisation (optionnelles) puis cliquez
                          sur "Ajouter l'écran" pour finaliser.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Adresse
                      </label>
                      <input
                        type="text"
                        value={formData.address}
                        onChange={(e) => handleInputChange('address', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="Numéro et rue"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Ville</label>
                      <input
                        type="text"
                        value={formData.city}
                        onChange={(e) => handleInputChange('city', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="Nom de la ville"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Code postal
                      </label>
                      <input
                        type="text"
                        value={formData.postalCode}
                        onChange={(e) => handleInputChange('postalCode', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="Code postal"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Latitude
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.coordinates.latitude}
                        onChange={(e) => handleInputChange('coordinates.latitude', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="Ex: 36.8065"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Longitude
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.coordinates.longitude}
                        onChange={(e) => handleInputChange('coordinates.longitude', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        placeholder="Ex: 10.1815"
                      />
                    </div>
                  </div>

                  {/* Informations importantes */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start space-x-3">
                      <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium text-blue-900 mb-1">
                          Informations importantes
                        </h4>
                        <ul className="text-sm text-blue-800 space-y-1">
                          <li>• Votre écran sera soumis à validation par notre équipe</li>
                          <li>• La validation prend généralement 24-48 heures</li>
                          <li>• Vous recevrez une notification une fois validé</li>
                          <li>• Les coordonnées GPS sont optionnelles mais recommandées</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation - Toujours visible en bas */}
            <div className="flex space-x-3 p-4 sm:p-6 pt-4 border-t bg-white sticky bottom-0">
              {step > 1 && (
                <button
                  type="button"
                  onClick={prevStep}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Précédent
                </button>
              )}

              {step < 3 ? (
                <button
                  type="button"
                  onClick={(e) => nextStep(e)}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Suivant
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      <span>Ajout en cours...</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      <span>Ajouter l'écran</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
