import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import { advertiserKeys } from './queryKeys';

export interface Client {
  id: string;
  user_id: string;
  name: string;
  contact_email: string;
  contact_phone: string;
  societe: string | null;
  created_at: string;
}

export interface ClientFormData {
  name: string;
  contact_email: string;
  contact_phone: string;
  societe: string;
}

interface UseClientsResult {
  clients: Client[];
  loading: boolean;
}

/**
 * Loads the advertiser's `clients` rows. A fetch error leaves `clients`
 * empty — mirroring the pre-React-Query `if (!error) setClients(...)`
 * behavior on `MyClients.tsx`.
 */
export function useClients(userId: string | undefined): UseClientsResult {
  const query = useQuery({
    queryKey: advertiserKeys.clients(userId ?? ''),
    queryFn: async (): Promise<Client[]> => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', userId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Client[];
    },
    enabled: !!userId,
  });

  return {
    clients: query.data ?? [],
    loading: query.isLoading,
  };
}
