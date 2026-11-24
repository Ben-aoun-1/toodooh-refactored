import { type RefObject, useEffect } from 'react';

import { vfCountAt, vfCountTarget } from '@/features/agent/lib/agent-format';

const HALO = '.kpi,.camp,.shc,.rev,.step';

/**
 * AGENT-VF (spec VF §0 « Conserver toutes les animations ») — the prototype's three scripted
 * effects, on the same DOM hooks: the page and header replay their entrance on every page change,
 * the figure of each `.kpi b` climbs from 0 in 1.1 s, and a card under the pointer receives
 * `--mx` / `--my` for its halo. With « réduire les animations » the counters do not move (the
 * entrance keyframes are already inside a `prefers-reduced-motion` media query).
 */
export function useVfMotion(
  view: RefObject<HTMLElement>,
  top: RefObject<HTMLElement>,
  pageKey: string,
) {
  useEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const el of [view.current, top.current]) {
      if (!el) continue;
      el.classList.remove('enter');
      void el.offsetWidth;
      el.classList.add('enter');
    }
    if (calm || !view.current) return;
    const root = view.current;
    const done = new WeakSet<Element>();
    const frames: number[] = [];
    const climb = () => {
      root.querySelectorAll<HTMLElement>('.kpi b').forEach((b) => {
        if (done.has(b)) return;
        // React owns the text node: write into it, never replace it.
        const node = b.childNodes.length === 1 ? b.firstChild : null;
        if (!(node instanceof Text)) return;
        const original = node.data;
        const to = vfCountTarget(original);
        if (to === null) return;
        done.add(b);
        let t0: number | null = null;
        const step = (ts: number) => {
          if (!b.isConnected) return;
          if (t0 === null) t0 = ts;
          const k = Math.min(1, (ts - t0) / 1100);
          node.data = k < 1 ? vfCountAt(to, k) : original;
          if (k < 1) frames.push(requestAnimationFrame(step));
        };
        node.data = '0';
        frames.push(requestAnimationFrame(step));
      });
    };
    climb();
    // The figures arrive with the data: a counter that mounts later climbs once too.
    const observer = new MutationObserver(climb);
    observer.observe(root, { childList: true, subtree: true });
    const stop = window.setTimeout(() => observer.disconnect(), 4000);
    return () => {
      observer.disconnect();
      window.clearTimeout(stop);
      frames.forEach((f) => cancelAnimationFrame(f));
    };
  }, [view, top, pageKey]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>(HALO) : null;
      if (!target) return;
      const r = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${e.clientX - r.left}px`);
      target.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
  }, []);
}
