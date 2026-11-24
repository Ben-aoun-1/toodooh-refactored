import { useMemo } from 'react';

import type { NetworkCopy } from '@/features/network/lib/network-copy';
import type { NetworkEntry } from '@/features/network/lib/network-entries';
import { NO_VALUE } from '@/features/network/lib/network-format';
import {
  ageRows,
  categoryRows,
  cspRows,
  genderSplit,
  regionRows,
} from '@/features/network/lib/network-portrait';

import { CategoryIcon } from './NetworkIcons';

interface NetworkPortraitProps {
  copy: NetworkCopy;
  headingId: string;
  entries: NetworkEntry[];
}

function NoData() {
  return <div className="rsx-nodata">{NO_VALUE}</div>;
}

/**
 * « Le portrait du réseau » — the five-tile bento. Every tile is computed from the real entries
 * (no « Valeurs illustratives » tag); a tile the data cannot fill prints « – ».
 */
export default function NetworkPortrait({ copy, headingId, entries }: NetworkPortraitProps) {
  const categories = useMemo(() => categoryRows(entries), [entries]);
  const regions = useMemo(() => regionRows(entries), [entries]);
  const csps = useMemo(() => cspRows(entries), [entries]);
  const gender = useMemo(() => genderSplit(entries), [entries]);
  const ages = useMemo(() => ageRows(entries), [entries]);

  return (
    <section aria-labelledby={headingId}>
      <div className="head">
        <h3 id={headingId}>
          {copy.portraitTitle}
          <em>{copy.portraitAccent}</em>
        </h3>
        <p>{copy.portraitIntro}</p>
      </div>
      <div className="bento">
        <div className="tile t-cat">
          <h4>Catégorie</h4>
          {categories.length === 0 ? (
            <NoData />
          ) : (
            <div className="rsx-catrows">
              {categories.map((row) => (
                <div className="catrow" key={row.category.id}>
                  <div className={`ic k${row.category.tone}`}>
                    <CategoryIcon tone={row.category.tone} large />
                  </div>
                  <div>
                    <div>{row.category.plural}</div>
                    <div className="bar">
                      <i className={`k${row.category.tone}`} data-w={row.widthPct} />
                    </div>
                  </div>
                  <b>{row.count}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="tile t-reg">
          <h4>{copy.regionTileTitle}</h4>
          {regions.length === 0 ? (
            <NoData />
          ) : (
            <div className="reglist">
              {regions.map((row) => (
                <div key={row.region}>
                  <span>{row.region}</span>
                  <b>{row.count}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="tile t-csp">
          <h4>CSP</h4>
          {csps === null ? (
            <NoData />
          ) : (
            <div className="csp">
              {csps.map((row) => (
                <div key={row.csp} className={`k-${row.csp}`}>
                  <b>{row.count}</b>
                  <i data-h={row.heightPct} />
                  <span>{row.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="tile t-hf">
          <h4>Hommes / femmes</h4>
          {gender === null ? (
            <NoData />
          ) : (
            <>
              <div className="hf">
                <div>
                  <b>
                    {gender.male}
                    <sup>%</sup>
                  </b>
                  <span>Hommes</span>
                </div>
                <div className="f">
                  <b>
                    {gender.female}
                    <sup>%</sup>
                  </b>
                  <span>Femmes</span>
                </div>
              </div>
              <div
                className="split"
                role="img"
                aria-label={`Hommes ${gender.male} %, femmes ${gender.female} %`}
              >
                <i data-w={gender.male} />
                <i />
              </div>
            </>
          )}
        </div>

        <div className="tile t-age">
          <h4>Répartition des âges</h4>
          {ages === null ? (
            <NoData />
          ) : (
            <div className={`ages rsx-ages-${Math.min(ages.length, 6)}`}>
              {ages.map((row) => (
                <div key={row.label} className={row.isMax ? 'max' : undefined}>
                  <b>{row.pct}&nbsp;%</b>
                  <i data-h={row.heightPct} />
                  <span>{row.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
