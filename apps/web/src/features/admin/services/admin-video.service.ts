import { logger } from '../../../lib/logger';
import { supabase } from '../../../lib/supabase';
import { Video, VideoValidationStats, CampaignUsingVideo } from '../types/video';

const log = logger.child({ module: 'admin-video.service' });

export const adminVideoService = {
  // Récupérer toutes les vidéos pour validation (seulement celles utilisées dans des campagnes)
  async getVideos(statusFilter?: 'pending' | 'approved' | 'rejected' | 'all'): Promise<Video[]> {
    try {
      let query = supabase
        .from('admin_videos_view')
        .select('*')
        .gt('campaigns_count', 0) // Seulement les vidéos utilisées dans au moins 1 campagne
        .order('created_at', { ascending: false });

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('validation_status', statusFilter);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Erreur Supabase: ${error.message}`);
      }

      const videos = data || [];
      if (videos.length === 0) return [];

      // Règle métier: les vidéos liées uniquement à des campagnes brouillon
      // ne doivent pas apparaître dans la validation admin.
      // TODO(phase-1): typed source [supabase] — see #15
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const videoIds = videos.map((v: any) => v.id).filter(Boolean);
      const { data: nonDraftLinks, error: linksError } = await supabase
        .from('campaigns')
        .select('video_id')
        .in('video_id', videoIds)
        .neq('status', 'draft');

      if (linksError) {
        throw new Error(`Erreur Supabase: ${linksError.message}`);
      }

      const eligibleVideoIds = new Set(
        (nonDraftLinks || [])
          // TODO(phase-1): typed source [supabase] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((r: any) => r.video_id)
          // TODO(phase-1): typed source [supabase] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
      );

      // TODO(phase-1): typed source [supabase] — see #15
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filteredVideos = videos.filter((v: any) => eligibleVideoIds.has(v.id));

      return filteredVideos;
    } catch (error) {
      throw error;
    }
  },

  // Récupérer les détails d'une vidéo avec les campagnes associées
  async getVideoDetails(videoId: string): Promise<Video & { campaigns: CampaignUsingVideo[] }> {
    try {
      // Récupérer la vidéo
      const { data: videoData, error: videoError } = await supabase
        .from('admin_videos_view')
        .select('*')
        .eq('id', videoId)
        .single();

      if (videoError) {
        throw new Error(`Erreur lors de la récupération de la vidéo: ${videoError.message}`);
      }

      // Récupérer les campagnes utilisant cette vidéo
      const { data: campaignsData, error: campaignsError } = await supabase.rpc(
        'get_campaigns_using_video',
        { video_uuid: videoId },
      );

      if (campaignsError) {
        log.error({ campaignsError }, '⚠️ Warning fetching campaigns');
        // Ne pas échouer si on ne peut pas récupérer les campagnes
      }

      return {
        ...videoData,
        campaigns: campaignsData || [],
      };
    } catch (error) {
      throw error;
    }
  },

  // Valider une vidéo (approuver)
  async approveVideo(videoId: string, adminId: string, notes?: string): Promise<boolean> {
    try {
      // TODO(phase-1): typed source [supabase] — see #15
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        validation_status: 'approved',
        validated_by: adminId,
        validated_at: new Date().toISOString(),
      };

      if (notes) {
        updateData.validation_notes = notes;
      }

      const { error } = await supabase
        .from('videos')
        .update(updateData)
        .eq('id', videoId)
        .select();

      if (error) {
        throw new Error(error.message);
      }

      // Activer automatiquement les campagnes en attente qui utilisent cette vidéo
      // et injecter les informations de publication par heure.
      // On récupère d'abord les campagnes via RPC (source fiable du mapping vidéo -> campagnes).
      const { data: campaignLinks, error: campaignLinksError } = await supabase.rpc(
        'get_campaigns_using_video',
        { video_uuid: videoId },
      );

      if (campaignLinksError) {
        throw new Error(
          campaignLinksError.message || 'Impossible de récupérer les campagnes liées à la vidéo',
        );
      }

      const linkedCampaignIds = Array.from(
        new Set(
          (campaignLinks || [])
            // TODO(phase-1): typed source [supabase] — see #15
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((row: any) => row?.id || row?.campaign_id)
            // TODO(phase-1): typed source [supabase] — see #15
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
        ),
      );

      // Fallback robuste: si la RPC ne remonte rien, on retombe sur campaigns.video_id.
      let effectiveCampaignIds = linkedCampaignIds;
      if (effectiveCampaignIds.length === 0) {
        const { data: fallbackCampaignRows, error: fallbackCampaignError } = await supabase
          .from('campaigns')
          .select('id')
          .eq('video_id', videoId);
        if (fallbackCampaignError) {
          log.error({ fallbackCampaignError }, '❌ Error fetching fallback campaigns by video_id');
        } else {
          effectiveCampaignIds = Array.from(
            new Set(
              (fallbackCampaignRows || [])
                // TODO(phase-1): typed source [supabase] — see #15
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((row: any) => row?.id)
                // TODO(phase-1): typed source [supabase] — see #15
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
            ),
          );
        }
      }

      const { data: campaigns, error: campaignsError } =
        effectiveCampaignIds.length > 0
          ? await supabase
              .from('campaigns')
              .select('id, name, user_id, status, content_validation_status')
              .in('id', effectiveCampaignIds)
              .in('status', ['pending'])
          // TODO(phase-1): typed source [supabase] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : { data: [], error: null as any };

      if (campaignsError) {
        throw new Error(
          campaignsError.message || 'Impossible de charger les campagnes liées à la vidéo',
        );
      }

      if (campaigns && campaigns.length > 0) {
        // Importer le service de campagne pour utiliser injectCampaignPublicationSchedule
        const { campaignService } = await import('../../../services/campaign.service');

        for (const campaign of campaigns) {
          // Vérifier le solde avant d'activer
          const { balanceService } = await import('../../../services/balance.service');
          const balanceCheck = await balanceService.checkCampaignBalance(campaign.id);

          if (balanceCheck && balanceCheck.has_sufficient_balance) {
            // Activer la campagne
            const { error: activateError } = await supabase
              .from('campaigns')
              .update({
                status: 'active',
                content_validation_status: 'approved',
              })
              .eq('id', campaign.id);

            if (activateError) {
              log.error({ activateError }, `❌ Activation campagne ${campaign.id} impossible`);
              continue;
            }

            // Notification annonceur: écrite dès l'activation pour éviter une perte
            // de notification si la planification échoue ensuite.
            const { error: advertiserNotificationError } = await supabase
              .from('user_notifications')
              .upsert(
                {
                  recipient_user_id: campaign.user_id,
                  scope: 'advertiser',
                  kind: 'video_approved_campaign_active',
                  title: `Video validee et campagne active : ${campaign.name || 'Campagne'}`,
                  action_path: '/my-campaigns',
                  action_label: 'Voir mes campagnes',
                  entity_type: 'campaign',
                  entity_id: campaign.id,
                  external_key: `video-approved-active-${campaign.id}`,
                  created_by: adminId,
                },
                { onConflict: 'external_key' },
              );
            if (advertiserNotificationError) {
              log.error(
                { advertiserNotificationError },
                `❌ Insert notification annonceur impossible (${campaign.id})`,
              );
            }

            // Créer les validations propriétaires "pending" pour notifier
            // tous les owners concernés par les écrans de la campagne.
            const { data: campaignScreens, error: campaignScreensError } = await supabase
              .from('campaign_screens')
              .select('screen_id')
              .eq('campaign_id', campaign.id);
            if (campaignScreensError) {
              log.error(
                { campaignScreensError },
                `❌ Lecture campaign_screens impossible (${campaign.id})`,
              );
            } else {
              const screenIds = (campaignScreens || [])
                // TODO(phase-1): typed source [supabase] — see #15
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((r: any) => r.screen_id)
                .filter(Boolean);
              if (screenIds.length > 0) {
                const { data: screensOwners, error: screensOwnersError } = await supabase
                  .from('screens')
                  .select('owner_id')
                  .in('id', screenIds);

                if (screensOwnersError) {
                  log.error(
                    { screensOwnersError },
                    `❌ Lecture owners écrans impossible (${campaign.id})`,
                  );
                } else {
                  const ownerIds = Array.from(
                    new Set(
                      (screensOwners || [])
                        // TODO(phase-1): typed source [supabase] — see #15
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .map((r: any) => r.owner_id)
                        .filter(
                          // TODO(phase-1): typed source [supabase] — see #15
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          (ownerId: any): ownerId is string =>
                            typeof ownerId === 'string' && ownerId.length > 0,
                        ),
                    ),
                  );

                  if (ownerIds.length > 0) {
                    const { data: existingApprovals, error: existingApprovalsError } =
                      await supabase
                        .from('campaign_owner_approvals')
                        .select('owner_id')
                        .eq('campaign_id', campaign.id)
                        .in('owner_id', ownerIds);

                    if (existingApprovalsError) {
                      log.error(
                        { existingApprovalsError },
                        `❌ Lecture approvals existantes impossible (${campaign.id})`,
                      );
                    } else {
                      const existingOwnerIds = new Set(
                        (existingApprovals || [])
                          // TODO(phase-1): typed source [supabase] — see #15
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          .map((r: any) => r.owner_id)
                          .filter(
                            // TODO(phase-1): typed source [supabase] — see #15
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (id: any): id is string => typeof id === 'string' && id.length > 0,
                          ),
                      );
                      const pendingRows = ownerIds
                        .filter((ownerId) => !existingOwnerIds.has(ownerId))
                        .map((ownerId) => ({
                          campaign_id: campaign.id,
                          owner_id: ownerId,
                          screen_ids: [],
                          status: 'pending',
                        }));

                      if (pendingRows.length > 0) {
                        const { error: ownerApprovalsError } = await supabase
                          .from('campaign_owner_approvals')
                          .insert(pendingRows);

                        if (ownerApprovalsError) {
                          log.error(
                            { ownerApprovalsError },
                            `❌ Insert approvals owners impossible (${campaign.id})`,
                          );
                        } else {
                          const ownerNotifications = pendingRows.map((row) => ({
                            recipient_user_id: row.owner_id,
                            scope: 'owner',
                            kind: 'campaign_validation_received',
                            title: `Nouvelle campagne a valider : ${campaign.name || 'Campagne'}`,
                            action_path: '/owner-campaign-approvals',
                            action_label: 'Consulter la campagne',
                            entity_type: 'campaign',
                            entity_id: campaign.id,
                            external_key: `owner-pending-${campaign.id}-${row.owner_id}`,
                            created_by: adminId,
                          }));
                          const { error: ownerNotificationsError } = await supabase
                            .from('user_notifications')
                            .upsert(ownerNotifications, { onConflict: 'external_key' });
                          if (ownerNotificationsError) {
                            log.error(
                              { ownerNotificationsError },
                              `❌ Insert notifications owners impossible (${campaign.id})`,
                            );
                          }
                        }
                      }
                    }
                  }
                }
              }
            }

            // Injecter les informations de publication par heure
            await campaignService.injectCampaignPublicationSchedule(campaign.id);
          }
        }
      }

      // Sécurité: même si l'activation a été faite par un autre flux,
      // on crée/garantit la notification annonceur pour toute campagne active liée à la vidéo.
      if (effectiveCampaignIds.length > 0) {
        const { data: activeCampaigns, error: activeCampaignsError } = await supabase
          .from('campaigns')
          .select('id, name, user_id')
          .in('id', effectiveCampaignIds)
          .eq('status', 'active');

        if (activeCampaignsError) {
          log.error(
            { activeCampaignsError },
            '❌ Error reading active campaigns for advertiser notifications',
          );
        } else if ((activeCampaigns || []).length > 0) {
          // TODO(phase-1): typed source [supabase] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const advertiserNotifications = (activeCampaigns || []).map((campaign: any) => ({
            recipient_user_id: campaign.user_id,
            scope: 'advertiser',
            kind: 'video_approved_campaign_active',
            title: `Video validee et campagne active : ${campaign.name || 'Campagne'}`,
            action_path: '/my-campaigns',
            action_label: 'Voir mes campagnes',
            entity_type: 'campaign',
            entity_id: campaign.id,
            external_key: `video-approved-active-${campaign.id}`,
            created_by: adminId,
          }));

          const { error: advertiserNotificationsError } = await supabase
            .from('user_notifications')
            .upsert(advertiserNotifications, { onConflict: 'external_key' });

          if (advertiserNotificationsError) {
            log.error(
              { advertiserNotificationsError },
              '❌ Insert/upsert advertiser notifications failed',
            );
          }
        }
      }

      return true;
    } catch (error) {
      throw error;
    }
  },

  // Rejeter une vidéo
  async rejectVideo(videoId: string, adminId: string, notes?: string): Promise<boolean> {
    try {
      // TODO(phase-1): typed source [supabase] — see #15
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        validation_status: 'rejected',
        validated_by: adminId,
        validated_at: new Date().toISOString(),
      };

      if (notes) {
        updateData.validation_notes = notes;
      }

      const { error } = await supabase
        .from('videos')
        .update(updateData)
        .eq('id', videoId)
        .select();

      if (error) {
        throw new Error(error.message);
      }

      return true;
    } catch (error) {
      throw error;
    }
  },

  // Supprimer une vidéo (supprime aussi les liaisons avec les campagnes)
  async deleteVideo(videoId: string): Promise<boolean> {
    try {
      const { error } = await supabase.from('videos').delete().eq('id', videoId);

      if (error) {
        log.error({ error }, '❌ Error deleting video');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Error in deleteVideo');
      return false;
    }
  },

  // Récupérer les statistiques de validation
  async getValidationStats(): Promise<VideoValidationStats> {
    try {
      const { data, error } = await supabase.rpc('get_video_validation_stats');

      if (error) {
        log.error({ error }, '❌ Error fetching stats');
        return {
          total_videos: 0,
          pending_videos: 0,
          approved_videos: 0,
          rejected_videos: 0,
        };
      }

      return (
        data[0] || {
          total_videos: 0,
          pending_videos: 0,
          approved_videos: 0,
          rejected_videos: 0,
        }
      );
    } catch (error) {
      log.error({ error }, '❌ Exception in getValidationStats');
      return {
        total_videos: 0,
        pending_videos: 0,
        approved_videos: 0,
        rejected_videos: 0,
      };
    }
  },

  // Mettre à jour les notes de validation sans changer le statut
  async updateValidationNotes(videoId: string, notes: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('videos')
        .update({
          validation_notes: notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', videoId);

      if (error) {
        log.error({ error }, '❌ Error updating notes');
        return false;
      }

      return true;
    } catch (error) {
      log.error({ error }, '❌ Error in updateValidationNotes');
      return false;
    }
  },

  // Récupérer les campagnes affectées par une vidéo
  async getCampaignsUsingVideo(videoId: string): Promise<CampaignUsingVideo[]> {
    try {
      // Utiliser rpc si disponible, sinon requête directe
      try {
        const { data, error } = await supabase.rpc('get_campaigns_using_video', {
          video_uuid: videoId,
        });

        if (!error && data) {
          return data;
        }
      } catch {
        // Intentional: RPC `get_campaigns_using_video` failure falls back to
        // the direct-query path below.
      }

      // Fallback: requête directe
      const { data, error } = await supabase
        .from('campaigns')
        .select(
          `
          id,
          name,
          status,
          user_id
        `,
        )
        .eq('video_id', videoId);

      if (error) {
        log.error({ error }, '❌ Error fetching campaigns');
        return [];
      }

      return (data || []).map((c) => ({
        campaign_id: c.id,
        campaign_name: c.name,
        campaign_status: c.status,
        advertiser_name: 'N/A', // À enrichir si besoin
      }));
    } catch (error) {
      log.error({ error }, '❌ Exception in getCampaignsUsingVideo');
      return [];
    }
  },
};
