import { Download, FileCheck2, Loader2 } from 'lucide-react';

interface DownloadCtaProps {
  /** false until EITHER first-data flag flips — an all-empty period report has nothing to say. */
  hasData: boolean;
  /**
   * PERF-DL1 — the two-phase download state: 'idle' offers « Télécharger » (starts the ~30 s
   * render), 'generating' disables with an explicit in-flight label, 'ready' offers
   * « Enregistrer » whose FRESH click performs the gesture-carrying save.
   */
  phase: 'idle' | 'generating' | 'ready';
  onGenerate: () => void;
  onSave: () => void;
  /**
   * PERF-QA1 R4 — shown when the active period exceeds the api's 400-day bound: the request is
   * clamped client-side and the user is TOLD which range the PDF will cover.
   */
  clampNote: string | null;
}

/**
 * §16 — the bottom period-report CTA + the mockups' powered-by block. R1: the ON-DEMAND period
 * report for the page's ACTIVE filter range (the monthly card / history buttons keep their
 * stored-artifact URLs). PERF-DL1: two clicks by design — the render outlives the browser's
 * transient activation, so the SAVE must ride its own click (see lib/period-report.ts).
 */
export function DownloadCta({ hasData, phase, onGenerate, onSave, clampNote }: DownloadCtaProps) {
  return (
    <div className="mt-3">
      <div className="mb-12 flex flex-col items-center gap-2">
        {phase === 'ready' ? (
          <button
            type="button"
            onClick={onSave}
            className="inline-flex items-center gap-3 rounded-full bg-perf-green px-[34px] py-[17px] text-[15px] font-semibold text-white shadow-[0_6px_20px_rgba(16,37,26,0.16)] transition-colors hover:bg-perf-ink"
          >
            <FileCheck2 className="h-[18px] w-[18px]" aria-hidden />
            Enregistrer le rapport (PDF)
          </button>
        ) : (
          <button
            type="button"
            onClick={onGenerate}
            disabled={!hasData || phase === 'generating'}
            className="inline-flex items-center gap-3 rounded-full bg-perf-ink px-[34px] py-[17px] text-[15px] font-semibold text-white shadow-[0_6px_20px_rgba(16,37,26,0.16)] transition-colors hover:bg-perf-green disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase === 'generating' ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
            ) : (
              <Download className="h-[18px] w-[18px]" aria-hidden />
            )}
            {phase === 'generating'
              ? 'Génération en cours… (environ 30 s)'
              : 'Télécharger le rapport (PDF)'}
          </button>
        )}
        {phase === 'ready' && (
          <p className="text-xs text-perf-grey">
            Votre rapport est prêt — cliquez pour l’enregistrer.
          </p>
        )}
        {!hasData && (
          <p className="text-xs italic text-perf-mist">Disponible dès vos premières données.</p>
        )}
        {hasData && phase !== 'ready' && clampNote && (
          <p className="text-xs text-perf-grey">{clampNote}</p>
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
