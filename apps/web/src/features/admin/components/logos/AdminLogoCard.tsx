import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

import { adminKeys } from '@/features/admin/hooks/queryKeys';
import {
  type LogoSubjectKind,
  adminLogosService,
} from '@/features/admin/services/admin-logos.service';
import { getErrorMessage } from '@/lib/errors';

/**
 * Agent specs VF « Logos » — the admin adds or replaces the logo of a Screenhost (a venue) or of
 * a Screencaster (an account). His upload is the validated logo at once.
 */
export function AdminLogoCard({ kind, id }: { kind: LogoSubjectKind; id: string }) {
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: adminKeys.logo(kind, id),
    queryFn: () => adminLogosService.current(kind, id),
  });
  const upload = useMutation({
    mutationFn: (file: File) => adminLogosService.upload(kind, id, file),
    onSuccess: async () => {
      toast.success('Logo enregistré.');
      await queryClient.invalidateQueries({ queryKey: adminKeys.logosAll() });
    },
    onError: (e: unknown) => {
      toast.error(getErrorMessage(e) || 'Enregistrement impossible.');
    },
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="flex aspect-[4/3] w-40 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white">
        {current.data ? (
          <img src={current.data} alt="Logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-xs text-gray-400">Aucun logo</span>
        )}
      </div>
      <div>
        <label className="inline-flex cursor-pointer items-center rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep">
          {upload.isPending ? 'Envoi…' : current.data ? 'Remplacer le logo' : 'Ajouter le logo'}
          <input
            type="file"
            accept="image/png,image/jpeg"
            hidden
            disabled={upload.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
        </label>
        <p className="mt-2 text-xs text-gray-500">PNG ou JPEG, 400 × 400 px minimum.</p>
      </div>
    </div>
  );
}
