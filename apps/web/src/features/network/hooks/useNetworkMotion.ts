import { type RefObject, useEffect, useLayoutEffect } from 'react';

/**
 * RESEAU-1 — the prototype's scripted motion on the same DOM hooks, without inline styles in the
 * markup: a map dot waits `data-d` ms before it pops, and the portrait's bars grow from 0 to
 * their `data-w` / `data-h` percentage two frames after they are drawn (the CSS transition does
 * the rest, and is switched off under « réduire les animations »).
 */
export function useNetworkMotion(root: RefObject<HTMLElement>) {
  // Before paint, or a dot would start popping and then jump back to wait for its turn.
  useLayoutEffect(() => {
    root.current?.querySelectorAll<SVGElement>('[data-d]').forEach((el) => {
      el.style.animationDelay = `${el.dataset.d ?? '0'}ms`;
    });
  });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        el.querySelectorAll<HTMLElement>('[data-w]').forEach((i) => {
          i.style.width = `${i.dataset.w ?? '0'}%`;
        });
        el.querySelectorAll<HTMLElement>('[data-h]').forEach((i) => {
          i.style.height = `${i.dataset.h ?? '0'}%`;
        });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  });
}
