interface NetworkDockProps {
  label: string;
  text: string;
  action: string;
  show: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The floating bar that rises once something is selected: count, Annuler, « Ne plus diffuser… ». */
export default function NetworkDock({
  label,
  text,
  action,
  show,
  onCancel,
  onConfirm,
}: NetworkDockProps) {
  // Parked below the viewport when empty: it must not be reachable there.
  const tabIndex = show ? undefined : -1;
  return (
    <div
      className={show ? 'dock show' : 'dock'}
      role="region"
      aria-label={label}
      aria-hidden={!show}
    >
      <b>{text}</b>
      <button type="button" className="btn ghost" tabIndex={tabIndex} onClick={onCancel}>
        Annuler
      </button>
      <button type="button" className="btn mint" tabIndex={tabIndex} onClick={onConfirm}>
        {action}
      </button>
    </div>
  );
}
