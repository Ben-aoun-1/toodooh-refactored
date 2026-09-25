import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type ActorParams,
  type CreateSimulationInput,
  type GenerateWorldInput,
  type LaunchCampaignInput,
  type LaunchEventInput,
  type SandboxPricing,
  type VenueScreensInput,
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

/** SIM-6 — record an agent's verdict on a venue for a simulated event (the board refreshes). */
export function useAttestEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { eventId: string; screenhostId: string; respecte: boolean }) =>
      adminSimulatorService.attest(id, input.eventId, input.screenhostId, input.respecte),
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

// ── SIM-5 — inspectors ────────────────────────────────────────────────────────

export function useSimulationVenueReport(
  id: string,
  venueId: string | null,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: adminKeys.simulationVenueReport(id, venueId ?? '', from, to),
    queryFn: () => adminSimulatorService.venueReport(id, venueId ?? '', from, to),
    enabled: Boolean(venueId) && from <= to,
  });
}

export function useSimulationCampaignEligibleHosts(
  id: string | null,
  campaignId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: adminKeys.simulationEligibleHosts(id ?? '', campaignId),
    queryFn: () => adminSimulatorService.campaignEligibleHosts(id ?? '', campaignId),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

/** SIM-6 phase 2 — the campaign inspector (refetched with the board after each tick). */
export function useSimulationCampaignInspection(id: string, campaignId: string | null) {
  return useQuery({
    queryKey: adminKeys.simulationCampaignInspection(id, campaignId ?? ''),
    queryFn: () => adminSimulatorService.inspectCampaign(id, campaignId ?? ''),
    enabled: Boolean(campaignId),
    retry: false,
  });
}

// ── SIM-6 phase 3 — scenario controls ────────────────────────────────────────

export function useSimulationLaunchOptions(id: string) {
  return useQuery({
    queryKey: adminKeys.simulationLaunchOptions(id),
    queryFn: () => adminSimulatorService.launchOptions(id),
  });
}

/** Force an owner's answer (the REAL decision): the board and the inspectors refresh. */
export function useForceDecision(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { allocationId: string; statut: 'ACCEPTE' | 'REFUSE' }) =>
      adminSimulatorService.decide(id, input.allocationId, input.statut),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.simulation(id) }),
  });
}

export function useVenueScreens(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { venueId: string } & VenueScreensInput) => {
      const { venueId, ...body } = input;
      return adminSimulatorService.venueScreens(id, venueId, body);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.simulationBoard(id) }),
  });
}

export function useSimulationPricing(id: string) {
  return useQuery({
    queryKey: adminKeys.simulationPricing(id),
    queryFn: () => adminSimulatorService.pricing(id),
  });
}

export function useUpdateSimulationPricing(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<SandboxPricing>) => adminSimulatorService.updatePricing(id, input),
    onSuccess: (data) => qc.setQueryData(adminKeys.simulationPricing(id), data),
  });
}

/** Change how an owner answers (acceptance rate, response delay) — the behaviour lives in MAIN. */
export function useOwnerBehaviour(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ownerId, params }: { ownerId: string; params: ActorParams }) =>
      adminSimulatorService.poke(id, ownerId, params),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.worldVenues(id) }),
  });
}
