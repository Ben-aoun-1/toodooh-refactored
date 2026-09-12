import { formatIntFr } from '@/features/screenhost/lib/performance-derive';
import { formatTnd } from '@/lib/money';

import {
  PERIOD_EMPTY,
  budgetLabel,
  budgetTtcNote,
  cspCharacteristics,
  isLowCoverage,
  listOrDash,
} from '../../lib/performances-derive';
import type { AnalysisWire } from '../../services/performances.service';

import {
  BarRow,
  CHART_ACCENT,
  CHART_GREEN,
  CSP_COLORS,
  Card,
  Donut,
  KpiCell,
  LegendDot,
  NaturePill,
  SEX_COLORS,
  SectionHeading,
} from './shared';

/**
 * Epic 7 — sections 01–04 (RG-PERF-20..27). Campaign mode = that campaign; Period mode = the sum
 * over the closed campaigns in the period. Section 05 is OUT. Every montant HT with the TTC in
 * parentheses; impressions always « générées »; audience numbers describe the venues' audience,
 * never a person (RG-PERF-04/26).
 */
export function AnalysisSections({ analysis }: { analysis: AnalysisWire }) {
  const single = analysis.mode === 'campaign';
  const n = analysis.overview.campaign_count;
  const empty = !single && n === 0;

  return (
    <div id="analyse">
      {/* ── Section 01 ─────────────────────────────────────────────────────── */}
      <section className="mb-[64px]">
        <SectionHeading
          num="Section 01"
          title="Vue d'ensemble"
          lead={
            single
              ? 'Les indicateurs clés atteints par cette campagne.'
              : n > 0
                ? `La somme des indicateurs sur le périmètre sélectionné, agrégée sur ${n} campagne${n > 1 ? 's' : ''}.`
                : PERIOD_EMPTY
          }
        />
        {!single && n > 0 ? (
          <Card className="mt-6">
            <div className="perf-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-perf-mist">
              Campagnes concernées et leurs caractéristiques principales
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {analysis.campaigns.map((c) => (
                <div key={c.id} className="rounded-lg border border-perf-line bg-perf-page/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13.5px] font-semibold text-perf-ink">{c.name}</span>
                    <NaturePill nature={c.nature} />
                  </div>
                  <dl className="mt-3 space-y-1.5 text-[12.5px]">
                    <div className="flex justify-between gap-3">
                      <dt className="text-perf-mist">Catégories</dt>
                      <dd className="text-right text-perf-ink">{listOrDash(c.categories)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-perf-mist">Classes</dt>
                      <dd className="text-right text-perf-ink">
                        {listOrDash(cspCharacteristics(c.csp_shares))}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-perf-mist">Budget</dt>
                      <dd className="perf-mono text-right text-perf-ink">
                        {budgetLabel(c.budget_ht)}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
        {empty ? null : (
          <div className="mt-8 grid grid-cols-1 border-t-2 border-t-perf-green md:grid-cols-3 md:border-b md:border-b-perf-line">
            {!single ? (
              <KpiCell
                accent
                label="Campagnes concernées"
                value={String(n)}
                detail="Campagnes clôturées sur la période retenue."
              />
            ) : null}
            <KpiCell
              accent={single}
              label="Impressions générées"
              value={formatIntFr(analysis.overview.impressions)}
              detail="Vues valorisées de votre marque."
            />
            <KpiCell
              label="Heures de diffusion"
              value={formatIntFr(analysis.overview.hours)}
              suffix="h"
              detail="Durée totale de présence à l’antenne."
            />
            <KpiCell
              label="Diffusions du spot"
              value={formatIntFr(analysis.overview.plays)}
              detail="Nombre de fois où votre spot a été joué."
            />
            <KpiCell
              label="Établissements diffuseurs"
              value={formatIntFr(analysis.overview.venues)}
              detail={
                single
                  ? 'Lieux ayant diffusé votre spot.'
                  : 'Cumul des lieux diffuseurs sur la période.'
              }
            />
            <KpiCell
              label="Budget investi"
              value={formatTnd(analysis.overview.budget_ht)}
              suffix="TND HT"
              detail={budgetTtcNote(analysis.overview.budget_ht)}
            />
          </div>
        )}
      </section>

      {/* ── Section 02 ─────────────────────────────────────────────────────── */}
      <section className="mb-[64px]">
        <SectionHeading
          num="Section 02"
          title="Répartition par catégorie de lieu"
          lead="La part de vos impressions générées selon le type d'établissement diffuseur. Vérifiez l'adéquation avec votre ciblage."
        />
        <Card className="mt-6">
          {analysis.categories.length === 0 ? (
            <p className="text-[13.5px] italic text-perf-mist">{PERIOD_EMPTY}</p>
          ) : (
            <div className="space-y-4">
              {analysis.categories.map((row) => (
                <BarRow key={row.key} row={row} rows={analysis.categories} unit="impr." />
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* ── Section 03 ─────────────────────────────────────────────────────── */}
      <section className="mb-[64px]">
        <SectionHeading
          num="Section 03"
          title="Profil de l'audience et niveau CSP"
          lead="Le profil des lieux où votre marque a diffusé, par niveau de gamme, et la composition de l'audience mesurée dans ces lieux pendant la diffusion. Ces nombres décrivent l'audience présente, sans identifier aucune personne."
        />
        <div className="mt-6 grid grid-cols-1 gap-[18px] lg:grid-cols-2">
          <Card>
            <div className="text-[15px] font-semibold text-perf-ink">Par niveau CSP</div>
            <div className="text-[12.5px] text-perf-grey">Part des impressions générées</div>
            {analysis.overview.impressions === 0 ? (
              <p className="mt-6 text-[13.5px] italic text-perf-mist">{PERIOD_EMPTY}</p>
            ) : (
              <>
                <Donut
                  segments={analysis.csp.map((s, i) => ({
                    value: s.value,
                    color: CSP_COLORS[i % CSP_COLORS.length] ?? CHART_GREEN,
                  }))}
                  caption="niveaux CSP"
                />
                <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1.5">
                  {analysis.csp.map((s, i) => (
                    <LegendDot key={s.key} color={CSP_COLORS[i % CSP_COLORS.length] ?? CHART_GREEN}>
                      {s.label} · {s.pct.toLocaleString('fr-FR')} %
                    </LegendDot>
                  ))}
                </div>
              </>
            )}
          </Card>
          <Card>
            <div className="text-[15px] font-semibold text-perf-ink">
              Audience mesurée dans les lieux
            </div>
            <div className="text-[12.5px] text-perf-grey">Composition par sexe et par âge</div>
            {analysis.audience === null ? (
              <p className="mt-6 text-[13.5px] italic text-perf-mist">{PERIOD_EMPTY}</p>
            ) : (
              <>
                <h4 className="perf-mono mt-5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-perf-mist">
                  Par sexe
                </h4>
                <div className="mt-3 space-y-3.5">
                  {analysis.audience.sex.map((row, i) => (
                    <BarRow
                      key={row.key}
                      row={row}
                      rows={analysis.audience?.sex ?? []}
                      unit=""
                      color={SEX_COLORS[i] ?? CHART_ACCENT}
                    />
                  ))}
                </div>
                <h4 className="perf-mono mt-6 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-perf-mist">
                  Par tranche d'âge
                </h4>
                <div className="mt-3 space-y-3.5">
                  {analysis.audience.age.map((row) => (
                    <BarRow
                      key={row.key}
                      row={row}
                      rows={analysis.audience?.age ?? []}
                      unit=""
                      color={CHART_GREEN}
                    />
                  ))}
                </div>
                {analysis.audience.unprofiled_impressions > 0 ? (
                  <p className="mt-4 text-[12px] italic leading-[1.5] text-perf-mist">
                    {formatIntFr(analysis.audience.unprofiled_impressions)} impressions générées
                    dans {analysis.audience.unprofiled_venues} établissement
                    {analysis.audience.unprofiled_venues > 1 ? 's' : ''} sans profil d’audience
                    renseigné ne sont pas ventilées.
                  </p>
                ) : null}
              </>
            )}
          </Card>
        </div>
      </section>

      {/* ── Section 04 ─────────────────────────────────────────────────────── */}
      <section className="mb-[64px]">
        <SectionHeading
          num="Section 04"
          title="Répartition par zone géographique"
          lead="La couverture de vos impressions sur le Grand Tunis. Repérez vos zones fortes et vos zones absentes."
        />
        <Card className="mt-6">
          {analysis.zones.length === 0 ? (
            <p className="text-[13.5px] italic text-perf-mist">{PERIOD_EMPTY}</p>
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
              {analysis.zones.map((row) => {
                const low = isLowCoverage(row.pct);
                return (
                  <BarRow
                    key={row.key}
                    row={row}
                    rows={analysis.zones}
                    unit="impressions"
                    muted={low}
                    trailing={
                      low ? (
                        <span className="perf-mono ml-2 rounded-full bg-perf-soft px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.06em] not-italic text-perf-grey">
                          peu couverte
                        </span>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
