import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * AGENT-VF (spec VF §13 / §9) — `?rdv=1` (the bell's « Répondre » and the email's button) opens
 * « Prendre rendez-vous », where the affiliate answers his agent's request. The flag is consumed
 * so that a refresh does not reopen the window.
 */
export function useRdvFlag(open: () => void): void {
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('rdv') !== '1') return;
    open();
    const next = new URLSearchParams(searchParams);
    next.delete('rdv');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, open]);
}
