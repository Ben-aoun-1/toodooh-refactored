import { X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import supportIcon from '@/assets/support.png';
import {
  SUPPORT_COMMENT_LABEL,
  SUPPORT_FAILED_TOAST,
  SUPPORT_OBJECTIVES,
  SUPPORT_SENT_TOAST,
  isAutreObjective,
  supportPayloadError,
} from '@/features/support/lib/support-form';
import { supportService } from '@/features/support/services/support.service';
import { getErrorMessage } from '@/lib/errors';

// SUP-1 — the ONE support modal (the advertiser and owner copies were two hand-written twins that
// toasted « Message envoyé » and sent nothing). The toast now follows the api's 201; a failure says
// so; the submit is locked while the request is in flight.
interface Props {
  onClose: () => void;
}

export default function SupportModal({ onClose }: Props) {
  const [objective, setObjective] = useState('');
  const [otherDetail, setOtherDetail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      kind: 'support' as const,
      objective,
      other_detail: otherDetail.trim() || undefined,
      message: message.trim() || undefined,
    };
    const error = supportPayloadError(payload);
    if (error) {
      toast.error(error);
      return;
    }
    setSending(true);
    try {
      await supportService.send(payload);
      toast.success(SUPPORT_SENT_TOAST);
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err) || SUPPORT_FAILED_TOAST);
    } finally {
      setSending(false);
    }
  };

  return (
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
                <p className="text-sm text-gray-500 mt-0.5">Écrivez à l&apos;équipe Toodooh</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <form className="p-4 space-y-4" onSubmit={submit}>
          <div>
            <label
              className="block text-sm font-bold text-gray-900 mb-1.5"
              htmlFor="support-objective"
            >
              Choisissez vos objectifs *
            </label>
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
              id="support-objective"
            >
              <option value="">Choisissez vos objectifs</option>
              {SUPPORT_OBJECTIVES.map((obj) => (
                <option key={obj} value={obj}>
                  {obj}
                </option>
              ))}
            </select>
          </div>
          {isAutreObjective(objective) && (
            <div>
              <label
                className="block text-sm font-bold text-gray-900 mb-1.5"
                htmlFor="support-other-detail"
              >
                Précision *
              </label>
              <input
                type="text"
                value={otherDetail}
                onChange={(e) => setOtherDetail(e.target.value)}
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
              {SUPPORT_COMMENT_LABEL}
            </label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-brand-primary focus:border-brand-primary resize-none"
              placeholder="Votre message ici…"
              id="support-message"
            />
          </div>
          <div className="pt-1 border-t border-dashed border-sky-200 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl font-medium text-gray-900 border border-gray-300 bg-white hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={sending}
              className="flex-1 px-4 py-2.5 rounded-xl font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: '#76E6AB' }}
            >
              {sending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
