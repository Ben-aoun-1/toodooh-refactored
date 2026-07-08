import { Download, Loader2 } from 'lucide-react';

interface DownloadCtaProps {
  /** null → no month exists yet: the button is disabled with a hint. */
  latestMonth: string | null;
  downloading: boolean;
  onDownload: () => void;
}

/** §16 — the bottom "Télécharger le rapport (PDF)" CTA + the mockups' powered-by block. */
export function DownloadCta({ latestMonth, downloading, onDownload }: DownloadCtaProps) {
  return (
    <div className="mt-3">
      <div className="mb-12 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onDownload}
          disabled={latestMonth === null || downloading}
          className="inline-flex items-center gap-3 rounded-full bg-perf-ink px-[34px] py-[17px] text-[15px] font-semibold text-white shadow-[0_6px_20px_rgba(16,37,26,0.16)] transition-colors hover:bg-perf-green disabled:cursor-not-allowed disabled:opacity-40"
        >
          {downloading ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
          ) : (
            <Download className="h-[18px] w-[18px]" aria-hidden />
          )}
          Télécharger le rapport (PDF)
        </button>
        {latestMonth === null && (
          <p className="text-xs italic text-perf-mist">
            Disponible dès votre premier rapport mensuel.
          </p>
        )}
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
