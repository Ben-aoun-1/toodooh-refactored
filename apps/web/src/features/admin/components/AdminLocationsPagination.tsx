interface AdminLocationsPaginationProps {
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** The five-slot page window centred on the current page (« 1 2 [3] 4 5 »). */
function pageWindow(currentPage: number, totalPages: number): number[] {
  return Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    if (totalPages <= 5 || currentPage <= 3) return i + 1;
    if (currentPage >= totalPages - 2) return totalPages - 4 + i;
    return currentPage - 2 + i;
  });
}

/** ScreenManagement's table footer: « Affichage de X à Y sur N » + first/prev/pages/next/last. */
export default function AdminLocationsPagination({
  currentPage,
  totalPages,
  itemsPerPage,
  total,
  onPageChange,
}: AdminLocationsPaginationProps) {
  if (totalPages <= 1) return null;
  const edgeButton =
    'relative inline-flex items-center px-2 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50';
  return (
    <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
      <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
        <p className="text-sm text-gray-700">
          Affichage de <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> à{' '}
          <span className="font-medium">{Math.min(currentPage * itemsPerPage, total)}</span> sur{' '}
          <span className="font-medium">{total}</span> résultats
        </p>
        <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
          <button
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            className={`${edgeButton} rounded-l-md`}
            title="Première page"
          >
            «
          </button>
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className={edgeButton}
          >
            ‹
          </button>
          {pageWindow(currentPage, totalPages).map((pageNumber) => (
            <button
              key={pageNumber}
              onClick={() => onPageChange(pageNumber)}
              className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                pageNumber === currentPage
                  ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                  : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {pageNumber}
            </button>
          ))}
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className={edgeButton}
          >
            ›
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            className={`${edgeButton} rounded-r-md`}
            title="Dernière page"
          >
            »
          </button>
        </nav>
      </div>
    </div>
  );
}
