import { ChevronLeft, ChevronRight, Users, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import supportIcon from '@/assets/support.png';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';
import { MONTHS_FR, WEEKDAYS_FR } from '@/lib/locale';
import { getCalendarDays, isDatePast } from '@/lib/ui-dates';

const APPOINTMENT_OBJECTIVES_FALLBACK = [
  'Renseignements',
  'Inscription',
  'Diffusion',
  'Ciblage',
  'Budget',
  'Accompagnement',
  'Support',
  'Facturation',
  'Autre',
];

function isAutreObjective(value: string): boolean {
  return value.trim().toLowerCase() === 'autre';
}

function isDateUnavailable(date: Date): boolean {
  const d = date.getDate();
  return [6, 10, 17, 22].includes(d);
}

interface ModalContextValue {
  isLogoutOpen: boolean;
  isSupportOpen: boolean;
  isAppointmentOpen: boolean;
  openLogout: () => void;
  openSupport: () => void;
  openAppointment: () => void;
  closeLogout: () => void;
  closeSupport: () => void;
  closeAppointment: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be called within <ModalProvider>');
  return ctx;
}

export function ModalProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const [isLogoutOpen, setLogoutOpen] = useState(false);
  const [isSupportOpen, setSupportOpen] = useState(false);
  const [isAppointmentOpen, setAppointmentOpen] = useState(false);

  const appointmentObjectives = APPOINTMENT_OBJECTIVES_FALLBACK;

  // Support form
  const [supportObjective, setSupportObjective] = useState('');
  const [supportOtherDetail, setSupportOtherDetail] = useState('');
  const [supportMessage, setSupportMessage] = useState('');

  // Appointment form
  const [appointmentObjective, setAppointmentObjective] = useState('');
  const [appointmentOtherDetail, setAppointmentOtherDetail] = useState('');
  const [appointmentDate, setAppointmentDate] = useState<Date | null>(null);
  const [appointmentMessage, setAppointmentMessage] = useState('');
  const [appointmentCalendarMonth, setAppointmentCalendarMonth] = useState(() => new Date());

  // SUPA-2 — the objectives list is the local one (the Supabase table is gone with the client).

  const openLogout = useCallback(() => setLogoutOpen(true), []);
  const openSupport = useCallback(() => setSupportOpen(true), []);
  const openAppointment = useCallback(() => setAppointmentOpen(true), []);
  const closeLogout = useCallback(() => setLogoutOpen(false), []);
  const closeSupport = useCallback(() => setSupportOpen(false), []);
  const closeAppointment = useCallback(() => setAppointmentOpen(false), []);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
      toast.success('Déconnexion réussie');
    } catch (error) {
      toast.error(getErrorMessage(error) || "Une erreur inattendue s'est produite");
      navigate('/login');
    }
  };

  return (
    <ModalContext.Provider
      value={{
        isLogoutOpen,
        isSupportOpen,
        isAppointmentOpen,
        openLogout,
        openSupport,
        openAppointment,
        closeLogout,
        closeSupport,
        closeAppointment,
      }}
    >
      {children}

      {/* Logout confirmation */}
      {isLogoutOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="button"
          tabIndex={0}
          onClick={closeLogout}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              closeLogout();
            }
          }}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl border border-gray-200"
            role="button"
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <p className="text-gray-800 text-center mb-6">Vous allez être déconnecté.</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeLogout}
                className="flex-1 py-2.5 px-4 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  closeLogout();
                  await handleLogout();
                }}
                className="flex-1 py-2.5 px-4 rounded-xl font-medium text-brand-deep transition-colors hover:opacity-90"
                style={{ background: '#76E6AB' }}
              >
                Se déconnecter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Support modal */}
      {isSupportOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full overflow-hidden">
            <div className="p-4 pb-3 border-b border-dashed border-sky-200">
              <div className="flex justify-between items-start gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 border border-gray-300 flex items-center justify-center p-1.5">
                    <img src={supportIcon} alt="" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-gray-900">Support</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Prendre rendez-vous avec un agent toodooh
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeSupport}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form
              className="p-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (isAutreObjective(supportObjective) && !supportOtherDetail.trim()) {
                  toast.error('Veuillez préciser dans la description');
                  return;
                }
                toast.success('Message envoyé');
                closeSupport();
                setSupportObjective('');
                setSupportOtherDetail('');
                setSupportMessage('');
              }}
            >
              <div>
                <label
                  className="block text-sm font-bold text-gray-900 mb-1.5"
                  htmlFor="support-objective"
                >
                  Choisissez vos objectifs *
                </label>
                <select
                  value={supportObjective}
                  onChange={(e) => setSupportObjective(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '1.25rem',
                    paddingRight: '2.5rem',
                  }}
                  id="support-objective"
                >
                  <option value="">Choisissez vos objectifs</option>
                  {appointmentObjectives.map((obj) => (
                    <option key={obj} value={obj}>
                      {obj}
                    </option>
                  ))}
                </select>
              </div>
              {isAutreObjective(supportObjective) && (
                <div>
                  <label
                    className="block text-sm font-bold text-gray-900 mb-1.5"
                    htmlFor="support-other-detail"
                  >
                    Précision *
                  </label>
                  <input
                    type="text"
                    value={supportOtherDetail}
                    onChange={(e) => setSupportOtherDetail(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                    placeholder="Veuillez préciser dans la description"
                    id="support-other-detail"
                  />
                </div>
              )}
              <div>
                <label
                  className="block text-sm font-bold text-gray-900 mb-1.5"
                  htmlFor="support-message"
                >
                  Commentaire additionnels
                </label>
                <textarea
                  rows={3}
                  value={supportMessage}
                  onChange={(e) => setSupportMessage(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary resize-none"
                  placeholder="Votre Message ici.."
                  id="support-message"
                />
              </div>
              <div className="pt-1 border-t border-dashed border-sky-200 flex items-center gap-3">
                <button
                  type="button"
                  onClick={closeSupport}
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-900 border border-gray-300 bg-white hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl font-medium text-black transition-opacity hover:opacity-90"
                  style={{ background: '#76E6AB' }}
                >
                  Envoyer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Appointment modal */}
      {isAppointmentOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 pb-2 flex-shrink-0">
              <div className="flex justify-between items-start gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Users className="h-4 w-4 text-gray-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-gray-900 uppercase tracking-tight">
                      Prendre rendez-vous
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Rencontrez un agent Toodooh pour répondre à vos besoins
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeAppointment}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <form
              className="px-4 pb-4 space-y-3 flex-1 min-h-0 flex flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                if (isAutreObjective(appointmentObjective) && !appointmentOtherDetail.trim()) {
                  toast.error('Veuillez préciser dans la description');
                  return;
                }
                toast.success('Rendez-vous demandé');
                closeAppointment();
                setAppointmentObjective('');
                setAppointmentOtherDetail('');
                setAppointmentDate(null);
                setAppointmentMessage('');
              }}
            >
              <div className="flex-shrink-0">
                <label
                  className="block text-sm font-bold text-gray-900 mb-1"
                  htmlFor="appointment-objective"
                >
                  Choisissez vos objectifs *
                </label>
                <select
                  value={appointmentObjective}
                  onChange={(e) => setAppointmentObjective(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary appearance-none cursor-pointer"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '1.25rem',
                    paddingRight: '2.5rem',
                  }}
                  id="appointment-objective"
                >
                  <option value="">Choisissez vos objectifs</option>
                  {appointmentObjectives.map((obj) => (
                    <option key={obj} value={obj}>
                      {obj}
                    </option>
                  ))}
                </select>
              </div>
              {isAutreObjective(appointmentObjective) && (
                <div className="flex-shrink-0">
                  <label
                    className="block text-sm font-bold text-gray-900 mb-1"
                    htmlFor="appointment-other-detail"
                  >
                    Précision *
                  </label>
                  <input
                    type="text"
                    value={appointmentOtherDetail}
                    onChange={(e) => setAppointmentOtherDetail(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary text-sm"
                    placeholder="Veuillez préciser dans la description"
                    id="appointment-other-detail"
                  />
                </div>
              )}
              <div className="flex-shrink-0">
                <span className="block text-sm font-bold text-gray-900 mb-1">
                  Choisissez un créneau *
                </span>
                <div className="border border-gray-200 rounded-xl p-2 bg-gray-50/50">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() =>
                        setAppointmentCalendarMonth(
                          (d) => new Date(d.getFullYear(), d.getMonth() - 1),
                        )
                      }
                      className="p-1 rounded-lg hover:bg-gray-200 text-gray-600"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs font-semibold text-gray-900">
                      {MONTHS_FR[appointmentCalendarMonth.getMonth()]}{' '}
                      {appointmentCalendarMonth.getFullYear()}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAppointmentCalendarMonth(
                          (d) => new Date(d.getFullYear(), d.getMonth() + 1),
                        )
                      }
                      className="p-1 rounded-lg hover:bg-gray-200 text-gray-600"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-0.5 text-center">
                    {WEEKDAYS_FR.map((wd) => (
                      <div key={wd} className="text-[10px] font-medium text-gray-500 py-0.5">
                        {wd}
                      </div>
                    ))}
                    {getCalendarDays(
                      appointmentCalendarMonth.getFullYear(),
                      appointmentCalendarMonth.getMonth(),
                    ).map((cell, idx) => {
                      const selected =
                        appointmentDate &&
                        cell.currentMonth &&
                        appointmentDate.getDate() === cell.day &&
                        appointmentDate.getMonth() === appointmentCalendarMonth.getMonth() &&
                        appointmentDate.getFullYear() === appointmentCalendarMonth.getFullYear();
                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={!cell.currentMonth || isDatePast(cell.date)}
                          onClick={() => {
                            if (
                              cell.currentMonth &&
                              !isDatePast(cell.date) &&
                              !isDateUnavailable(cell.date)
                            ) {
                              setAppointmentDate(cell.date);
                            }
                          }}
                          className={`py-1 rounded-md text-xs font-medium transition-colors ${
                            !cell.currentMonth
                              ? 'text-gray-300'
                              : isDatePast(cell.date)
                                ? 'text-gray-400 cursor-not-allowed'
                                : isDateUnavailable(cell.date)
                                  ? 'bg-red-100 text-red-700 cursor-not-allowed'
                                  : selected
                                    ? 'bg-brand-primary text-black'
                                    : 'bg-[#E6F7ED] text-gray-900 hover:bg-brand-primary/80'
                          }`}
                        >
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0">
                <label
                  className="block text-sm font-bold text-gray-900 mb-1"
                  htmlFor="appointment-message"
                >
                  Aidez-nous à préparer au mieux l&apos;entretien
                </label>
                <textarea
                  rows={2}
                  value={appointmentMessage}
                  onChange={(e) => setAppointmentMessage(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary resize-none text-sm"
                  placeholder="Votre Message ici.."
                  id="appointment-message"
                />
              </div>
              <div className="flex items-center gap-3 pt-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={closeAppointment}
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-900 border border-gray-300 bg-white hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-xl font-medium text-black transition-opacity hover:opacity-90"
                  style={{ background: '#76E6AB' }}
                >
                  Prendre rendez-vous
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}
