import { QrCode } from 'lucide-react';

import { formatIntFr } from '@/features/screenhost/lib/performance-derive';
import { formatDateFr } from '@/features/screenhost/lib/performance-period';

import {
  QR_DAY_ROWS,
  hourRangeLabel,
  peakHour,
  qrRateLabel,
  recentScanDays,
  scanBarPct,
  scansLabel,
} from '../../lib/qr-scans-display';
import type { QrScansWire } from '../../services/performances.service';

import { CHART_GREEN, Card, KpiCell, SectionHeading } from './shared';

/**
 * QR-SCAN1 (operator 16/11) — « Scans du QR code »: the visits to the screencaster's link from
 * the QR shown on the spot. Only when at least one analysed campaign has a QR code. One QR per
 * campaign, so the figures are per campaign, never per venue.
 */
export function QrScansSection({ qr, single }: { qr: QrScansWire; single: boolean }) {
  const peak = peakHour(qr.by_hour);
  const days = recentScanDays(qr.by_day);
  const dayValues = days.map((d) => d.scans);

  return (
    <section className="mb-[64px]" aria-labelledby="qr-scans-title">
      <SectionHeading
        num="QR code"
        title="Scans du QR code"
        lead={
          single
            ? 'Les visites de votre lien depuis le QR code affiché pendant votre spot.'
            : `Les visites de vos liens depuis le QR code, sur ${qr.campaign_count} campagne${qr.campaign_count > 1 ? 's' : ''} avec QR code.`
        }
      />
      <span id="qr-scans-title" className="sr-only">
        Scans du QR code
      </span>
      <div className="mt-8 grid grid-cols-1 border-t-2 border-t-perf-green md:grid-cols-4 md:border-b md:border-b-perf-line">
        <KpiCell
          accent
          label="Scans"
          value={formatIntFr(qr.scans)}
          detail="Nombre de fois où le QR code a été scanné."
        />
        <KpiCell
          label="Personnes uniques"
          value={formatIntFr(qr.unique_visitors)}
          detail="Une personne est comptée une fois par jour."
        />
        <KpiCell
          label="Pour 1 000 impressions"
          value={qrRateLabel(qr.per_1000_impressions)}
          detail="Scans rapportés aux impressions générées."
        />
        <KpiCell label="Heure la plus active" value={peak === null ? '—' : hourRangeLabel(peak)} />
      </div>
      <Card className="mt-6">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-perf-ink">
          <QrCode className="h-4 w-4 text-perf-green" aria-hidden />
          Scans par jour
        </div>
        {qr.by_day.length > QR_DAY_ROWS ? (
          <div className="text-[12.5px] text-perf-grey">
            Les {QR_DAY_ROWS} derniers jours avec un scan
          </div>
        ) : null}
        {days.length === 0 ? (
          <p className="mt-4 text-[13.5px] italic text-perf-mist">
            Votre QR code n’a pas encore été scanné pendant la diffusion.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {days.map((d) => (
              <div key={d.date}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] font-medium text-perf-ink">
                    {formatDateFr(d.date)}
                  </span>
                  <span className="perf-mono whitespace-nowrap text-[13px] font-semibold text-perf-ink">
                    {scansLabel(d.scans)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-perf-soft">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{ width: `${scanBarPct(d.scans, dayValues)}%`, background: CHART_GREEN }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-5 text-[12px] italic text-perf-mist">
          Aucune donnée personnelle n’est conservée : ni adresse, ni téléphone.
        </p>
      </Card>
    </section>
  );
}
