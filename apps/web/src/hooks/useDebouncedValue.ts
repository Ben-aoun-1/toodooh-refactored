import { useEffect, useState } from 'react';

/**
 * The value, once it has stopped changing for `delayMs`. A drag on a 1-TND-step slider fires a
 * change per step; a server read keyed on the debounced value fires once the hand stops.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
