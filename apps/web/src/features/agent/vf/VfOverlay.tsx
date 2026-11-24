import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface VfOverlayValue {
  /** The large window in the centre (fiche, campaign detail…). */
  openBig: (content: ReactNode) => void;
  /** The small window (support, sign-out, confirmations, forms). */
  openModal: (content: ReactNode) => void;
  closeAll: () => void;
  /** The pill at the bottom of the page, 2.2 s. */
  toast: (text: string) => void;
}

const VfOverlayContext = createContext<VfOverlayValue | null>(null);

export function useVfOverlay(): VfOverlayValue {
  const ctx = useContext(VfOverlayContext);
  if (!ctx) throw new Error('useVfOverlay must be called inside the agent layout');
  return ctx;
}

/**
 * AGENT-VF — the prototype's overlay layer: one veil, one large window, one small window and one
 * toast, each kept mounted so that the stylesheet's own open/close transitions play.
 */
export function VfOverlayProvider({ children }: { children: ReactNode }) {
  const [big, setBig] = useState<ReactNode>(null);
  const [modal, setModal] = useState<ReactNode>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const closeAll = useCallback(() => {
    setBig(null);
    setModal(null);
  }, []);
  const toast = useCallback((text: string) => {
    setToastText(text);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastText(null), 2200);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (big === null && modal === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [big, modal, closeAll]);

  const value = useMemo<VfOverlayValue>(
    () => ({
      openBig: (content) => {
        setModal(null);
        setBig(content);
      },
      openModal: (content) => setModal(content),
      closeAll,
      toast,
    }),
    [closeAll, toast],
  );

  return (
    <VfOverlayContext.Provider value={value}>
      {children}
      <div
        className={`ov${big !== null || modal !== null ? ' on' : ''}`}
        role="presentation"
        onClick={closeAll}
        onKeyDown={(e) => {
          if (e.key === 'Escape') closeAll();
        }}
      />
      <div className={`big${big !== null ? ' on' : ''}`} role="dialog" aria-hidden={big === null}>
        {big}
      </div>
      <div
        className={`modal${modal !== null ? ' on' : ''}`}
        role="dialog"
        aria-hidden={modal === null}
      >
        {modal}
      </div>
      <div className={`toast${toastText !== null ? ' vf-show' : ''}`} role="status">
        {toastText}
      </div>
    </VfOverlayContext.Provider>
  );
}
