import { KeyValues } from '@/features/admin/components/testing/KeyValues';
import {
  SPS_LIVE_LABEL,
  SPS_STORED_LABEL,
  fmt,
  spsObservationLabel,
  spsSectionTitle,
  spsVariableLabel,
} from '@/features/admin/lib/testing-labels';
import type { TestingReport } from '@/features/admin/services/admin-testing.service';

// ADM-OBS2 item 6 — the SPS block, every row named for what it is (ruling A: the stored score is
// the last daily computation, not an average).
// ADM-OBS2 (Mejri 19/09) — the score and its variables keep their fixed windows, each named on
// its row (R5, R9); the evidence rows are the Du/Au période's (`observations_period`, R10); the
// « Période de calcul » rows are gone (R8).

interface Props {
  sps: TestingReport['sps'];
  periode: TestingReport['periode'];
}

export function SpsSection({ sps, periode }: Props) {
  return (
    <KeyValues
      title={spsSectionTitle(periode.from, periode.to)}
      rows={[
        [SPS_LIVE_LABEL, fmt(sps.live)],
        [SPS_STORED_LABEL, fmt(sps.stored)],
        [
          'Score calculable ? (sinon le dispatch le classe au neutre)',
          sps.computable ? 'oui' : `non → classé à ${sps.neutral}`,
        ],
        ...Object.entries(sps.variables).map(
          ([k, v]) =>
            [spsVariableLabel(k, sps.weights, sps.windows_days), fmt(v)] as [string, string],
        ),
        ...Object.entries(sps.observations_period).map(
          ([k, v]) => [spsObservationLabel(k), fmt(v)] as [string, string],
        ),
      ]}
    />
  );
}
