import { useEffect, useState, type ReactNode } from 'react';

interface DrawerProps {
  /** When true the drawer mounts and slides in; when false it slides out and unmounts. */
  open: boolean;
  /** Fired on backdrop click or Escape. The parent flips `open` to false. */
  onClose: () => void;
  /** Panel width in pixels (e.g. 480 advertiser, 420 owner). */
  width: number;
  children: ReactNode;
}

/**
 * Generic right-anchored slide-over drawer primitive.
 *
 * Owns the enter/exit animation (rAF-driven slide + 300ms exit) and the close
 * affordances (backdrop click, Escape) so consumers only toggle `open`. It is
 * deliberately campaign-agnostic — body content is `children`.
 *
 * Renders inline-fixed (no React portal) to match the pre-extraction inline
 * drawers exactly; a portal can be introduced later if a consumer needs to
 * escape an `overflow`/stacking context.
 *
 * Downstream consumers (composing on this primitive):
 *   - `features/campaigns/components/CampaignDrawer` (this commit, B2)
 *   - Wallet 2.3 statement-detail drawer
 *   - possibly Admin 2.7 detail surfaces
 */
export default function Drawer({ open, onClose, width, children }: DrawerProps) {
  // `present` keeps the node mounted through the exit animation; `visible`
  // drives the slide/opacity. Mirrors the former page-level
  // `showDetailsModal` + `drawerVisible` split.
  const [present, setPresent] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setPresent(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setPresent(false), 300);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!present) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [present, onClose]);

  if (!present) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div
        className={`absolute inset-0 bg-gray-500/75 transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`absolute top-0 bottom-0 right-2 bg-white flex flex-col isolate transform transition-transform duration-300 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          width: `${width}px`,
          boxShadow: '0px 16px 32px rgba(14, 18, 27, 0.102)',
          border: '1px solid #EBEBEB',
          borderRadius: '12px',
        }}
      >
        {children}
      </div>
    </div>
  );
}
