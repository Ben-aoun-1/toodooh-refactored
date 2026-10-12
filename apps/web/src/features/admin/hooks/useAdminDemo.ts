import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminDemoService,
  type CreateDemoAccountBody,
} from '@/features/admin/services/admin-demo.service';

import { adminKeys } from './queryKeys';

/** DEMO-1 — the whole « Démo » page. Re-read every 15 s so « à l'antenne dans X min » moves. */
export function useDemoPage() {
  return useQuery({
    queryKey: adminKeys.demo(),
    queryFn: () => adminDemoService.get(),
    refetchInterval: 15_000,
  });
}

/** Every demo mutation re-reads the page on success. */
function useDemoMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.demo() });
    },
  });
}

export const useSetDemoDelay = () =>
  useDemoMutation((minutes: number) => adminDemoService.setDelay(minutes));

export const useSetDemoVenues = () =>
  useDemoMutation((ids: string[]) => adminDemoService.setVenues(ids));

export const useCreateDemoAccount = () =>
  useDemoMutation((body: CreateDemoAccountBody) => adminDemoService.createAccount(body));

export const useCreditDemoAccount = () =>
  useDemoMutation((v: { id: string; amountTnd: number }) =>
    adminDemoService.credit(v.id, v.amountTnd),
  );

export const useDeleteDemoAccount = () =>
  useDemoMutation((id: string) => adminDemoService.deleteAccount(id));
