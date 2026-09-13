import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type CreateSimulationInput,
  adminSimulatorService,
} from '@/features/admin/services/admin-simulator.service';

import { adminKeys } from './queryKeys';

export function useSimulations() {
  return useQuery({
    queryKey: adminKeys.simulations(),
    queryFn: () => adminSimulatorService.list(),
  });
}

/** Polls every 2 s while the sandbox is still being created. */
export function useSimulation(id: string | null) {
  return useQuery({
    queryKey: adminKeys.simulation(id ?? ''),
    queryFn: () => adminSimulatorService.get(id ?? ''),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'creating' ? 2000 : false),
  });
}

export function useSimulationProbe(id: string | null, ready: boolean) {
  return useQuery({
    queryKey: adminKeys.simulationProbe(id ?? ''),
    queryFn: () => adminSimulatorService.probe(id ?? ''),
    enabled: Boolean(id) && ready,
  });
}

export function useCreateSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSimulationInput) => adminSimulatorService.create(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.simulations() }),
  });
}

export function useDeleteSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminSimulatorService.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.simulations() }),
  });
}
