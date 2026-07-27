import { AlertCircle, ArrowRight, Calendar, Clock } from 'lucide-react';
import { useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

import PillButton from '@/components/PillButton';
import { startFloorHelperText } from '@/features/campaigns/lib/wizard-dates';
import StepSectionHeading from '@/features/campaigns/pages/new-campaign/StepSectionHeading';

interface StepDatesProps {
  startDate: Date | null;
  endDate: Date | null;
  /** CF-Q2 — the SERVER's working-day-lead floor (parsed); null while the config loads. */
  minStartDate: Date | null;
  /** The floor as the wire ISO date — feeds the French helper line. */
  firstAvailableStartDate?: string;
  setStartDate: (next: Date | null) => void;
  setEndDate: (next: Date | null) => void;
  onNext: () => void | Promise<void>;
  /** CF-HF2 — true while the persist-on-advance PATCH is in flight (Suivant locks). */
  saving?: boolean;
  onBack: () => void;
}

type DateField = 'start' | 'end';

// EV1 rider (CF-HF3 watch-item, ruled): a ONE-DAY campaign is legal — start = end passes. The
// old strict < here was the only blocker in the whole chain (the server never mirrored it and the
// engine's day window is inclusive), so the comparisons and the messages carry the « ou égale ».
function validateDate(dateType: DateField, date: Date | null, otherDate: Date | null): string {
  if (!date) {
    return dateType === 'start'
      ? 'La date de début est obligatoire'
      : 'La date de fin est obligatoire';
  }
  if (dateType === 'start' && otherDate && date > otherDate) {
    return 'La date de début doit être antérieure ou égale à la date de fin';
  }
  if (dateType === 'end' && otherDate && date < otherDate) {
    return 'La date de fin doit être postérieure ou égale à la date de début';
  }
  return '';
}

/**
 * Période step (CF-W1 — the pickers moved out of Basics). The start floor comes from the SERVER
 * (working-day lead, ruling #10: any start day is legal, week-ends included — no weekend filter).
 */
export default function StepDates({
  startDate,
  endDate,
  minStartDate,
  firstAvailableStartDate,
  setStartDate,
  setEndDate,
  onNext,
  saving = false,
  onBack,
}: StepDatesProps) {
  const [dateErrors, setDateErrors] = useState<{ start?: string; end?: string }>({});
  const [dateTouched, setDateTouched] = useState<{ start?: boolean; end?: boolean }>({});

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // INCLUSIVE like the engine + the recap (`inclusiveDayCount`): 30→30 is 1 jour, 30→31 is 2.
  const durationDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const ms = endDate.getTime() - startDate.getTime();
    if (ms < 0) return 0;
    return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
  }, [startDate, endDate]);

  const handleDateChange = (dateType: DateField, date: Date | null) => {
    if (dateType === 'start') setStartDate(date);
    else setEndDate(date);
    setDateTouched((prev) => ({ ...prev, [dateType]: true }));
    const thisError = validateDate(dateType, date, dateType === 'start' ? endDate : startDate);
    setDateErrors((prev) => ({ ...prev, [dateType]: thisError }));
    if (dateType === 'start' && endDate) {
      setDateErrors((prev) => ({ ...prev, end: validateDate('end', endDate, date) }));
    } else if (dateType === 'end' && startDate) {
      setDateErrors((prev) => ({ ...prev, start: validateDate('start', startDate, date) }));
    }
  };

  const validateAndSurface = (): boolean => {
    const sErr = validateDate('start', startDate, endDate);
    const eErr = validateDate('end', endDate, startDate);
    setDateTouched({ start: true, end: true });
    setDateErrors({ start: sErr, end: eErr });
    return !sErr && !eErr;
  };

  const handleNext = () => {
    if (!validateAndSurface()) return;
    void onNext();
  };

  const nextDisabled = !startDate || !endDate || startDate > endDate || saving;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <StepSectionHeading
            icon={Calendar}
            title="Période"
            subtitle="Choisissez la période de diffusion de votre campagne"
          />
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="dates-start-date"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Date de début <span className="text-red-500">*</span>
              </label>
              <DatePicker
                id="dates-start-date"
                selected={startDate}
                onChange={(date: Date | null) => handleDateChange('start', date)}
                onBlur={() => setDateTouched((prev) => ({ ...prev, start: true }))}
                selectsStart
                startDate={startDate}
                endDate={endDate}
                minDate={minStartDate ?? today}
                className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all ${
                  dateTouched.start && dateErrors.start
                    ? 'border-red-300 bg-red-50'
                    : 'border-gray-300'
                }`}
                placeholderText="Sélectionnez une date"
                dateFormat="dd/MM/yyyy"
              />
              {/* CF-W1 — the floor comes from the SERVER; any start day is legal (ruling #10) */}
              {startFloorHelperText(firstAvailableStartDate) && (
                <p className="mt-1 text-xs text-gray-500">
                  {startFloorHelperText(firstAvailableStartDate)}
                </p>
              )}
              {dateTouched.start && dateErrors.start && (
                <p className="mt-1 text-sm text-red-600 flex items-center">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {dateErrors.start}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="dates-end-date"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Date de fin <span className="text-red-500">*</span>
              </label>
              <DatePicker
                id="dates-end-date"
                selected={endDate}
                onChange={(date: Date | null) => handleDateChange('end', date)}
                onBlur={() => setDateTouched((prev) => ({ ...prev, end: true }))}
                selectsEnd
                startDate={startDate}
                endDate={endDate}
                minDate={startDate || minStartDate || today}
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
        <PillButton
          onClick={handleNext}
          disabled={nextDisabled}
          icon={<Calendar className="h-4 w-4" />}
          trailingIcon={<ArrowRight className="h-4 w-4" />}
        >
          Suivant
        </PillButton>
      </div>
    </div>
  );
}
