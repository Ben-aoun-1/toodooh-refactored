import type { VfCategoryKey } from '@/features/agent/lib/agent-vf';

import { VfIcon } from './VfIcon';

type TileKind = VfCategoryKey | 'adv';

/** The name tile shown where a logo is missing: the category's pictogram above the name, never initials. */
export function VfNameTile({ name, kind }: { name: string; kind: TileKind }) {
  return (
    <span className="nmtile">
      <span className={`ci lg-${kind}`}>
        <VfIcon k={kind === 'adv' ? 'camp' : kind} size={18} />
      </span>
      {name}
    </span>
  );
}

/**
 * AGENT-VF (spec VF « Logos ») — the white 4:3 frame every Screenhost, Screencaster or advertiser
 * gets: its logo centred and whole, or the name tile; an orange dot for a point of attention; the
 * « En attente de validation » ribbon on a logo the admin has not validated yet.
 */
export function VfFrame({
  name,
  kind,
  logoUrl,
  attention = false,
  pending = false,
  advertiser = false,
}: {
  name: string;
  kind: TileKind;
  logoUrl?: string | null;
  attention?: boolean;
  pending?: boolean;
  advertiser?: boolean;
}) {
  return (
    <span className={`frame${advertiser ? ' advf' : ''}`}>
      {logoUrl ? <img src={logoUrl} alt={name} /> : <VfNameTile name={name} kind={kind} />}
      {attention && <span className="dot" />}
      {logoUrl && pending && <span className="pend">En attente de validation</span>}
    </span>
  );
}

/** The small square logo (lists, window headers): the logo, else the category's gradient and pictogram. */
export function VfLogo({
  kind,
  size,
  title,
  logoUrl,
  attention = false,
}: {
  kind: TileKind;
  size: 32 | 60;
  title?: string;
  logoUrl?: string | null;
  attention?: boolean;
}) {
  return (
    <span
      className={`logo vf-logo-${size} ${logoUrl ? 'vf-logo-img' : `lg-${kind}`}`}
      title={title}
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" />
      ) : (
        <VfIcon k={kind === 'adv' ? 'camp' : kind} size={size} />
      )}
      {attention && <span className="dot" />}
    </span>
  );
}
