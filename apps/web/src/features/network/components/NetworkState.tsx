interface NetworkStateProps {
  message: string;
  /** A failed read offers « Réessayer » — it never renders as an empty network. */
  onRetry?: () => void;
}

/** Loading and error states of the network pages, in the prototype's « empty » block. */
export default function NetworkState({ message, onRetry }: NetworkStateProps) {
  return (
    <div className="wrap">
      <div className="empty" role={onRetry ? 'alert' : 'status'}>
        <p className="rsx-state">{message}</p>
        {onRetry && (
          <button type="button" className="mini" onClick={onRetry}>
            Réessayer
          </button>
        )}
      </div>
    </div>
  );
}
