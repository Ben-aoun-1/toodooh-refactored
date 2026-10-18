import { Loader2, QrCode, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

import {
  useCampaignCta,
  useRemoveCampaignCta,
  useSaveCampaignCta,
} from '@/features/campaigns/hooks/useCampaignCta';
import { CTA_LABEL_MAX_CHARS, ctaFormBody, ctaStatusLine } from '@/features/campaigns/lib/spot-cta';
import { getErrorMessage } from '@/lib/errors';

const TONE_CLASS = {
  waiting: 'text-gray-600',
  ok: 'text-brand-deep',
  error: 'text-red-700',
} as const;

/**
 * QR-CTA1 (Youssef 2026-10-18) — the spot step's OPTIONAL call to action: a link and a short
 * message. The server burns a QR code with the message into a copy of the spot, bottom-left, and
 * the TVs air that copy; each scan is counted. Hidden for accounts without the feature.
 */
export default function SpotCtaFields({ campaignId }: { campaignId: string }) {
  const cta = useCampaignCta(campaignId);
  const save = useSaveCampaignCta(campaignId);
  const remove = useRemoveCampaignCta(campaignId);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  // The saved values seed the fields (and re-seed them after a save), never mid-typing refetches.
  const savedUrl = cta.data?.url ?? '';
  const savedLabel = cta.data?.label ?? '';
  useEffect(() => {
    setUrl(savedUrl);
    setLabel(savedLabel);
  }, [savedUrl, savedLabel]);

  if (!cta.data?.enabled) return null;
  const view = cta.data;
  const status = ctaStatusLine(view);

  const submit = async () => {
    const body = ctaFormBody(url, label);
    if (!body.ok) {
      toast.error(body.error);
      return;
    }
    try {
      await save.mutateAsync(body.value);
      toast.success('Lien enregistré');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Enregistrement impossible');
    }
  };

  const clear = async () => {
    try {
      await remove.mutateAsync(undefined);
      toast.success('Lien retiré');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Suppression impossible');
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-brand-deep" />
        <p className="text-sm font-bold text-gray-900">QR code « En savoir plus » (facultatif)</p>
      </div>
      <p className="text-sm text-gray-600">
        Un QR code s’affiche en bas à gauche de votre spot : les clients le scannent et arrivent
        directement sur votre page. Vous voyez combien de personnes l’ont scanné.
      </p>
      <form
        className="grid grid-cols-1 gap-3 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="text-sm md:col-span-2">
          <span className="block text-gray-600">Lien à ouvrir</span>
          <input
            type="url"
            value={url}
            placeholder="https://votre-site.tn/offre"
            autoComplete="off"
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600">
            Message ({CTA_LABEL_MAX_CHARS} caractères max.)
          </span>
          <input
            type="text"
            value={label}
            maxLength={CTA_LABEL_MAX_CHARS}
            placeholder={view.default_label}
            autoComplete="off"
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-3">
          <button
            type="submit"
            disabled={save.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-brand-deep disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Enregistrer le lien
          </button>
          {view.url !== null && (
            <button
              type="button"
              onClick={() => void clear()}
              disabled={remove.isPending}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Retirer le QR code
            </button>
          )}
          {status && (
            <span className={`text-sm ${TONE_CLASS[status.tone]}`}>
              {status.tone === 'waiting' && (
                <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
              )}
              {status.text}
            </span>
          )}
          {view.preview_url && (
            <a
              href={view.preview_url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-brand-deep underline"
            >
              Voir le spot avec son QR code
            </a>
          )}
        </div>
      </form>
    </section>
  );
}
