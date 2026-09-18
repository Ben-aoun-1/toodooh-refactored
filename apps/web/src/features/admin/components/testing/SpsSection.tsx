import { KeyValues } from '@/features/admin/components/testing/KeyValues';
import {
  SPS_LIVE_LABEL,
  SPS_STORED_LABEL,
  SPS_VARIABLE_LABEL,
  SPS_WINDOW_LABEL,
  fmt,
  spsObservationLabel,
} from '@/features/admin/lib/testing-labels';
import type { TestingReport } from '@/features/admin/services/admin-testing.service';

// ADM-OBS2 item 6 — the SPS block, every row named for what it is (ruling A: the stored score is
// the last daily computation, not an average).

export function SpsSection({ sps }: { sps: TestingReport['sps'] }) {
  return (
    <KeyValues
      title="SPS — score, variables, preuves, poids"
      rows={[
        [SPS_LIVE_LABEL, fmt(sps.live)],
        [SPS_STORED_LABEL, fmt(sps.stored)],
        [
          'Score calculable ? (sinon le dispatch le classe au neutre)',
          sps.computable ? 'oui' : `non → classé à ${sps.neutral}`,
        ],
        ...Object.entries(sps.variables).map(
          ([k, v]) =>
            [`${SPS_VARIABLE_LABEL[k] ?? k} — poids ${sps.weights[k] ?? '?'} %`, fmt(v)] as [
              string,
              string,
            ],
        ),
        ...Object.entries(sps.observations).map(
          ([k, v]) => [spsObservationLabel(k, sps.windows_days), fmt(v)] as [string, string],
        ),
        ...Object.entries(sps.windows_days).map(
          ([k, v]) => [SPS_WINDOW_LABEL[k] ?? k, `${v} derniers jours`] as [string, string],
        ),
        ['Période de calcul — remplissage', 'semaine en cours (lundi → dimanche)'],
      ]}
    />
  );
}
