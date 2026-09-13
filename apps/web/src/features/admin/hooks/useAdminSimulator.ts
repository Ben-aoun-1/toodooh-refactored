import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type ActorParams,
  type CreateSimulationInput,
  type GenerateWorldInput,
  type LaunchCampaignInput,
  type LaunchEventInput,
  adminSimulatorService,
  isNoWorld,
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

// ── SIM-1 — the generated world ────────────────────────────────────────────────

export function useWorld(id: string | null, ready: boolean) {
  return useQuery({
    queryKey: adminKeys.world(id ?? ''),
    queryFn: () => adminSimulatorService.world(id ?? ''),
    enabled: Boolean(id) && ready,
    // « pas encore de monde » is the normal first state, not a failure to retry.
    retry: (count, error) => !isNoWorld(error) && count < 1,
  });
}

export function useWorldVenues(id: string | null, hasWorld: boolean) {
  return useQuery({
    queryKey: adminKeys.worldVenues(id ?? ''),
    queryFn: () => adminSimulatorService.venues(id ?? ''),
    enabled: Boolean(id) && hasWorld,
  });
}

export function useGenerateWorld(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateWorldInput) => adminSimulatorService.generateWorld(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.world(id) });
      void qc.invalidateQueries({ queryKey: adminKeys.worldVenues(id) });
      void qc.invalidateQueries({ queryKey: adminKeys.simulationProbe(id) });
    },
  });
}

// ── SIM-2 / SIM-3 — the living world ──────────────────────────────────────────

/** The board. Refetched after every tick; `live` also polls, so a running clock animates. */
export function useBoard(id: string | null, enabled: boolean, live: boolean) {
  return useQuery({
    queryKey: adminKeys.simulationBoard(id ?? ''),
    queryFn: () => adminSimulatorService.state(id ?? ''),
    enabled: Boolean(id) && enabled,
    refetchInterval: live ? 2000 : false,
  });
}

/** One click of the clock. Everything the hour touched is invalidated on the way back. */
export function useTick(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hours: number) => adminSimulatorService.tick(id, hours),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.simulationBoard(id) });
      void qc.invalidateQueries({ queryKey: adminKeys.simulation(id) });
      void qc.invalidateQueries({ queryKey: adminKeys.worldVenues(id) });
    },
  });
}

export function useLaunchCampaign(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LaunchCampaignInput) => adminSimulatorService.launch(id, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.simulationBoard(id) }),
  });
}

export function usePokeActor(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityId, params }: { entityId: string; params: ActorParams }) =>
      adminSimulatorService.poke(id, entityId, params),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.simulationBoard(id) }),
  });
}

export function useLaunchEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LaunchEventInput) => adminSimulatorService.launchEvent(id, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.simulationBoard(id) }),
  });
}
