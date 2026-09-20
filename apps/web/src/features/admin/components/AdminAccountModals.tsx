import { AlertCircle, Calendar, CheckCircle, User, XCircle } from 'lucide-react';
import { useState } from 'react';

import { STAFF_ROLE_LABELS } from '@/features/admin/lib/staff-accounts';
import type { AdminAccount, StaffRole } from '@/features/admin/types/admin';

// ADM-FIX1 — the chip now spans the four internal roles the page lists (the two agent types
// joined the two staff ones). Colours: purple = superadmin, blue = admin, teal/amber = agents.
const ROLE_CHIP: Record<StaffRole, string> = {
  superadmin: 'bg-purple-100 text-purple-800',
  admin: 'bg-blue-100 text-blue-800',
  screenhost_agent: 'bg-teal-100 text-teal-800',
  screencast_agent: 'bg-amber-100 text-amber-800',
};

/** Role chip shared by the AdminManagement table and its details modal. */
export function AdminRoleBadge({ role }: { role: AdminAccount['role'] }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_CHIP[role]}`}
    >
      {STAFF_ROLE_LABELS[role]}
    </span>
  );
}

/** Active/inactive chip — is_active is « not banned » (deactivation IS the ban route). */
export function AdminStatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
      <CheckCircle className="w-3 h-3 mr-1" />
      Actif
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
      <XCircle className="w-3 h-3 mr-1" />
      Inactif
    </span>
  );
}

interface DetailsProps {
  account: AdminAccount;
  formatDate: (iso: string) => string;
  onClose: () => void;
}

export function AdminAccountDetailsModal({ account, formatDate, onClose }: DetailsProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Détails du compte</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XCircle className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <User className="h-5 w-5 mr-2 text-brand-primary" />
              Informations Personnelles
            </h4>
            <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm font-medium text-gray-600">Nom</span>
                <p className="text-sm text-gray-900 mt-1 font-semibold">{account.contact_name}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600">Email</span>
                <p className="text-sm text-gray-900 mt-1">{account.email}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600">Rôle</span>
                <div className="mt-1">
                  <AdminRoleBadge role={account.role} />
                </div>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-600">Statut</span>
                <div className="mt-1">
                  <AdminStatusBadge isActive={account.is_active} />
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <Calendar className="h-5 w-5 mr-2 text-brand-primary" />
              Compte
            </h4>
            <div className="bg-gray-50 rounded-lg p-4">
              <span className="text-sm font-medium text-gray-600">Date de création</span>
              <p className="text-sm text-gray-900 mt-1">{formatDate(account.created_at)}</p>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeactivateProps {
  account: AdminAccount;
  busy: boolean;
  onCancel: () => void;
  /** The motif is REQUIRED: the ban route stores it as the validation note. */
  onConfirm: (notes: string) => void;
}

export function AdminDeactivateModal({ account, busy, onCancel, onConfirm }: DeactivateProps) {
  const [notes, setNotes] = useState('');
  const canConfirm = notes.trim().length > 0 && !busy;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <div className="flex items-center mb-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <h3 className="ml-4 text-lg font-semibold text-gray-900">Désactiver l'administrateur</h3>
        </div>

        <p className="text-gray-600 mb-4">
          Êtes-vous sûr de vouloir désactiver <strong>{account.contact_name}</strong> ?
          <br />
          <span className="text-sm">
            Ses sessions seront révoquées et cet utilisateur ne pourra plus se connecter.
          </span>
        </p>

        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="deactivate-notes">
          Motif <span className="text-red-600">*</span>
        </label>
        <textarea
          id="deactivate-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Ex. : départ de la société"
          className="w-full mb-6 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary"
        />

        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={() => onConfirm(notes.trim())}
            disabled={!canConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            Désactiver
          </button>
        </div>
      </div>
    </div>
  );
}

interface ReactivateProps {
  account: AdminAccount;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AdminReactivateModal({ account, busy, onCancel, onConfirm }: ReactivateProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <div className="flex items-center mb-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <h3 className="ml-4 text-lg font-semibold text-gray-900">Réactiver l'administrateur</h3>
        </div>

        <p className="text-gray-600 mb-6">
          Êtes-vous sûr de vouloir réactiver <strong>{account.contact_name}</strong> ?
          <br />
          <span className="text-sm">
            Cet utilisateur pourra à nouveau se connecter à la plateforme.
          </span>
        </p>

        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            Réactiver
          </button>
        </div>
      </div>
    </div>
  );
}
