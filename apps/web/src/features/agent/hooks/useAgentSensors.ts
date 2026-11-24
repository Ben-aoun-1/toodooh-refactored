import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentSensorsService } from '@/features/agent/services/agent-sensors.service';

import { agentKeys } from './queryKeys';

// Agent Screenhost spec VF §12 / §14 — the sensor pages read the hub through the api; a minute
// between refreshes is plenty for counts that move every few minutes.

export const useSensorsOverview = () =>
  useQuery({
    queryKey: agentKeys.sensors(),
    queryFn: () => agentSensorsService.overview(),
    refetchInterval: 60_000,
    retry: false,
  });

export const useSensorVenue = (id: string) =>
  useQuery({
    queryKey: agentKeys.sensorVenue(id),
    queryFn: () => agentSensorsService.venue(id),
    retry: false,
  });

export const useSensorAssignment = () =>
  useQuery({
    queryKey: agentKeys.sensorAssignment(),
    queryFn: () => agentSensorsService.assignment(),
    retry: false,
  });

export const useAssignSensor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { deviceId: string; screenhostId: string }) =>
      agentSensorsService.assign(v.deviceId, v.screenhostId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: agentKeys.sensors() }),
  });
};
