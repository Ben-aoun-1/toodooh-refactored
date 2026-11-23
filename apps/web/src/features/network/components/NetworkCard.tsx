import { locationLine } from '@/features/network/lib/network-copy';
import {
  cspText,
  genderText,
  type NetworkEntry,
  type NetworkKind,
} from '@/features/network/lib/network-entries';
import { NO_VALUE } from '@/features/network/lib/network-format';

import { CategoryIcon, CheckIcon, PinIcon } from './NetworkIcons';

interface NetworkCardProps {
  kind: NetworkKind;
  entry: NetworkEntry;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onReintegrate: () => void;
  /** A reintegration is on its way: « Réintégrer » waits. */
  busy: boolean;
}

/** One venue or one park: category band + checkbox, name, audience facts, network state. */
export default function NetworkCard({
  kind,
  entry,
  selected,
  onSelect,
  onReintegrate,
  busy,
}: NetworkCardProps) {
  const out = entry.excluded;
  const picked = selected && !out;
  return (
    <article className={`card c${entry.category.tone}${out ? ' out' : ''}${picked ? ' sel' : ''}`}>
      <div className="band">
        <span className="cat">
          <CategoryIcon tone={entry.category.tone} />
          {entry.category.label}
        </span>
        {!out && (
          <label className="pick">
            <input
              type="checkbox"
              checked={picked}
              onChange={(e) => onSelect(e.target.checked)}
              aria-label={`Sélectionner ${entry.name}`}
            />
            <i>
              <CheckIcon />
            </i>
          </label>
        )}
      </div>
      <div className="body">
        <div>
          <h5>{entry.name}</h5>
          <div className="loc">
            <PinIcon />
            {locationLine(kind, entry)}
          </div>
        </div>
        {kind === 'parks' && (
          <div className="emps">
            {entry.spots.map((spot) => (
              <span key={spot.screenhostId}>{spot.quartier ?? spot.region ?? NO_VALUE}</span>
            ))}
          </div>
        )}
        <div className="facts">
          <div>
            <span>CSP</span>
            <b>{cspText(entry.csp)}</b>
          </div>
          <div>
            <span>Hommes / femmes</span>
            <b className="m">{genderText(entry.malePct, entry.femalePct)}</b>
          </div>
          <div>
            <span>Âge dominant</span>
            <b>{entry.dominantAge ?? NO_VALUE}</b>
          </div>
        </div>
        <div className="state">
          <span className="pill">{out ? 'Exclu de votre réseau' : 'Dans votre réseau'}</span>
          {out && (
            <button type="button" className="mini" onClick={onReintegrate} disabled={busy}>
              Réintégrer
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
