import { useState } from 'react';

import { useAgentOffer, useAnswerAgentOffer } from '@/features/agent/hooks/useAgentOffers';
import { vfTnd } from '@/features/agent/lib/agent-format';
import {
  offerAnsweredToast,
  offerBadge,
  offerBanner,
  offerFacts,
} from '@/features/agent/lib/agent-offers';
import { agentOffersService } from '@/features/agent/services/agent-offers.service';
import { getErrorMessage } from '@/lib/errors';

import { useAgentLogos } from '../hooks/useAgentLogos';

import { VfLogo } from './VfFrame';
import { VfIcon } from './VfIcon';
import { useVfOverlay } from './VfOverlay';

const BADGE_CLASS = {
  wait: 'badge b-wait vf-badge-orange',
  ok: 'badge b-act',
  red: 'badge vf-badge-red',
};

/**
 * AGENT-VF (spec VF §10) — a campaign offer of an affiliated Screenhost, in the window at the
 * centre: what the Screenhost earns, type, zone and dates, the spot, and Refuser / Accepter while
 * nobody has answered. The first answer decides; afterwards the window only informs.
 */
export function VfOfferWindow({ offerId }: { offerId: string }) {
  const { closeAll, toast } = useVfOverlay();
  const logos = useAgentLogos();
  const offer = useAgentOffer(offerId);
  const answer = useAnswerAgentOffer(offerId);
  const close = (
    <button type="button" className="x" onClick={closeAll} aria-label="Fermer">
      ✕
    </button>
  );

  if (!offer.data) {
    return (
      <>
        <div className="bh">
          <VfLogo kind="shop" size={60} />
          <div>
            <h2>Offre de campagne</h2>
            <p>
              {offer.isError
                ? 'Cette offre est introuvable ou n’est plus la vôtre.'
                : 'Chargement…'}
            </p>
          </div>
          {close}
        </div>
      </>
    );
  }

  const o = offer.data;
  const badge = offerBadge(o);
  const banner = offerBanner(o);
  const act = (accepted: boolean) =>
    answer.mutate(accepted, {
      onSuccess: () => {
        closeAll();
        toast(offerAnsweredToast(accepted, o.screenhost_name));
      },
      onError: (e) => toast(getErrorMessage(e) || 'Action impossible'),
    });

  return (
    <>
      <div className="bh">
        <VfLogo
          kind="shop"
          size={60}
          title={o.screenhost_name}
          logoUrl={logos.of(o.screenhost_id)?.url}
        />
        <div>
          <h2>{o.campaign_name}</h2>
          <p>Offre de campagne pour {o.screenhost_name}</p>
          <div className="tags">
            <span className={BADGE_CLASS[badge.tone]}>{badge.label}</span>
          </div>
        </div>
        {close}
      </div>
      <div className="bb">
        <div>
          <div className="gainbox">
            <span className="gi">
              <VfIcon k="rev" size={20} />
            </span>
            <div>
              <small>Ce que gagne {o.screenhost_name}</small>
              <b>{vfTnd(o.gain_tnd)}</b>
            </div>
          </div>
          <div className="kv vf-mt14">
            {offerFacts(o).map((f) => (
              <div key={f.label}>
                <small>{f.label}</small>
                <b>{f.value}</b>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="sec">
            <h4>Spot</h4>
            <OfferSpot offerId={o.id} kind={o.creative?.kind ?? null} />
          </div>
          <div className={`banner ${banner.tone === 'violet' ? 'vf-banner-info' : 'vf-banner-ok'}`}>
            <VfIcon k="alert" size={16} />
            <span>{banner.text}</span>
          </div>
        </div>
      </div>
      {o.decidable && (
        <div className="bf vf-bf-end">
          <button
            type="button"
            className="btn vf-btn-refuse"
            disabled={answer.isPending}
            onClick={() => act(false)}
          >
            Refuser
          </button>
          <button
            type="button"
            className="btn pri vf-btn-w150"
            disabled={answer.isPending}
            onClick={() => act(true)}
          >
            Accepter
          </button>
        </div>
      )}
    </>
  );
}

/** The spot: the dark 16:9 box with its play button, then the media itself once asked for. */
function OfferSpot({ offerId, kind }: { offerId: string; kind: 'video' | 'photo' | null }) {
  const { toast } = useVfOverlay();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (kind === null) {
    return (
      <div className="spotbox vf-spot-none">
        <small>Aucun spot à afficher</small>
      </div>
    );
  }
  if (url !== null) {
    return (
      <div className="spotbox vf-spot-media">
        {kind === 'video' ? (
          <video src={url} controls autoPlay playsInline>
            <track kind="captions" />
          </video>
        ) : (
          <img src={url} alt="Spot de la campagne" />
        )}
      </div>
    );
  }
  const load = async () => {
    setBusy(true);
    try {
      setUrl((await agentOffersService.creativeUrl(offerId)).url);
    } catch (e) {
      toast(getErrorMessage(e) || 'Le spot est indisponible');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="spotbox vf-spot-btn"
      onClick={() => void load()}
      disabled={busy}
      aria-label="Voir le spot"
    >
      <span>▶</span>
    </button>
  );
}
