import { Download, Loader2 } from 'lucide-react';

interface DownloadCtaProps {
  /** false until EITHER first-data flag flips — an all-empty period report has nothing to say. */
  hasData: boolean;
  downloading: boolean;
  onDownload: () => void;
  /**
   * PERF-QA1 R4 — shown when the active period exceeds the api's 400-day bound: the request is
   * clamped client-side and the user is TOLD which range the PDF will cover.
   */
  clampNote: string | null;
}

/**
 * §16 — the bottom "Télécharger le rapport (PDF)" CTA + the mockups' powered-by block. R1: the
 * button now downloads the ON-DEMAND period report for the page's ACTIVE filter range (the
 * monthly card / history buttons keep their stored-artifact URLs).
 */
export function DownloadCta({ hasData, downloading, onDownload, clampNote }: DownloadCtaProps) {
  return (
    <div className="mt-3">
      <div className="mb-12 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onDownload}
          disabled={!hasData || downloading}
          className="inline-flex items-center gap-3 rounded-full bg-perf-ink px-[34px] py-[17px] text-[15px] font-semibold text-white shadow-[0_6px_20px_rgba(16,37,26,0.16)] transition-colors hover:bg-perf-green disabled:cursor-not-allowed disabled:opacity-40"
        >
          {downloading ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
          ) : (
            <Download className="h-[18px] w-[18px]" aria-hidden />
          )}
          Télécharger le rapport (PDF)
        </button>
        {!hasData && (
          <p className="text-xs italic text-perf-mist">Disponible dès vos premières données.</p>
        )}
        {hasData && clampNote && <p className="text-xs text-perf-grey">{clampNote}</p>}
      </div>
      <div className="flex flex-col items-center gap-3 border-t border-perf-soft pt-7">
        <div className="perf-mono text-[10px] uppercase tracking-[0.18em] text-perf-mist">
          Powered by
        </div>
        <div className="text-lg font-semibold tracking-[-0.01em] text-perf-ink">
          tood<span className="text-perf-green">oo</span>h
        </div>
      </div>
    </div>
  );
}
