import type { ReactNode } from 'react';

/** A Dashboard block with a title, an optional action, and its icon + sentence empty state. */
export function DashboardSection({
  title,
  action,
  empty,
  emptyIcon,
  isEmpty,
  children,
}: {
  title: string;
  action?: ReactNode;
  empty: string;
  emptyIcon: ReactNode;
  isEmpty: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#E1E4EA] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[#E1E4EA] px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {isEmpty ? (
        <div className="px-6 py-10 text-center">
          <span className="mx-auto mb-3 flex justify-center text-gray-300">{emptyIcon}</span>
          <p className="mx-auto max-w-md text-sm text-gray-600">{empty}</p>
        </div>
      ) : (
        <div className="p-5">{children}</div>
      )}
    </section>
  );
}
