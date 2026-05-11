import { Trash2, ShoppingBag, ArrowRight, CheckCircle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { supabase } from '../lib/supabase';
import { balanceService } from '../services/balance.service';
import { campaignService } from '../services/campaign.service';
import { useCartStore, type CartItem } from '../stores/cart.store';

export default function MyCart() {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore((s) => s.getSubtotal());
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const [processing, setProcessing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleValidateItem = async (item: CartItem) => {
    setProcessingId(item.campaignId);
    try {
      const balanceCheck = await balanceService.checkCampaignBalance(item.campaignId);
      if (balanceCheck && !balanceCheck.has_sufficient_balance) {
        toast.error(
          `Solde insuffisant pour "${item.name}". Disponible: ${balanceService.formatAmount(balanceCheck.available_balance)}, Coût: ${balanceService.formatAmount(balanceCheck.campaign_cost)}`,
          { duration: 5000 },
        );
        return;
      }

      const { data: campaign } = await supabase
        .from('campaigns')
        .select('video_id')
        .eq('id', item.campaignId)
        .single();

      let videoIsValidated = false;
      if (campaign?.video_id) {
        const { data: video } = await supabase
          .from('videos')
          .select('validation_status')
          .eq('id', campaign.video_id)
          .single();
        videoIsValidated = video?.validation_status === 'approved';
      }

      const finalStatus = videoIsValidated ? 'active' : 'pending';
      await supabase
        .from('campaigns')
        .update({
          status: finalStatus,
          content_validation_status: videoIsValidated ? 'approved' : 'pending',
        })
        .eq('id', item.campaignId);

      if (finalStatus === 'active') {
        await campaignService.injectCampaignPublicationSchedule(item.campaignId);
      }

      removeItem(item.campaignId);
      toast.success(
        videoIsValidated
          ? `"${item.name}" activée avec succès !`
          : `"${item.name}" en attente de validation vidéo`,
      );
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de la validation');
    } finally {
      setProcessingId(null);
    }
  };

  const handleValidateAll = async () => {
    if (items.length === 0) return;
    setProcessing(true);
    let success = 0;
    let failed = 0;

    for (const item of [...items]) {
      try {
        const balanceCheck = await balanceService.checkCampaignBalance(item.campaignId);
        if (balanceCheck && !balanceCheck.has_sufficient_balance) {
          toast.error(`Solde insuffisant pour "${item.name}"`);
          failed++;
          continue;
        }

        const { data: campaign } = await supabase
          .from('campaigns')
          .select('video_id')
          .eq('id', item.campaignId)
          .single();

        let videoIsValidated = false;
        if (campaign?.video_id) {
          const { data: video } = await supabase
            .from('videos')
            .select('validation_status')
            .eq('id', campaign.video_id)
            .single();
          videoIsValidated = video?.validation_status === 'approved';
        }

        const finalStatus = videoIsValidated ? 'active' : 'pending';
        await supabase
          .from('campaigns')
          .update({
            status: finalStatus,
            content_validation_status: videoIsValidated ? 'approved' : 'pending',
          })
          .eq('id', item.campaignId);

        if (finalStatus === 'active') {
          await campaignService.injectCampaignPublicationSchedule(item.campaignId);
        }

        removeItem(item.campaignId);
        success++;
      } catch {
        failed++;
      }
    }

    setProcessing(false);
    if (success > 0) toast.success(`${success} campagne(s) validée(s)`);
    if (failed > 0) toast.error(`${failed} campagne(s) non validée(s)`);
    if (success > 0 && failed === 0) {
      setTimeout(() => navigate('/my-campaigns'), 1500);
    }
  };

  if (items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-6">
          <ShoppingBag className="h-10 w-10 text-gray-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Votre panier est vide</h2>
        <p className="text-sm text-gray-500 mb-6">
          Ajoutez des campagnes depuis la page de création
        </p>
        <button
          type="button"
          onClick={() => navigate('/new-campaign')}
          className="px-6 py-3 rounded-xl text-white text-sm font-medium transition-all hover:opacity-90"
          style={{ background: '#76E6AB' }}
        >
          Créer une campagne
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Mon panier</h2>
            <p className="text-sm text-gray-500">{items.length} campagne(s)</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Sous-total</p>
            <p className="text-xl font-bold text-gray-900">
              {subtotal.toLocaleString('fr-FR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              TND
            </p>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {items.map((item) => (
            <div key={item.campaignId} className="p-5 flex items-center gap-4">
              <div className="w-24 h-16 rounded-lg overflow-hidden bg-black flex-shrink-0">
                {item.videoThumbnail ? (
                  <video src={item.videoThumbnail} muted className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-200">
                    <ShoppingBag className="h-6 w-6 text-gray-400" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
                {item.startDate && item.endDate && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(item.startDate).toLocaleDateString('fr-FR')} →{' '}
                    {new Date(item.endDate).toLocaleDateString('fr-FR')}
                  </p>
                )}
              </div>

              <p className="text-sm font-bold text-gray-900 flex-shrink-0">
                {item.budget.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                TND
              </p>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => handleValidateItem(item)}
                  disabled={processingId === item.campaignId}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#76E6AB' }}
                >
                  {processingId === item.campaignId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5" />
                  )}
                  Valider
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item.campaignId)}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/new-campaign')}
          className="flex items-center gap-2 px-5 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 text-sm font-medium transition-all"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Continuer mes achats
        </button>

        <button
          type="button"
          onClick={handleValidateAll}
          disabled={processing}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white shadow-lg transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: '#76E6AB' }}
        >
          {processing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4" />
          )}
          Tout valider ({items.length})
        </button>
      </div>
    </div>
  );
}
