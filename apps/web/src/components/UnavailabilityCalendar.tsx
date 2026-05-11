import { Calendar, X, Save, Monitor, AlertTriangle, CheckCircle } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'react-hot-toast';

interface Screen {
  id: string;
  name: string;
  location: string;
}

interface UnavailabilityPeriod {
  screenId: string;
  startDate: string;
  endDate: string;
  reason: string;
}

interface UnavailabilityCalendarProps {
  isOpen: boolean;
  onClose: () => void;
  screens: Screen[];
  defaultTab?: 'calendar' | 'declare';
}

export default function UnavailabilityCalendar({
  isOpen,
  onClose,
  screens,
  defaultTab = 'calendar',
}: UnavailabilityCalendarProps) {
  const [activeTab, setActiveTab] = useState<'calendar' | 'declare'>(defaultTab);
  const [selectedScreen, setSelectedScreen] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedScreen || !startDate || !endDate || !reason) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }

    if (new Date(startDate) >= new Date(endDate)) {
      toast.error('La date de fin doit être postérieure à la date de début');
      return;
    }

    setIsSubmitting(true);

    try {
      // Simuler l'envoi des données
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const selectedScreenData = screens.find((s) => s.id === selectedScreen);

      toast.success(
        `Indisponibilité déclarée pour ${selectedScreenData?.name} du ${new Date(startDate).toLocaleDateString()} au ${new Date(endDate).toLocaleDateString()}`,
      );

      // Reset form
      setSelectedScreen('');
      setStartDate('');
      setEndDate('');
      setReason('');

      // Fermer le modal
      onClose();
    } catch (error) {
      toast.error("Erreur lors de la déclaration d'indisponibilité");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <Calendar className="h-6 w-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Calendrier des Indisponibilités</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'calendar'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Calendar className="h-4 w-4 inline mr-2" />
              Calendrier
            </button>
            <button
              onClick={() => setActiveTab('declare')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'declare'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <AlertTriangle className="h-4 w-4 inline mr-2" />
              Déclarer Indisponibilité
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {activeTab === 'calendar' ? (
            /* Onglet Calendrier */
            <div className="space-y-6">
              <div className="text-center py-12">
                <Calendar className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Calendrier des Indisponibilités
                </h3>
                <p className="text-gray-600 mb-6">
                  Visualisez et gérez les périodes d'indisponibilité de vos écrans
                </p>
                <div className="space-y-4">
                  <button
                    onClick={() => setActiveTab('declare')}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 mx-auto"
                  >
                    <AlertTriangle className="h-5 w-5" />
                    <span>Déclarer une nouvelle indisponibilité</span>
                  </button>
                  <p className="text-sm text-gray-500">
                    Ou utilisez l'onglet "Déclarer Indisponibilité" ci-dessus
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Onglet Déclarer Indisponibilité */
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Sélection de l'écran */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Sélectionner un écran
                </label>
                <select
                  value={selectedScreen}
                  onChange={(e) => setSelectedScreen(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Choisir un écran</option>
                  {screens.map((screen) => (
                    <option key={screen.id} value={screen.id}>
                      {screen.name} - {screen.location}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Date de début
                  </label>
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Date de fin
                  </label>
                  <input
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>

              {/* Raison */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Raison de l'indisponibilité
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Décrivez la raison de l'indisponibilité..."
                  required
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                >
                  <Save className="h-4 w-4" />
                  <span>{isSubmitting ? 'Enregistrement...' : "Valider l'indisponibilité"}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
