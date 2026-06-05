import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { establishmentService } from '@/features/agent/services/establishment.service';
import type { CreateEstablishmentInput } from '@/features/agent/types/establishment';

const ESTABLISHMENTS_KEY = ['agent', 'establishments'] as const;

/** The acting agent's own establishments (server-scoped to created_by = session user). */
export function useEstablishments() {
  const query = useQuery({
    queryKey: ESTABLISHMENTS_KEY,
    queryFn: () => establishmentService.list(),
  });
  return {
    establishments: query.data ?? [],
    loading: query.isLoading,
    isError: query.isError,
  };
}

/** Create an establishment; invalidates the list so it refreshes after a successful create. */
export function useCreateEstablishment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEstablishmentInput) => establishmentService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ESTABLISHMENTS_KEY }),
  });
}
