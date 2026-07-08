/** The mockups' `.var` treatment — mono face, the green accent, slightly condensed. */
export function Var({ children }: { children: React.ReactNode }) {
  return (
    <span className="perf-mono whitespace-nowrap text-[0.92em] font-medium text-perf-green">
      {children}
    </span>
  );
}
