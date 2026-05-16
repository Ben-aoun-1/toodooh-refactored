import { useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import { advertiserKeys } from './queryKeys';
import type { ClientFormData } from './useClients';

/**
 * Create / update / delete mutations for the advertiser's `clients`.
 *
 * Invalidation graph — every mutation, on success, invalidates
 * `advertiserKeys.clients(userId)`, which refetches the `useClients` query.
 * This replaces the three hand-rolled re-`select` blocks `MyClients.tsx`
 * ran after each write.
 */
export function useClientMutations(userId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidateClients = () =>
    queryClient.invalidateQueries({ queryKey: advertiserKeys.clients(userId ?? '') });

  const createClient = useMutation({
    mutationFn: async (formData: ClientFormData) => {
      const { error } = await supabase.from('clients').insert([{ ...formData, user_id: userId }]);
      if (error) throw error;
    },
    onSuccess: invalidateClients,
  });

  const updateClient = useMutation({
    mutationFn: async ({ id, formData }: { id: string; formData: ClientFormData }) => {
      const { error } = await supabase.from('clients').update(formData).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidateClients,
  });

  const deleteClient = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidateClients,
  });

  return { createClient, updateClient, deleteClient };
}
