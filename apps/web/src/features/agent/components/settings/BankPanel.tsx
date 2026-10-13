import { Upload } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useUploadAgentRib } from '@/features/agent/hooks/useAgentAccount';
import type { AgentAccount } from '@/features/agent/services/agent-account.service';
import { getErrorMessage } from '@/lib/errors';

const STATUS_FR = {
  non_fourni: 'Non fourni',
  en_attente: 'En attente de validation',
  valide: 'Validé',
  refuse: 'Refusé',
};
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * AGT-1b — « Mes coordonnées bancaires » (spec §2): the RIB status and its deposit (PDF, JPG,
 * PNG, 5 Mo). A new deposit goes back to « En attente de validation »; a validated RIB stays in
 * use until the new one is validated. No payout is sent before a RIB is validated.
 */
export function BankPanel({ rib }: { rib: AgentAccount['rib'] }) {
  const upload = useUploadAgentRib();
  const send = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error('Fichier trop lourd (5 Mo max).');
      return;
    }
    try {
      await upload.mutateAsync(file);
      toast.success('RIB envoyé — en attente de validation');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Envoi impossible');
    }
  };
  return (
    <section className="space-y-3 rounded-lg border border-[#E1E4EA] p-4">
      <h3 className="text-sm font-semibold">Mes coordonnées bancaires</h3>
      <p className="text-sm">
        Statut du RIB : <span className="font-medium">{STATUS_FR[rib.status]}</span>
        {rib.file_name ? ` — ${rib.file_name}` : ''}
      </p>
      {rib.status === 'refuse' && rib.refusal_reason && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Motif : {rib.refusal_reason}
        </p>
      )}
      {rib.status === 'en_attente' && rib.validated && (
        <p className="text-xs text-[#5C5C5C]">
          Votre RIB validé précédent reste utilisé jusqu’à la validation du nouveau.
        </p>
      )}
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
        <Upload className="h-4 w-4" />
        {rib.status === 'non_fourni' ? 'Téléverser mon RIB' : 'Remplacer mon RIB'}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f);
            e.target.value = '';
          }}
        />
      </label>
      <p className="text-xs text-[#5C5C5C]">PDF, JPG, JPEG ou PNG, 5 Mo maximum.</p>
    </section>
  );
}
