import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  X,
  Check,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Monitor,
  MapPin,
  CalendarX,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  UnavailabilityPeriod,
  Screen as ScreenType,
  screensService,
} from '../services/screens.service';

interface ScreenCalendarProps {
  screens: ScreenType[];
  onUnavailabilityAdded: (period: UnavailabilityPeriod) => void;
  onClose: () => void;
}

export default function ScreenCalendar({
  screens,
  onUnavailabilityAdded,
  onClose,
}: ScreenCalendarProps) {
  const [selectedScreens, setSelectedScreens] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [reason, setReason] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [unavailabilityPeriods, setUnavailabilityPeriods] = useState<UnavailabilityPeriod[]>([]);
  const [viewMode, setViewMode] = useState<'calendar' | 'form'>('calendar');

  // Vérifier automatiquement les périodes d'indisponibilité expirées
  useEffect(() => {
    const checkExpiredUnavailability = () => {
      const now = new Date();
      setUnavailabilityPeriods((prev) =>
        prev.map((period) => {
          const periodEnd = new Date(`${period.end_date}T${period.end_time}`);

          // Si la période est expirée, la marquer comme terminée
          if (now > periodEnd && period.status !== 'completed') {
            return { ...period, status: 'completed' as const };
          }

          // Si la période est en cours, la marquer comme active
          const periodStart = new Date(`${period.start_date}T${period.start_time}`);
          if (now >= periodStart && now <= periodEnd && period.status === 'pending') {
            return { ...period, status: 'active' as const };
          }

          return period;
        }),
      );
    };

    // Vérifier immédiatement
    checkExpiredUnavailability();

    // Vérifier toutes les minutes
    const interval = setInterval(checkExpiredUnavailability, 60000);

    return () => clearInterval(interval);
  }, []);

  // Générer les jours du mois
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];

    // Ajouter les jours du mois précédent pour remplir la première semaine
    for (let i = 0; i < startingDayOfWeek; i++) {
      const prevDate = new Date(year, month, -startingDayOfWeek + i + 1);
      days.push({
        date: prevDate,
        isCurrentMonth: false,
        isToday: false,
        hasUnavailability: false,
      });
    }

    // Ajouter les jours du mois actuel
    for (let i = 1; i <= daysInMonth; i++) {
      const currentDate = new Date(year, month, i);
      const dateString = currentDate.toISOString().split('T')[0];
      const hasUnavailability = unavailabilityPeriods.some((period) => {
        const periodStart = new Date(period.start_date);
        const periodEnd = new Date(period.end_date);
        return (
          currentDate >= periodStart && currentDate <= periodEnd && period.status !== 'completed'
        );
      });

      days.push({
        date: currentDate,
        isCurrentMonth: true,
        isToday: currentDate.toDateString() === new Date().toDateString(),
        hasUnavailability,
        dateString,
      });
    }

    // Ajouter les jours du mois suivant pour remplir la dernière semaine
    const remainingDays = 42 - days.length; // 6 semaines * 7 jours
    for (let i = 1; i <= remainingDays; i++) {
      const nextDate = new Date(year, month + 1, i);
      days.push({
        date: nextDate,
        isCurrentMonth: false,
        isToday: false,
        hasUnavailability: false,
      });
    }

    return days;
  };

  const days = getDaysInMonth(currentMonth);

  const handleScreenToggle = (screenId: string) => {
    setSelectedScreens((prev) =>
      prev.includes(screenId) ? prev.filter((id) => id !== screenId) : [...prev, screenId],
    );
  };

  // Fonction de validation complète des dates et heures
  const validateDateTime = () => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);

    // 1. Vérifier que les dates sont sélectionnées
    if (!startDate || !endDate) {
      toast.error('Veuillez sélectionner les dates de début et de fin');
      return false;
    }

    // 2. Vérifier que la date de début n'est pas antérieure à aujourd'hui
    if (startDate < today) {
      toast.error("La date de début ne peut pas être antérieure à aujourd'hui");
      return false;
    }

    // 3. Vérifier que la date de fin n'est pas antérieure à la date de début
    if (endDate < startDate) {
      toast.error('La date de fin ne peut pas être antérieure à la date de début');
      return false;
    }

    // 4. Si c'est aujourd'hui, vérifier que l'heure de début n'est pas antérieure à l'heure actuelle
    if (startDate === today && startTime < currentTime) {
      toast.error(
        "L'heure de début ne peut pas être antérieure à l'heure actuelle pour aujourd'hui",
      );
      return false;
    }

    // 5. Vérifier que l'heure de fin n'est pas antérieure à l'heure de début (même jour)
    if (startDate === endDate && endTime <= startTime) {
      toast.error("L'heure de fin doit être postérieure à l'heure de début pour la même journée");
      return false;
    }

    // 6. Vérifier que les heures sont dans un format valide (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      toast.error("Format d'heure invalide. Utilisez le format HH:MM (ex: 09:00)");
      return false;
    }

    // 7. Vérifier que les heures sont dans des plages raisonnables
    const startHour = parseInt(startTime.split(':')[0]);
    const endHour = parseInt(endTime.split(':')[0]);

    if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
      toast.error('Les heures doivent être comprises entre 00:00 et 23:59');
      return false;
    }

    return true;
  };

  // Fonction pour obtenir les erreurs de validation en temps réel
  const getValidationErrors = () => {
    const errors: string[] = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);

    // Vérifier les dates
    if (startDate && startDate < today) {
      errors.push("La date de début ne peut pas être antérieure à aujourd'hui");
    }

    if (startDate && endDate && endDate < startDate) {
      errors.push('La date de fin ne peut pas être antérieure à la date de début');
    }

    // Vérifier les heures
    if (startDate === today && startTime && startTime < currentTime) {
      errors.push(
        "L'heure de début ne peut pas être antérieure à l'heure actuelle pour aujourd'hui",
      );
    }

    if (
      startDate &&
      endDate &&
      startDate === endDate &&
      startTime &&
      endTime &&
      endTime <= startTime
    ) {
      errors.push("L'heure de fin doit être postérieure à l'heure de début pour la même journée");
    }

    // Vérifier le format des heures
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (startTime && !timeRegex.test(startTime)) {
      errors.push("Format d'heure de début invalide (HH:MM)");
    }
    if (endTime && !timeRegex.test(endTime)) {
      errors.push("Format d'heure de fin invalide (HH:MM)");
    }

    return errors;
  };

  const validationErrors = getValidationErrors();
  const isFormValid =
    selectedScreens.length > 0 &&
    startDate &&
    endDate &&
    startTime &&
    endTime &&
    reason.trim() &&
    validationErrors.length === 0;

  // Debug pour voir l'état de validation
  console.log('🔍 Debug validation:', {
    selectedScreens: selectedScreens.length,
    startDate,
    endDate,
    startTime,
    endTime,
    reason: reason.trim(),
    validationErrors: validationErrors.length,
    isFormValid,
  });

  const handleSubmit = async () => {
    if (selectedScreens.length === 0) {
      toast.error('Veuillez sélectionner au moins un écran');
      return;
    }

    // Validation complète des dates et heures
    if (!validateDateTime()) {
      return;
    }

    if (!reason.trim()) {
      toast.error('Veuillez indiquer une raison');
      return;
    }

    try {
      console.log(
        "📅 Création de périodes d'indisponibilité pour",
        selectedScreens.length,
        'écran(s)',
      );
      console.log('📅 Données validées:', {
        startDate,
        endDate,
        startTime,
        endTime,
        reason,
      });

      // Créer une période d'indisponibilité pour chaque écran sélectionné
      const createdPeriods = [];

      for (const screenId of selectedScreens) {
        const screen = screens.find((s) => s.id === screenId);
        if (screen) {
          console.log("🔄 Création de la période pour l'écran:", screen.name);

          // Créer la période en base de données
          const newPeriod = await screensService.createUnavailabilityPeriod({
            screen_id: screenId,
            start_date: startDate,
            end_date: endDate,
            start_time: startTime,
            end_time: endTime,
            reason,
          });

          console.log('✅ Période créée en base de données:', newPeriod);

          // Ajouter à l'état local
          setUnavailabilityPeriods((prev) => [...prev, newPeriod]);

          // Notifier le composant parent
          onUnavailabilityAdded(newPeriod);

          createdPeriods.push(newPeriod);
        }
      }

      // Réinitialiser le formulaire
      setSelectedScreens([]);
      setStartDate('');
      setEndDate('');
      setStartTime('09:00');
      setEndTime('18:00');
      setReason('');
      setViewMode('calendar');

      toast.success(`${createdPeriods.length} période(s) d'indisponibilité créée(s) avec succès`);
    } catch (error) {
      console.error("❌ Erreur lors de la création des périodes d'indisponibilité:", error);
      toast.error("Erreur lors de la création des périodes d'indisponibilité");
    }
  };

  const getMonthName = (date: Date) => {
    return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const getUnavailabilityForDate = (date: Date) => {
    const dateString = date.toISOString().split('T')[0];
    return unavailabilityPeriods.filter((period) => {
      const periodStart = new Date(period.start_date);
      const periodEnd = new Date(period.end_date);
      return date >= periodStart && date <= periodEnd && period.status !== 'completed';
    });
  };

  // Obtenir le statut d'une période pour l'affichage
  const getPeriodStatusText = (period: UnavailabilityPeriod) => {
    const now = new Date();
    const periodStart = new Date(`${period.start_date}T${period.start_time}`);
    const periodEnd = new Date(`${period.end_date}T${period.end_time}`);

    if (period.status === 'completed') {
      return 'Terminé';
    } else if (now >= periodStart && now <= periodEnd) {
      return 'En cours';
    } else if (now < periodStart) {
      return 'Programmé';
    } else {
      return 'Terminé';
    }
  };

  const getPeriodStatusColor = (period: UnavailabilityPeriod) => {
    const now = new Date();
    const periodStart = new Date(`${period.start_date}T${period.start_time}`);
    const periodEnd = new Date(`${period.end_date}T${period.end_time}`);

    if (period.status === 'completed') {
      return 'bg-gray-500/30 text-gray-200';
    } else if (now >= periodStart && now <= periodEnd) {
      return 'bg-red-500/30 text-red-200';
    } else if (now < periodStart) {
      return 'bg-yellow-500/30 text-yellow-200';
    } else {
      return 'bg-gray-500/30 text-gray-200';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <Calendar className="h-6 w-6 text-[#00B3A6]" />
            <h2 className="text-xl font-bold text-gray-900">Calendrier des Indisponibilités</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Navigation des vues */}
        <div className="flex space-x-2 p-6 pt-4">
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              viewMode === 'calendar'
                ? 'bg-[#00B3A6] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Calendar className="h-4 w-4 inline mr-2" />
            Vue Calendrier
          </button>
          <button
            onClick={() => setViewMode('form')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              viewMode === 'form'
                ? 'bg-[#00B3A6] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <CalendarX className="h-4 w-4 inline mr-2" />
            Déclarer Indisponibilité
          </button>
        </div>

        {viewMode === 'calendar' ? (
          /* Vue Calendrier */
          <div className="space-y-6 p-6 pt-0">
            {/* Navigation du mois */}
            <div className="flex items-center justify-between">
              <button
                onClick={prevMonth}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h3 className="text-xl font-semibold text-gray-900 capitalize">
                {getMonthName(currentMonth)}
              </h3>
              <button
                onClick={nextMonth}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Grille du calendrier */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              {/* En-têtes des jours */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map((day) => (
                  <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
                    {day}
                  </div>
                ))}
              </div>

              {/* Jours du mois */}
              <div className="grid grid-cols-7 gap-1">
                {days.map((day, index) => {
                  const unavailabilityForDay = getUnavailabilityForDate(day.date);
                  return (
                    <div
                      key={index}
                      className={`min-h-[80px] p-2 rounded-lg border transition-colors ${
                        day.isCurrentMonth
                          ? day.isToday
                            ? 'bg-[#00B3A6]/20 border-[#00B3A6] text-gray-900'
                            : day.hasUnavailability
                              ? 'bg-red-100 border-red-300 text-gray-900'
                              : 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50'
                          : 'bg-gray-100 border-gray-200 text-gray-400'
                      }`}
                    >
                      <div className="text-sm font-medium mb-1">{day.date.getDate()}</div>

                      {/* Indicateurs d'indisponibilité */}
                      {unavailabilityForDay.length > 0 && (
                        <div className="space-y-1">
                          {unavailabilityForDay.slice(0, 2).map((period) => (
                            <div
                              key={period.id}
                              className={`text-xs px-1 py-0.5 rounded truncate ${getPeriodStatusColor(period)}`}
                              title={`${period.reason} (${getPeriodStatusText(period)})`}
                            >
                              {period.reason}
                            </div>
                          ))}
                          {unavailabilityForDay.length > 2 && (
                            <div className="text-xs text-gray-500">
                              +{unavailabilityForDay.length - 2} autres
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Légende */}
            <div className="flex items-center space-x-6 text-sm">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-[#00B3A6]/20 border border-[#00B3A6] rounded"></div>
                <span className="text-gray-700">Aujourd'hui</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-red-100 border border-red-300 rounded"></div>
                <span className="text-gray-700">Indisponible (En cours)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded"></div>
                <span className="text-gray-700">Indisponible (Programmé)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-gray-100 border border-gray-300 rounded"></div>
                <span className="text-gray-700">Indisponible (Terminé)</span>
              </div>
            </div>
          </div>
        ) : (
          /* Vue Formulaire */
          <div className="space-y-6 p-6 pt-0">
            {/* Sélection des écrans */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Sélection des Écrans</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {screens.map((screen) => (
                  <label
                    key={screen.id}
                    className={`flex items-center p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedScreens.includes(screen.id)
                        ? 'bg-[#00B3A6]/10 border-[#00B3A6]'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedScreens.includes(screen.id)}
                      onChange={() => handleScreenToggle(screen.id)}
                      className="sr-only"
                    />
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                          selectedScreens.includes(screen.id)
                            ? 'bg-[#00B3A6] border-[#00B3A6]'
                            : 'border-gray-300'
                        }`}
                      >
                        {selectedScreens.includes(screen.id) && (
                          <Check className="h-3 w-3 text-white" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{screen.name}</div>
                        <div className="text-sm text-gray-600 flex items-center">
                          <MapPin className="h-3 w-3 mr-1" />
                          {screen.location}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Période d'indisponibilité */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Période</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Date de début
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent ${
                        startDate && startDate < new Date().toISOString().split('T')[0]
                          ? 'border-red-500'
                          : 'border-gray-300'
                      }`}
                    />
                    {startDate && startDate < new Date().toISOString().split('T')[0] && (
                      <p className="text-red-600 text-xs mt-1">
                        La date de début ne peut pas être antérieure à aujourd'hui
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Date de fin
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate || new Date().toISOString().split('T')[0]}
                      className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent ${
                        startDate && endDate && endDate < startDate
                          ? 'border-red-500'
                          : 'border-gray-300'
                      }`}
                    />
                    {startDate && endDate && endDate < startDate && (
                      <p className="text-red-600 text-xs mt-1">
                        La date de fin ne peut pas être antérieure à la date de début
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Heures</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Heure de début
                    </label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent ${
                        startDate === new Date().toISOString().split('T')[0] &&
                        startTime &&
                        startTime < new Date().toTimeString().split(' ')[0].substring(0, 5)
                          ? 'border-red-500'
                          : 'border-gray-300'
                      }`}
                    />
                    {startDate === new Date().toISOString().split('T')[0] &&
                      startTime &&
                      startTime < new Date().toTimeString().split(' ')[0].substring(0, 5) && (
                        <p className="text-red-600 text-xs mt-1">
                          L'heure de début ne peut pas être antérieure à l'heure actuelle pour
                          aujourd'hui
                        </p>
                      )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Heure de fin
                    </label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      min={startDate === endDate ? startTime : undefined}
                      className={`w-full px-3 py-2 bg-white border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent ${
                        startDate &&
                        endDate &&
                        startDate === endDate &&
                        startTime &&
                        endTime &&
                        endTime <= startTime
                          ? 'border-red-500'
                          : 'border-gray-300'
                      }`}
                    />
                    {startDate &&
                      endDate &&
                      startDate === endDate &&
                      startTime &&
                      endTime &&
                      endTime <= startTime && (
                        <p className="text-red-600 text-xs mt-1">
                          L'heure de fin doit être postérieure à l'heure de début pour la même
                          journée
                        </p>
                      )}
                  </div>
                </div>
              </div>
            </div>

            {/* Raison de l'indisponibilité */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Raison de l'indisponibilité
              </h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Motif <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex: Maintenance préventive, Panne technique, Événement privé..."
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                />
                {!reason.trim() && (
                  <p className="text-red-600 text-xs mt-1">
                    Veuillez indiquer une raison pour l'indisponibilité
                  </p>
                )}
              </div>
            </div>

            {/* Affichage des erreurs de validation */}
            {validationErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <h4 className="text-red-700 font-medium mb-2">Erreurs de validation :</h4>
                <ul className="space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index} className="text-red-600 text-sm flex items-center">
                      <AlertTriangle className="h-3 w-3 mr-2" />
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setViewMode('calendar')}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSubmit}
                disabled={!isFormValid}
                className={`px-6 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                  isFormValid
                    ? 'bg-[#00B3A6] text-white hover:bg-[#00B3A6]/90'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <Check className="h-4 w-4" />
                <span>Valider l'indisponibilité</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
