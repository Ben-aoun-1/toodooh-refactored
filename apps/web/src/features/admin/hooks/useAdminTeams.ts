import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { type TeamInput, adminTeamsService } from '@/features/admin/services/admin-teams.service';
import { eventsKeys } from '@/features/events/hooks/queryKeys';

import { adminKeys } from './queryKeys';

// EVT-CAT2 — a team write changes how catalogue cards look: invalidate the teams list, the
// admin event list (its matches embed teams) and the advertiser catalogue.
const useInvalidateTeams = () => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.teams() });
    void queryClient.invalidateQueries({ queryKey: adminKeys.events() });
    void queryClient.invalidateQueries({ queryKey: eventsKeys.all });
  };
};

export function useAdminTeams() {
  return useQuery({
    queryKey: adminKeys.teams(),
    queryFn: () => adminTeamsService.list(),
    select: (d) => d.teams,
  });
}

export function useSaveTeam() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: TeamInput }) =>
      id ? adminTeamsService.update(id, input) : adminTeamsService.create(input),
    onSuccess: invalidate,
  });
}

export function useDeleteTeam() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (id: string) => adminTeamsService.remove(id),
    onSuccess: invalidate,
  });
}

export function useUploadTeamLogo() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      adminTeamsService.uploadLogo(id, file),
    onSuccess: invalidate,
  });
}
