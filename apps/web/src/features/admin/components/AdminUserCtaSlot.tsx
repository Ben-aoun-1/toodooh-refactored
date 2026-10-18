import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { adminUserService } from '@/features/admin/services/admin-user.service';
import { getErrorMessage } from '@/lib/errors';

/**
 * QR-CTA1 — the admin's switch for a screencaster's spot QR codes, while the feature is tested
 * quietly. Demo accounts always have it (the switch then says so and stays off).
 */
export default function AdminUserCtaSlot({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const key = ['admin', 'users', userId, 'cta'] as const;
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => adminUserService.getCta(userId),
    enabled: Boolean(userId),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => adminUserService.setCta(userId, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  if (!data) return null;

  const onChange = async (enabled: boolean) => {
    try {
      await toggle.mutateAsync(enabled);
      toast.success(enabled ? 'QR code activé pour ce compte' : 'QR code désactivé');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Modification impossible');
    }
  };

  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <h4 className="font-semibold text-gray-900 mb-2 flex items-center">
        <QrCode className="h-5 w-5 mr-2 text-brand-primary" />
        QR code sur les spots (test)
      </h4>
      {data.is_demo ? (
        <p className="text-sm text-gray-600">Toujours actif sur un compte démo.</p>
      ) : (
        <label className="flex items-center gap-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={data.cta_enabled}
            disabled={toggle.isPending}
            onChange={(e) => void onChange(e.target.checked)}
            className="h-4 w-4 accent-brand-primary"
          />
          Le screencaster peut ajouter un lien « En savoir plus » (QR code) à ses spots
        </label>
      )}
    </div>
  );
}
