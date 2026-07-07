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
    <div className="flex flex-col items-center gap-6 py-4">
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onDownload}
          disabled={latestMonth === null || downloading}
          className="inline-flex items-center gap-2 rounded-2xl bg-brand-deep px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-deep/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="h-4 w-4" aria-hidden />
          )}
          Télécharger le rapport (PDF)
        </button>
        {latestMonth === null && (
          <p className="text-xs italic text-gray-400">
            Disponible dès votre premier rapport mensuel.
          </p>
        )}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <div className="text-[10px] font-medium uppercase tracking-widest text-gray-400">
          Powered by
        </div>
        <div className="text-lg font-bold tracking-tight text-brand-deep">
          tood<span className="text-brand-primary">oo</span>h
        </div>
      </div>
    </div>
  );
}
