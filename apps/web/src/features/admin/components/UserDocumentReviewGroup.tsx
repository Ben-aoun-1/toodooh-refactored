import { FileText } from 'lucide-react';

import type { AdminDocumentView } from '@/features/admin/services/admin-user.service';

// F-docs Commit 3 — one category's slice of the admin grouped-document review. rne / complémentaire
// / bank are flat lists (server-capped at 2 / 10 / 1). Each present document presigns by id on the
// "Voir" click (getDocumentUrlById) — never the legacy category shim, which only reaches the first.
// CIN-HOST1 (2026-09-21): the CIN view is gone — the api never lists a CIN any more.

interface UserDocumentReviewGroupProps {
  /** Section label, e.g. "Registre de commerce" / "Documents complémentaires". */
  label: string;
  /** When true (server cap 1, e.g. bank) render ONE row keyed by `label`, not a filename list. */
  single?: boolean;
  /** Adds the modal's `border-t … mt-2` divider above the group's first row (matches the old layout). */
  topBorder?: boolean;
  docs: AdminDocumentView[];
  loading: boolean;
  onView: (docId: string) => void;
}

function ViewButton({ docId, onView }: { docId: string; onView: (docId: string) => void }) {
  return (
    <button
      onClick={() => onView(docId)}
      className="flex items-center text-brand-primary hover:text-brand-primary/90 font-medium transition-colors"
    >
      <FileText className="h-4 w-4 mr-1" />
      Voir le document
    </button>
  );
}

function Row({
  rowLabel,
  first,
  topBorder,
  children,
}: {
  rowLabel: string;
  first: boolean;
  topBorder: boolean;
  children: React.ReactNode;
}) {
  const divider = first && topBorder ? ' border-t border-gray-200 mt-2' : '';
  return (
    <div className={`flex justify-between items-center pt-2${divider}`}>
      <span className="text-gray-600">{rowLabel}</span>
      {children}
    </div>
  );
}

export default function UserDocumentReviewGroup({
  label,
  single = false,
  topBorder = false,
  docs,
  loading,
  onView,
}: UserDocumentReviewGroupProps) {
  if (loading) {
    return (
      <Row rowLabel={label} first topBorder={topBorder}>
        <span className="text-xs text-gray-500">Chargement…</span>
      </Row>
    );
  }

  if (single) {
    const doc = docs[0];
    return (
      <Row rowLabel={label} first topBorder={topBorder}>
        {doc ? (
          <ViewButton docId={doc.id} onView={onView} />
        ) : (
          <span className="text-xs text-gray-500">Non fourni</span>
        )}
      </Row>
    );
  }

  if (docs.length === 0) {
    return (
      <Row rowLabel={label} first topBorder={topBorder}>
        <span className="text-xs text-gray-500">Non fourni</span>
      </Row>
    );
  }

  // Flat list (rne / complémentaire): one row per document, keeping the category label on every row
  // and surfacing the filename beneath it (the admin reviews the actual upload).
  const divider = topBorder ? ' border-t border-gray-200 mt-2' : '';
  return (
    <>
      {docs.map((doc, index) => (
        <div
          key={doc.id}
          className={`flex justify-between items-center pt-2${index === 0 ? divider : ''}`}
        >
          <span className="text-gray-600">
            {label}
            <span className="block text-xs text-gray-400">{doc.original_filename}</span>
          </span>
          <ViewButton docId={doc.id} onView={onView} />
        </div>
      ))}
    </>
  );
}
