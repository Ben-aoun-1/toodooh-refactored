export type PerformancePeriodPreset = 'month' | 'quarter' | 'year' | 'custom';

export interface PerformanceFilters {
  preset: PerformancePeriodPreset;
  startDate: string;
  endDate: string;
  campaignId: string;
  locationId: string;
  campaignType: '' | 'standard' | 'event';
  category: string;
  zoneId: string;
}

export interface PerformanceFilterOption {
  value: string;
  label: string;
}

export interface PerformanceKpis {
  diffusionSeconds: number;
  impressions: number;
  affluence: number;
  activeScreens: number;
  spend: number;
}

export interface PerformanceTrendPoint {
  label: string;
  current: number;
  previous: number;
}

export interface PerformanceCategoryPoint {
  category: string;
  impressions: number;
}

export interface PerformanceTopCampaign {
  id: string;
  name: string;
  status: string;
  impressions: number;
  roi: number;
}

export interface PerformanceZonePoint {
  zoneId: string;
  zoneName: string;
  impressions: number;
  screensCount: number;
  sharePercent: number;
}

export interface PerformanceDetailedMetrics {
  averageDurationDays: number;
  placesTouched: number;
  totalBudget: number;
  completionRate: number;
}

export interface PerformanceDataset {
  filters: PerformanceFilters;
  options: {
    campaigns: PerformanceFilterOption[];
    locations: PerformanceFilterOption[];
    campaignTypes: PerformanceFilterOption[];
    categories: PerformanceFilterOption[];
    zones: PerformanceFilterOption[];
  };
  kpis: PerformanceKpis;
  previousKpis: PerformanceKpis;
  trend: PerformanceTrendPoint[];
  categoryPerformance: PerformanceCategoryPoint[];
  topCampaigns: PerformanceTopCampaign[];
  zonePerformance: PerformanceZonePoint[];
  detailedMetrics: PerformanceDetailedMetrics;
}
