/** The mockup's ball (Mariem 04/11) — the stepper's current step. Takes the text colour. */
export default function FootballGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <circle
        cx="12"
        cy="12"
        r="11"
        className="fill-white"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M12 6.5l3.6 2.6-1.4 4.2H9.8L8.4 9.1z" fill="currentColor" />
      <path
        d="M12 1v5.5M2.3 9l6.1.1M21.7 9l-6.1.1M6 20l3.8-6.7M18 20l-3.8-6.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}
