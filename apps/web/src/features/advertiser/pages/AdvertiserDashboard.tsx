import BalanceCard from '@/features/advertiser/components/dashboard/BalanceCard';
import EventsEntryCard from '@/features/advertiser/components/dashboard/EventsEntryCard';
import GettingStartedSection from '@/features/advertiser/components/dashboard/GettingStartedSection';
import InsightsCard from '@/features/advertiser/components/dashboard/InsightsCard';
import LastCampaignsGrid from '@/features/advertiser/components/dashboard/LastCampaignsGrid';
import StatsGrid from '@/features/advertiser/components/dashboard/StatsGrid';
import { useDashboardStats } from '@/features/advertiser/hooks/useDashboardStats';
import { useLastCampaigns } from '@/features/advertiser/hooks/useLastCampaigns';
import { useUserProfile } from '@/features/advertiser/hooks/useUserProfile';
import { useAuthStore } from '@/features/auth/stores/auth.store';

export default function AdvertiserDashboard() {
  const user = useAuthStore((s) => s.user);
  const needsApproval = useAuthStore((s) => s.needsApproval);
  const validationStatus = useAuthStore((s) => s.validationStatus);

  const {
    stats,
    availableBalanceTnd,
    totalCreatedCampaignsCount,
    loading: loadingStats,
    isError: statsError,
    refetch: refetchStats,
  } = useDashboardStats(user?.id);
  const { campaigns: lastCampaigns, loading: loadingLastCampaigns } = useLastCampaigns(user?.id, 5);
  const { profile } = useUserProfile(user?.id);

  const isDisabled = Boolean(needsApproval && validationStatus === 'pending');
  // F5 (Kais QA 2026-06-11): read /api/me's documents boolean — the legacy registration_doc_*
  // fields are never set by the bridge, which kept the getting-started block permanently visible.
  const hasRegistrationDocument = Boolean(profile?.documents?.registration);
  const canRechargeAccount =
    !isDisabled && validationStatus === 'approved' && profile?.is_active !== false;
  const canLaunchCampaign = !isDisabled && validationStatus === 'approved';
  const hideGettingStartedBlock =
    hasRegistrationDocument && availableBalanceTnd > 0 && totalCreatedCampaignsCount > 0;

  return (
    <div className="w-full space-y-8">
      {/* GREEN2 (the INV-1 rule) — a failed stats read renders as an ERROR, never zeros-as-truth. */}
      {statsError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-6 py-10 text-center">
          <p className="text-sm font-medium text-rose-600">
            Impossible de charger votre solde et vos statistiques pour le moment.
          </p>
          <button
            type="button"
            onClick={refetchStats}
            className="mt-4 rounded-full border border-rose-300 bg-white px-5 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            Réessayer
          </button>
        </div>
      ) : (
        <>
          <BalanceCard
            balance={stats.balance}
            balanceTotal={stats.balanceTotal}
            loading={loadingStats}
            isDisabled={isDisabled}
          />
          <StatsGrid
            campaignsDiffused={stats.campaignsDiffused}
            totalViews={stats.totalViews}
            totalDurationSeconds={stats.totalDurationSeconds}
            totalBudget={stats.totalBudget}
            loading={loadingStats}
          />
        </>
      )}
      <LastCampaignsGrid campaigns={lastCampaigns} loading={loadingLastCampaigns} />
      {/* EV3 (voie 2) — the Événements entry tile. */}
      <EventsEntryCard />
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
