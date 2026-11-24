import { useEffect, useState } from 'react';

import { NO_VALUE, countUpAt, formatCount } from '@/features/network/lib/network-format';

/**
 * The prototype's hero counter: climbs from 0 to the value in 900 ms (cubic ease-out), or prints
 * it at once under « réduire les animations ». A value the network does not have prints « – ».
 */
export default function CountUp({ value }: { value: number | null }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (value === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    let frame = 0;
    let t0: number | null = null;
    const step = (t: number) => {
      if (t0 === null) t0 = t;
      const k = Math.min(1, (t - t0) / 900);
      setShown(countUpAt(value, k));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{value === null ? NO_VALUE : formatCount(shown)}</>;
}
