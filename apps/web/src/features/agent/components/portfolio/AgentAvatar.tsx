import { initialsOf } from '@/features/agent/lib/agent-portfolio';

/** The standard avatar: the Screencaster has no logo upload yet, so initials (spec §4 « Logos »). */
export function AgentAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dims =
    size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm';
  return (
    <span
      title={name}
      className={`${dims} flex flex-shrink-0 items-center justify-center rounded-full bg-brand-primary/15 font-semibold text-brand-deep`}
    >
      {initialsOf(name)}
    </span>
  );
}
