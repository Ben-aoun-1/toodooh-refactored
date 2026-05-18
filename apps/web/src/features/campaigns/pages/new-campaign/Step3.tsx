import { AlertCircle, ArrowRight, Calendar, Clock } from 'lucide-react';
import { useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

interface Step3Props {
  startDate: Date | null;
  endDate: Date | null;
  setStartDate: (next: Date | null) => void;
  setEndDate: (next: Date | null) => void;
  onNext: () => boolean;
  onBack: () => void;
}

type DateField = 'start' | 'end';

function validateDate(dateType: DateField, date: Date | null, otherDate: Date | null): string {
  if (!date) {
    return dateType === 'start'
      ? 'La date de début est obligatoire'
      : 'La date de fin est obligatoire';
  }
  if (dateType === 'start' && otherDate && date >= otherDate) {
    return 'La date de début doit être antérieure à la date de fin';
  }
  if (dateType === 'end' && otherDate && date <= otherDate) {
    return 'La date de fin doit être postérieure à la date de début';
  }
  return '';
}

/**
 * Step 3 of the standard advertiser campaign wizard: campaign period
 * (start and end dates) with cross-field validation. Owns local
 * dateErrors / dateTouched, computes duration locally from the two
 * Date props, and renders its own Suivant + Back footer.
 *
 * Extracted from NewCampaign.tsx (formerly lines ~1941-2028 plus the
 * companion functions validateDate / handleDateChange / validateStep2
 * and the dateErrors / dateTouched useState slots).
 */
export default function Step3({
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  onNext,
  onBack,
}: Step3Props) {
  const [dateErrors, setDateErrors] = useState<{ start?: string; end?: string }>({});
  const [dateTouched, setDateTouched] = useState<{ start?: boolean; end?: boolean }>({});

  // Today at midnight (local). Recomputed on each render — cheap; stays
  // current if the wizard sits open across midnight.
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const durationDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const ms = endDate.getTime() - startDate.getTime();
    if (ms <= 0) return 0;
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }, [startDate, endDate]);

  const handleDateChange = (dateType: DateField, date: Date | null) => {
    if (dateType === 'start') {
      setStartDate(date);
    } else {
      setEndDate(date);
    }

    setDateTouched((prev) => ({ ...prev, [dateType]: true }));

    // Validate this field against the OTHER field's current value
    // (the new value isn't in props yet — props sync after the parent
    //  re-renders — so we pass the previous other-side explicitly).
    const thisError = validateDate(dateType, date, dateType === 'start' ? endDate : startDate);
    setDateErrors((prev) => ({ ...prev, [dateType]: thisError }));

    // Cross-field: re-validate the OTHER date against this new date.
    if (dateType === 'start' && endDate) {
      const endError = validateDate('end', endDate, date);
      setDateErrors((prev) => ({ ...prev, end: endError }));
    } else if (dateType === 'end' && startDate) {
      const startError = validateDate('start', startDate, date);
      setDateErrors((prev) => ({ ...prev, start: startError }));
    }
  };

  const validateAndSurface = (): boolean => {
    const startError = validateDate('start', startDate, endDate);
    const endError = validateDate('end', endDate, startDate);
    setDateTouched({ start: true, end: true });
    setDateErrors({ start: startError, end: endError });
    return !startError && !endError;
  };

  const handleNext = () => {
    if (!validateAndSurface()) return;
    onNext();
  };

  const nextDisabled = !startDate || !endDate || startDate >= endDate;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-gradient-to-r from-brand-primary to-brand-deep">
              <Calendar className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#00263A]">Planification</h2>
              <p className="text-gray-600">Définissez les dates de diffusion</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="step3-start-date"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Date de début <span className="text-red-500">*</span>
              </label>
              <DatePicker
                id="step3-start-date"
                selected={startDate}
                onChange={(date: Date | null) => handleDateChange('start', date)}
                onBlur={() => setDateTouched((prev) => ({ ...prev, start: true }))}
                selectsStart
                startDate={startDate}
                endDate={endDate}
                minDate={today}
                className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all ${
                  dateTouched.start && dateErrors.start
                    ? 'border-red-300 bg-red-50'
                    : 'border-gray-300'
                }`}
                placeholderText="Sélectionnez une date"
                dateFormat="dd/MM/yyyy"
              />
              {dateTouched.start && dateErrors.start && (
                <p className="mt-1 text-sm text-red-600 flex items-center">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {dateErrors.start}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="step3-end-date"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Date de fin <span className="text-red-500">*</span>
              </label>
              <DatePicker
                id="step3-end-date"
                selected={endDate}
                onChange={(date: Date | null) => handleDateChange('end', date)}
                onBlur={() => setDateTouched((prev) => ({ ...prev, end: true }))}
                selectsEnd
                startDate={startDate}
                endDate={endDate}
                minDate={startDate || today}
                className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all ${
                  dateTouched.end && dateErrors.end ? 'border-red-300 bg-red-50' : 'border-gray-300'
                }`}
                placeholderText="Sélectionnez une date"
                dateFormat="dd/MM/yyyy"
              />
              {dateTouched.end && dateErrors.end && (
                <p className="mt-1 text-sm text-red-600 flex items-center">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {dateErrors.end}
                </p>
              )}
            </div>
          </div>

          {durationDays > 0 && (
            <div className="bg-gradient-to-r from-brand-primary/10 to-brand-deep/10 rounded-xl p-4 border border-brand-primary/20">
              <div className="flex items-center space-x-2 mb-2">
                <Clock className="h-5 w-5 text-brand-primary" />
                <span className="font-medium text-[#00263A]">Durée de la campagne</span>
              </div>
              <p className="text-[#00263A]">
                {durationDays} jour{durationDays > 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all text-sm font-medium"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Retour
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={nextDisabled}
          className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center space-x-2 shadow-lg ${
            nextDisabled
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-brand-primary to-brand-deep text-white hover:from-brand-primary/90 hover:to-brand-deep'
          }`}
        >
          <span>Suivant</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
