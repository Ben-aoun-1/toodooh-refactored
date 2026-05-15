import {
  Trash2,
  ShoppingBag,
  Calendar,
  MapPin,
  Edit,
  Megaphone,
  X,
  PartyPopper,
  Frown,
  Loader2,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '../features/auth/stores/auth.store';
import { eventsService } from '../features/events/services/events.service';
import type { SpecialEvent } from '../features/events/types/event';
import { supabase } from '../lib/supabase';
import { balanceService } from '../services/balance.service';
import { campaignService } from '../services/campaign.service';
import { useCartStore, type CartItem } from '../stores/cart.store';

const TVA_RATE = 0.19;

export default function CartPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const cartItems = useCartStore((s) => s.items);
  const setCartItems = useCartStore((s) => s.setItems);
  const removeItem = useCartStore((s) => s.removeItem);
  const [suggestedEvents, setSuggestedEvents] = useState<SpecialEvent[]>([]);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showInsufficientModal, setShowInsufficientModal] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    eventsService.getFeaturedEvents(5).then((list) => {
      if (!cancelled) setSuggestedEvents(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const removeFromCart = (campaignId: string) => {
    removeItem(campaignId);
  };


  const handleConfirmAndLaunch = async () => {
    if (cartItems.length === 0) return;
    if (!user?.id) {
      toast.error('Veuillez vous connecter pour confirmer.');
      return;
    }
    setConfirming(true);
    try {
      const remainingItems: CartItem[] = [];
      let activatedCount = 0;
      let pendingCount = 0;
      let insufficientCount = 0;
      let failedCount = 0;
      let hasInsufficientUnvalidated = false;

      for (const item of cartItems) {
        try {
          const { data: campaignRow, error: campaignError } = await supabase
            .from('campaigns')
            .select('id, user_id, status, video_id, content_validation_status')
            .eq('id', item.id)
            .eq('user_id', user.id)
            .single();

          if (campaignError || !campaignRow) {
            failedCount += 1;
            remainingItems.push(item);
            continue;
          }

          // Déjà active: la conserver telle quelle et retirer du panier.
          if (campaignRow.status === 'active') {
            activatedCount += 1;
            continue;
          }

          let videoIsValidated = campaignRow.content_validation_status === 'approved';
          if (!videoIsValidated && campaignRow.video_id) {
            const { data: videoRow } = await supabase
              .from('videos')
              .select('validation_status')
              .eq('id', campaignRow.video_id)
              .single();
            videoIsValidated = videoRow?.validation_status === 'approved';
          }

          const balanceCheck = await balanceService.checkCampaignBalance(item.id);
          const hasSufficientBalance = Boolean(balanceCheck?.has_sufficient_balance);

          // Règle métier: vidéo non validée + solde insuffisant => brouillon + message + redirection recharge.
          if (!videoIsValidated && !hasSufficientBalance) {
            const { error: setDraftError } = await supabase
              .from('campaigns')
              .update({
                status: 'draft',
                content_validation_status: 'pending',
              })
              .eq('id', item.id)
              .eq('user_id', user.id);

            if (setDraftError) {
              failedCount += 1;
              remainingItems.push(item);
              continue;
            }

            insufficientCount += 1;
            hasInsufficientUnvalidated = true;
            remainingItems.push(item);
            continue;
          }

          if (!hasSufficientBalance) {
            insufficientCount += 1;
            remainingItems.push(item);
            continue;
          }

          const nextStatus = videoIsValidated ? 'active' : 'pending';

          const { error: updateError } = await supabase
            .from('campaigns')
            .update({
              status: nextStatus,
              content_validation_status: videoIsValidated ? 'approved' : 'pending',
            })
            .eq('id', item.id)
            .eq('user_id', user.id);

          if (updateError) {
            failedCount += 1;
            remainingItems.push(item);
            continue;
          }

          if (nextStatus === 'active') {
            await campaignService.injectCampaignPublicationSchedule(item.id);
            activatedCount += 1;
          } else {
            pendingCount += 1;
          }
        } catch {
          failedCount += 1;
          remainingItems.push(item);
        }
      }

      setCartItems(remainingItems);

      if (activatedCount > 0) {
        if (pendingCount === 0 && insufficientCount === 0 && failedCount === 0) {
          setShowSuccessModal(true);
        } else {
          toast.success(`${activatedCount} campagne(s) activée(s).`);
        }
      }
      if (pendingCount > 0) {
        toast(`${pendingCount} campagne(s) en attente de validation vidéo.`, { icon: '⏳' });
      }
      if (insufficientCount > 0) {
        setShowInsufficientModal(true);
        if (hasInsufficientUnvalidated) {
          toast.error('Solde insuffisant: campagne remise en brouillon.');
          setTimeout(() => navigate('/my-recharges'), 1200);
        }
      }
      if (failedCount > 0) {
        toast.error(`${failedCount} campagne(s) non traitée(s).`);
      }
    } catch {
      toast.error('Erreur lors de la vérification du solde.');
    } finally {
      setConfirming(false);
    }
  };

  const subtotalHT = cartItems.reduce((s, i) => s + (i.amount || 0), 0);
  const tva = subtotalHT * TVA_RATE;
  const totalTTC = subtotalHT + tva;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Deux blocs séparés : Récapitulatif + Prêt à diffuser */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bloc gauche : Récapitulatif */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Récapitulatif</h2>

          {/* CAMPAGNES */}
          <div className="mb-8">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">
              Campagnes
            </p>
            {cartItems.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">Aucune campagne dans le panier.</p>
            ) : (
              <ul className="space-y-4">
                {cartItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex gap-4 p-4 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-gray-50"
                  >
                    <div className="w-20 h-20 rounded-lg bg-gray-200 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      <ShoppingBag className="h-8 w-8 text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">
                        {item.name || 'Nom de la campagne'}
                      </p>
                      <div className="flex items-center gap-2 sm:gap-3 mt-1 text-xs text-gray-500 min-w-0">
                        <span className="flex items-center gap-1 min-w-0 shrink">
                          <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">
                            {item.periodLabel || 'Période à définir'}
                          </span>
                        </span>
                        <span className="text-gray-300 flex-shrink-0" aria-hidden>
                          |
                        </span>
                        <span className="flex items-center gap-1 min-w-0 shrink">
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{item.zonesLabel || 'Zones à définir'}</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <span className="inline-flex px-2 py-0.5 rounded bg-gray-200 text-gray-600 text-xs">
                          Restaurants
                        </span>
                        <span className="inline-flex px-2 py-0.5 rounded bg-gray-200 text-gray-600 text-xs">
                          Salles de sport
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => navigate('/my-campaigns')}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                          title="Modifier"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
                          title="Supprimer du panier"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-base font-bold text-gray-900 flex-shrink-0">
                      {item.amount.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      TND
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ÉVÉNEMENTS (vide pour l’instant, lié aux campagnes événement) */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">
              Événements
            </p>
            <p className="text-sm text-gray-500 py-2">Aucun événement dans le panier.</p>
          </div>
        </div>

        {/* Bloc droit : Prêt à diffuser (style capture) */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-[#9adfb4] bg-white overflow-hidden">
            <div className="p-6">
              <h3 className="text-2xl font-semibold text-gray-900 mb-5 leading-tight">
                Prêt à diffuser
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">Coût réel (HT):</span>
                  <span className="text-gray-900">
                    {subtotalHT.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    TND
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">TVA (19%):</span>
                  <span className="text-gray-900">
                    {tva.toLocaleString('fr-FR', {
                      minimumFractionDigits: 3,
                      maximumFractionDigits: 3,
                    })}{' '}
                    TND
                  </span>
                </div>
              </div>
            </div>
            <div className="px-6 py-5 bg-[#f5fcf7] border-t border-gray-200">
              <div className="flex items-center justify-between gap-3">
                <span className="text-lg font-medium text-gray-900 leading-none">Total TTC:</span>
                <span className="text-xl font-bold text-gray-900 leading-none">
                  {totalTTC.toLocaleString('fr-FR', {
                    minimumFractionDigits: 3,
                    maximumFractionDigits: 3,
                  })}{' '}
                  TND
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleConfirmAndLaunch}
            disabled={cartItems.length === 0 || confirming}
            className="w-full mt-6 py-3.5 rounded-xl text-lg font-medium transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            style={{ background: '#96d4a1', color: '#111827' }}
          >
            {confirming && <Loader2 className="h-5 w-5 animate-spin" />}
            <span>{confirming ? 'Vérification...' : 'Confirmer et lancer'}</span>
          </button>
        </div>
      </div>

      {/* Section événements à venir (même largeur que Récapitulatif) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">
            Augmentez votre impact en diffusant votre spot lors d&apos;événements majeurs à venir
          </h3>
          {suggestedEvents.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">Chargement des événements...</p>
          ) : (
            <ul className="space-y-4">
              {suggestedEvents.map((event) => {
                const start = new Date(event.start_date);
                const end = new Date(event.end_date);
                const dateStr = start.toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                });
                const timeStr = `${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
                const typeLabel =
                  event.event_type === 'sport'
                    ? 'Sport'
                    : event.event_type === 'culture'
                      ? 'Culture'
                      : event.event_type || 'Autre';
                return (
                  <li
                    key={event.id}
                    className="flex flex-col gap-4 p-4 rounded-xl border border-gray-100 hover:bg-gray-50/50"
                  >
                    <div className="flex gap-4">
                      <div className="w-24 h-20 rounded-lg bg-gray-200 flex-shrink-0 overflow-hidden flex items-center justify-center">
                        {event.image_url ? (
                          <img
                            src={event.image_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Megaphone className="h-8 w-8 text-gray-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            {typeLabel}
                          </span>
                          <p className="font-semibold text-gray-900">{event.name}</p>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {dateStr} | {timeStr}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {event.region || '—'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <span className="inline-flex px-2 py-0.5 rounded bg-gray-200 text-gray-600 text-xs">
                            Restaurants
                          </span>
                          <span className="inline-flex px-2 py-0.5 rounded bg-gray-200 text-gray-600 text-xs">
                            Salles de sport
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/new-event-campaign', { state: { event } })}
                      className="w-full px-4 py-2.5 rounded-xl bg-gray-900 hover:bg-black text-white text-sm font-medium transition-colors"
                    >
                      Je me positionne
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Modal succès — Félicitations */}
      {showSuccessModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowSuccessModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 relative text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowSuccessModal(false)}
              className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex justify-center mt-2 mb-6">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-[#e8f8ee]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full border-2 border-[#9adfb4] bg-white flex items-center justify-center">
                    <PartyPopper className="h-6 w-6 text-gray-900" />
                  </div>
                </div>
              </div>
            </div>
            <p className="text-base font-bold text-gray-900 mb-8 leading-snug">
              Félicitations, vos campagnes et événements ont été lancés.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowSuccessModal(false);
                navigate('/my-campaigns');
              }}
              className="w-full py-3 rounded-xl font-medium text-gray-900 transition-colors hover:opacity-90"
              style={{ background: '#9adfb4' }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Modal solde insuffisant */}
      {showInsufficientModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowInsufficientModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 relative text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowInsufficientModal(false)}
              className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex justify-center mt-2 mb-4">
              <div className="w-14 h-14 rounded-full border-2 border-[#9adfb4] bg-white flex items-center justify-center">
                <Frown className="h-7 w-7 text-gray-900" />
              </div>
            </div>
            <p className="text-base font-bold text-gray-900 mb-2">
              Malheureusement! votre solde n&apos;est pas suffisant.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              Votre panier vous attend une fois la recharge effectuée
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowInsufficientModal(false);
                }}
                className="flex-1 py-3 rounded-xl font-medium text-gray-900 border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
              >
                Mon panier
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInsufficientModal(false);
                  navigate('/my-recharges');
                }}
                className="flex-1 py-3 rounded-xl font-medium text-gray-900 transition-colors hover:opacity-90"
                style={{ background: '#9adfb4' }}
              >
                Recharger
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
