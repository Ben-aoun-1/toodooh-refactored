import type { ReactNode } from 'react';

interface TicketShellProps {
  /** The ticket's body: what is played, when. */
  children: ReactNode;
  /** The tear-off stub on the right (the kickoff); none for a ticket of several matches. */
  stub?: ReactNode;
}

/**
 * The match ticket of the mockup: night-green to pitch-green, a mint-and-gold stripe on the left,
 * and — with a stub — the dashed tear line with its two notches.
 */
export default function TicketShell({ children, stub }: TicketShellProps) {
  return (
    <div
      className={`relative mb-4 grid overflow-hidden rounded-xl bg-stadium-ticket shadow-xl shadow-pitch-ink/25 ${
        stub ? 'sm:grid-cols-[minmax(0,1fr)_11rem]' : ''
      }`}
    >
      <div aria-hidden="true" className="absolute inset-y-0 left-0 w-[5px] bg-stadium-stripe" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 right-48 h-40 w-40 rounded-full border-2 border-white/[0.08]"
      />
      <div className="relative min-w-0 py-4 pl-6 pr-5">{children}</div>
      {stub && (
        <>
          <div className="relative flex flex-col items-center justify-center gap-1 border-t-2 border-dashed border-pitch-ink/35 bg-stadium-stub p-3 sm:border-l-2 sm:border-t-0">
            {stub}
          </div>
          <div
            aria-hidden="true"
            className="absolute -top-2.5 right-[calc(11rem-0.625rem)] hidden h-5 w-5 rounded-full bg-pitch-wash sm:block"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-2.5 right-[calc(11rem-0.625rem)] hidden h-5 w-5 rounded-full bg-pitch-wash sm:block"
          />
        </>
      )}
    </div>
  );
}
