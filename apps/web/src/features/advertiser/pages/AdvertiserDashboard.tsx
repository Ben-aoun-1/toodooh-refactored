
import { useAuthStore } from '../../auth/stores/auth.store';
import BalanceCard from '../components/dashboard/BalanceCard';
import FeaturedEventsGrid from '../components/dashboard/FeaturedEventsGrid';
import GettingStartedSection from '../components/dashboard/GettingStartedSection';
import InsightsCard from '../components/dashboard/InsightsCard';
import LastCampaignsGrid from '../components/dashboard/LastCampaignsGrid';
import StatsGrid from '../components/dashboard/StatsGrid';
import { useDashboardStats } from '../hooks/useDashboardStats';
import { useLastCampaigns } from '../hooks/useLastCampaigns';
import { useUserProfile } from '../hooks/useUserProfile';

export default function AdvertiserDashboard() {
  const user = useAuthStore((s) => s.user);
  const needsApproval = useAuthStore((s) => s.needsApproval);
  const validationStatus = useAuthStore((s) => s.validationStatus);

  const { stats, availableBalanceTnd, totalCreatedCampaignsCount, loading: loadingStats } =
    useDashboardStats(user?.id);
  const { campaigns: lastCampaigns, loading: loadingLastCampaigns } = useLastCampaigns(user?.id, 5);
  const { profile } = useUserProfile(user?.id);

  const isDisabled = Boolean(needsApproval && validationStatus === 'pending');
  const hasRegistrationDocument = Boolean(
    profile?.registration_doc_path || profile?.registration_doc_url,
  );
  const canRechargeAccount =
    !isDisabled && validationStatus === 'approved' && profile?.is_active !== false;
  const canLaunchCampaign = !isDisabled && validationStatus === 'approved';
  const hideGettingStartedBlock =
    hasRegistrationDocument && availableBalanceTnd > 0 && totalCreatedCampaignsCount > 0;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <BalanceCard balance={stats.balance} loading={loadingStats} isDisabled={isDisabled} />
      <FeaturedEventsGrid />
      <StatsGrid
        campaignsDiffused={stats.campaignsDiffused}
        totalViews={stats.totalViews}
        totalDurationSeconds={stats.totalDurationSeconds}
        totalBudget={stats.totalBudget}
        loading={loadingStats}
      />
      <LastCampaignsGrid campaigns={lastCampaigns} loading={loadingLastCampaigns} />
      {!hideGettingStartedBlock && (
        <GettingStartedSection
          hasRegistrationDocument={hasRegistrationDocument}
          canRechargeAccount={canRechargeAccount}
          canLaunchCampaign={canLaunchCampaign}
        />
      )}
      <InsightsCard />
    </div>
  );
}
