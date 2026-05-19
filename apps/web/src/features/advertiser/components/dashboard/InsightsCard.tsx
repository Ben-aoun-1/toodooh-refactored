import { Link2, MapPin, TrendingUp } from 'lucide-react';

const INSIGHTS = [
  {
    icon: TrendingUp,
    title: 'Performances optimales',
    body: 'Vos campagnes Sport génèrent le meilleur ROI à 53.6 impressions/TND',
  },
  {
    icon: MapPin,
    title: 'Zones performantes',
    body: 'Sidi Bou Said représente 44% de vos impressions avec 32 écrans actifs',
  },
  {
    icon: Link2,
    title: "Opportunités d'optimisation",
    body: 'Réduisez votre CPM de 15% en ciblant les heures de forte affluence',
  },
] as const;

export default function InsightsCard() {
  return (
    <div
      className="mb-10 flex flex-col items-start rounded-2xl border border-[#96E3B0] bg-[#F5FAF8] p-4 shadow-sm"
      style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
    >
      <div className="flex w-full flex-col items-start gap-1">
        <h2 className="text-lg font-bold leading-6 text-gray-900">Insights clés</h2>
        <p className="text-sm font-normal text-gray-600">
          Recommandations basées sur l&apos;analyse de vos données
        </p>
      </div>
      <div className="mt-4 flex w-full flex-row flex-wrap items-start gap-6">
        {INSIGHTS.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="flex min-w-0 flex-1 flex-row items-start gap-3 rounded-xl border border-brand-primary bg-white p-4"
            style={{ boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.0313726)' }}
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#DCF0E9]">
              <Icon className="h-6 w-6 text-[#142522]" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h3 className="text-xs font-semibold text-gray-900 whitespace-nowrap truncate">
                {title}
              </h3>
              <p className="text-xs font-normal text-gray-600 leading-4">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
