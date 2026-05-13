import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'campaign-owner-approval.service' });


export interface CampaignOwnerApproval {
  id: string;
  campaign_id: string;
  owner_id: string;
  screen_ids?: string[];
  status: 'pending' | 'approved' | 'rejected';
  approved_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface PendingCampaign {
  campaign_id: string;
  campaign_name: string;
  campaign_start_date: string;
  campaign_end_date: string;
  screen_ids: string[]; // Seulement les écrans du propriétaire
  screen_names: string[]; // Seulement les noms des écrans du propriétaire
  approval_id?: string;
  approval_status?: 'pending' | 'approved' | 'rejected';
}

export const campaignOwnerApprovalService = {
  // Récupérer les campagnes en attente de validation pour un propriétaire
  async getPendingCampaigns(ownerId: string): Promise<PendingCampaign[]> {
    try {
      // Récupérer tous les écrans du propriétaire
      const { data: screens, error: screensError } = await supabase
        .from('screens')
        .select('id, name')
        .eq('owner_id', ownerId)
        .eq('status', 'active');

      if (screensError) throw screensError;
      if (!screens || screens.length === 0) return [];

      const screenIds = screens.map((s) => s.id);

      // Récupérer les campagnes actives ou en attente qui utilisent ces écrans
      const { data: campaignScreens, error: csError } = await supabase
        .from('campaign_screens')
        .select('campaign_id, screen_id')
        .in('screen_id', screenIds);

      if (csError) throw csError;
      if (!campaignScreens || campaignScreens.length === 0) return [];

      // Grouper par campagne
      const campaignMap = new Map<string, string[]>();
      campaignScreens.forEach((cs) => {
        if (!campaignMap.has(cs.campaign_id)) {
          campaignMap.set(cs.campaign_id, []);
        }
        campaignMap.get(cs.campaign_id)!.push(cs.screen_id);
      });

      const campaignIds = Array.from(campaignMap.keys());

      // Récupérer les détails des campagnes (seulement nom, dates)
      // Trier par date de création décroissante (plus récente en premier)
      const { data: campaigns, error: campaignsError } = await supabase
        .from('campaigns')
        .select(
          `
          id,
          name,
          start_date,
          end_date,
          status,
          created_at,
          video_id,
          content_validation_status
        `,
        )
        .in('id', campaignIds)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (campaignsError) throw campaignsError;
      if (!campaigns) return [];

      // Garder uniquement les campagnes avec vidéo validée/active
      const videoIds = Array.from(
        new Set((campaigns || []).map((c: any) => c.video_id).filter(Boolean)),
      );
      const approvedVideoIdSet = new Set<string>();
      if (videoIds.length > 0) {
        const { data: approvedVideos, error: videosError } = await supabase
          .from('videos')
          .select('id')
          .in('id', videoIds)
          .eq('validation_status', 'approved');
        if (videosError) throw videosError;
        (approvedVideos || []).forEach((v: any) => approvedVideoIdSet.add(v.id));
      }

      const eligibleCampaigns = (campaigns || []).filter((campaign: any) => {
        // Compat: accepter soit via content_validation_status approved, soit vidéo approved
        if (campaign?.content_validation_status === 'approved') return true;
        if (campaign?.video_id && approvedVideoIdSet.has(campaign.video_id)) return true;
        return false;
      });
      if (eligibleCampaigns.length === 0) return [];

      const eligibleCampaignIds = eligibleCampaigns.map((c: any) => c.id);

      // Récupérer les validations existantes
      const { data: approvals, error: approvalsError } = await supabase
        .from('campaign_owner_approvals')
        .select('*')
        .eq('owner_id', ownerId)
        .in('campaign_id', eligibleCampaignIds);

      if (approvalsError) throw approvalsError;

      const approvalMap = new Map<string, CampaignOwnerApproval>();
      (approvals || []).forEach((approval) => {
        approvalMap.set(approval.campaign_id, approval);
      });

      // Construire la liste des campagnes en attente
      const pendingCampaigns: PendingCampaign[] = [];

      for (const campaign of eligibleCampaigns as any[]) {
        const campaignScreenIds = campaignMap.get(campaign.id) || [];
        if (campaignScreenIds.length === 0) continue;
        const existingApproval = approvalMap.get(campaign.id);

        // Si déjà approuvé/rejeté, ne pas lister dans "pending".
        if (existingApproval && existingApproval.status !== 'pending') {
          continue;
        }

        const ownerScreenIds = campaignScreenIds.filter((id) => screenIds.includes(id));
        const screenNames = screens.filter((s) => ownerScreenIds.includes(s.id)).map((s) => s.name);

        pendingCampaigns.push({
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          campaign_start_date: campaign.start_date,
          campaign_end_date: campaign.end_date,
          screen_ids: ownerScreenIds,
          screen_names: screenNames,
          approval_id: existingApproval?.id,
          approval_status: existingApproval?.status || 'pending',
        });
      }

      // Trier les campagnes par date de création décroissante (plus récente en premier)
      // Récupérer les dates de création depuis les campagnes
      const campaignCreationMap = new Map<string, string>();
      eligibleCampaigns.forEach((campaign: any) => {
        campaignCreationMap.set(campaign.id, campaign.created_at);
      });

      // Trier le tableau final
      pendingCampaigns.sort((a, b) => {
        const dateA = campaignCreationMap.get(a.campaign_id) || '';
        const dateB = campaignCreationMap.get(b.campaign_id) || '';
        return dateB.localeCompare(dateA); // Décroissant (plus récent en premier)
      });

      return pendingCampaigns;
    } catch (error) {
      throw error;
    }
  },

  // Compter les campagnes en attente
  async getPendingCount(ownerId: string): Promise<number> {
    try {
      const pendingCampaigns = await this.getPendingCampaigns(ownerId);
      return pendingCampaigns.filter((c) => c.approval_status === 'pending').length;
    } catch (error) {
      log.error({ error }, 'Erreur lors du comptage des campagnes en attente');
      return 0;
    }
  },

  // Approuver automatiquement une campagne (compat legacy)
  async autoApproveCampaign(
    campaignId: string,
    ownerId: string,
    screenIds: string[],
  ): Promise<void> {
    try {
      const { error } = await supabase.from('campaign_owner_approvals').upsert(
        {
          campaign_id: campaignId,
          owner_id: ownerId,
          screen_ids: [],
          status: 'approved',
          approved_at: new Date().toISOString(),
        },
        {
          onConflict: 'campaign_id,owner_id',
        },
      );

      if (error) throw error;

      // Recalculer les répétitions après approbation
      const { campaignService } = await import('./campaign.service');
      await campaignService.recalculateRepetitionsAfterApproval(campaignId, {
        actorOwnerId: ownerId,
      });
    } catch (error) {
      throw error;
    }
  },

  // Approuver une campagne manuellement
  async approveCampaign(campaignId: string, ownerId: string, screenIds?: string[]): Promise<void> {
    try {
      void screenIds;

      const { error } = await supabase.from('campaign_owner_approvals').upsert(
        {
          campaign_id: campaignId,
          owner_id: ownerId,
          screen_ids: [],
          status: 'approved',
          approved_at: new Date().toISOString(),
        },
        {
          onConflict: 'campaign_id,owner_id',
        },
      );

      if (error) throw error;

      // Recalculer les répétitions après approbation
      const { campaignService } = await import('./campaign.service');
      await campaignService.recalculateRepetitionsAfterApproval(campaignId, {
        actorOwnerId: ownerId,
      });
    } catch (error) {
      throw error;
    }
  },

  // Rejeter une campagne
  async rejectCampaign(
    campaignId: string,
    ownerId: string,
    rejectionReason?: string,
  ): Promise<void> {
    try {
      const { error } = await supabase.from('campaign_owner_approvals').upsert(
        {
          campaign_id: campaignId,
          owner_id: ownerId,
          screen_ids: [],
          status: 'rejected',
          rejected_at: new Date().toISOString(),
          rejection_reason: rejectionReason,
        },
        {
          onConflict: 'campaign_id,owner_id',
        },
      );

      if (error) throw error;

      // Recalculer les répétitions après rejet (les écrans rejetés ne seront plus inclus)
      const { campaignService } = await import('./campaign.service');
      await campaignService.recalculateRepetitionsAfterApproval(campaignId, {
        actorOwnerId: ownerId,
      });
    } catch (error) {
      throw error;
    }
  },
};
