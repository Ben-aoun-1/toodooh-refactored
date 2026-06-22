import { useMutation } from '@tanstack/react-query';

import { screenhostService } from '../services/screenhost.service';

/**
 * On-demand reveal of a screenhost's CURRENT WiFi password (R1, Kais QA).
 *
 * Modelled as a mutation, not a query, on purpose: it fires ONLY when the owner
 * explicitly asks (call `mutateAsync(screenhostId)` on click — never on render),
 * and the decrypted secret is returned to the caller without being cached in the
 * React Query store keyed by screenhost. Returns `{ wifi_password }` (`null` when
 * no password is set).
 */
export function useRevealScreenhostWifi() {
  return useMutation({
    mutationFn: (screenhostId: string) => screenhostService.revealWifi(screenhostId),
  });
}
