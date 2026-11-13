interface MinutesClockProps {
  /** The minutes chosen; null = nothing chosen yet (shows « — »). */
  minutes: number | null;
  /** « minutes », « minutes au total »… — singular handled by the caller. */
  unit: string;
}

const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** The cursor's read-out, as the mockup's scoreboard: mint figures on night green. */
export default function MinutesClock({ minutes, unit }: MinutesClockProps) {
  return (
    <p className="inline-flex items-baseline gap-1.5 rounded-lg bg-pitch-ink px-4 py-1.5 tabular-nums ring-1 ring-inset ring-brand-primary/30">
      <span className="text-3xl font-semibold text-brand-primary">
        {minutes == null ? '—' : integer.format(minutes)}
      </span>
      {minutes != null && <span className="text-sm text-pitch-mist">{unit}</span>}
    </p>
  );
}
