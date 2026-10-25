import type { ReactNode } from 'react';

// HOST-EDIT1 — one labelled input of the « Fiche Host » forms, the error under it.
const INPUT_CLASS =
  'w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm focus:border-brand-primary focus:ring-2 focus:ring-brand-primary';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  hint?: string;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email';
}

export function HostField({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  hint,
  inputMode,
}: Props) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        className={INPUT_CLASS}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function HostSelectField({
  id,
  label,
  value,
  onChange,
  error,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <select
        id={id}
        className={INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** A titled white card — every section of the page. */
export function HostSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
