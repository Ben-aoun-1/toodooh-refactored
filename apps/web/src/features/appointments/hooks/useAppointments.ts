import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appointmentsService } from '../services/appointments.service';

import { appointmentKeys } from './queryKeys';

// AGT-5 — both sides re-read every appointment query after any change (one shared cache prefix).

export const useReferent = (enabled = true) =>
  useQuery({
    queryKey: appointmentKeys.referent(),
    queryFn: () => appointmentsService.referent(),
    enabled,
  });

export const useAvailability = (month: string, enabled = true) =>
  useQuery({
    queryKey: appointmentKeys.availability(month),
    queryFn: () => appointmentsService.availability(month),
    enabled,
  });

export const useMyAppointments = (enabled = true) =>
  useQuery({
    queryKey: appointmentKeys.mine(),
    queryFn: () => appointmentsService.mine(),
    enabled,
  });

export const useAgentCalendar = (month: string) =>
  useQuery({
    queryKey: appointmentKeys.agentCalendar(month),
    queryFn: () => appointmentsService.agentCalendar(month),
  });

export const useAgentAppointments = () =>
  useQuery({
    queryKey: appointmentKeys.agentList(),
    queryFn: () => appointmentsService.agentAppointments(),
    refetchOnMount: 'always',
    // Same 15 s cadence as the bell, so a new request shows in « Mes rendez-vous » too.
    refetchInterval: 15_000,
  });

export function useAppointmentMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
