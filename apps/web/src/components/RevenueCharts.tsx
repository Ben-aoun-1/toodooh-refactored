import { TrendingUp, TrendingDown, DollarSign, Monitor, MapPin } from 'lucide-react';
import React from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

interface MonthlyComparison {
  month: string;
  revenue: number;
  screens: number;
  growth: number;
}

interface ScreenRevenue {
  screen_id: string;
  screen_name: string;
  location: string;
  total_revenue: number;
  monthly_revenue: number;
  average_revenue: number;
  revenue_history: unknown[];
}

interface RevenueChartsProps {
  monthlyData: MonthlyComparison[];
  screenData: ScreenRevenue[];
  period: 'monthly' | 'quarterly' | 'yearly';
}

const COLORS = [
  '#00B3A6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#06B6D4',
  '#84CC16',
  '#F97316',
];

export default function RevenueCharts({ monthlyData, screenData, period }: RevenueChartsProps) {
  // Préparer les données pour le graphique en barres des écrans
  const screenChartData = screenData
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 8) // Top 8 écrans
    .map((screen) => ({
      name: screen.screen_name,
      revenue: screen.total_revenue,
      monthly: screen.monthly_revenue,
      location: screen.location,
    }));

  // Préparer les données pour le graphique circulaire par emplacement
  const locationData = screenData.reduce(
    (acc, screen) => {
      const location = screen.location;
      if (!acc[location]) {
        acc[location] = { name: location, value: 0, count: 0 };
      }
      acc[location].value += screen.total_revenue;
      acc[location].count += 1;
      return acc;
    },
    {} as Record<string, { name: string; value: number; count: number }>,
  );

  const locationChartData = Object.values(locationData)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6); // Top 6 emplacements

  // Formater les valeurs monétaires
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('fr-TN', {
      style: 'currency',
      currency: 'TND',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Formater les pourcentages
  const formatPercentage = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  };

  // Custom tooltip pour les graphiques
  // TODO(phase-1): typed source [recharts] — see #15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200">
          <p className="font-semibold text-gray-900">{label}</p>
          {payload.map(
            (entry: { color: string; name: string; value: number }, index: number) => (
              <p key={index} className="text-sm" style={{ color: entry.color }}>
                {entry.name}: {formatCurrency(entry.value)}
              </p>
            ),
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-8">
      {/* Graphique linéaire - Évolution mensuelle */}
      <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Évolution des Revenus</h3>
            <p className="text-gray-600">Comparaison mois par mois</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <p className="text-gray-600 text-sm">Croissance</p>
              <div className="flex items-center space-x-1">
                {monthlyData[monthlyData.length - 1]?.growth >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600" />
                )}
                <span
                  className={`font-semibold ${
                    monthlyData[monthlyData.length - 1]?.growth >= 0
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}
                >
                  {formatPercentage(monthlyData[monthlyData.length - 1]?.growth || 0)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={monthlyData}>
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00B3A6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00B3A6" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" />
            <XAxis
              dataKey="month"
              stroke="rgba(0,0,0,0.6)"
              fontSize={12}
              tick={{ fill: 'rgba(0,0,0,0.7)' }}
            />
            <YAxis
              stroke="rgba(0,0,0,0.6)"
              fontSize={12}
              tick={{ fill: 'rgba(0,0,0,0.7)' }}
              tickFormatter={formatCurrency}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#00B3A6"
              strokeWidth={3}
              fill="url(#revenueGradient)"
              name="Revenus"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Graphique en barres - Top écrans */}
      <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Top Écrans Performants</h3>
            <p className="text-gray-600">Revenus totaux par écran</p>
          </div>
          <div className="flex items-center space-x-2 text-gray-600">
            <Monitor className="h-4 w-4" />
            <span className="text-sm">{screenData.length} écrans</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={screenChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" />
            <XAxis
              dataKey="name"
              stroke="rgba(0,0,0,0.6)"
              fontSize={11}
              angle={-45}
              textAnchor="end"
              height={80}
              tick={{ fill: 'rgba(0,0,0,0.7)' }}
            />
            <YAxis
              stroke="rgba(0,0,0,0.6)"
              fontSize={12}
              tick={{ fill: 'rgba(0,0,0,0.7)' }}
              tickFormatter={formatCurrency}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="revenue" fill="#00B3A6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Graphiques côte à côte */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Graphique circulaire - Répartition par emplacement */}
        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Répartition par Emplacement</h3>
              <p className="text-gray-600">Part des revenus par zone</p>
            </div>
            <div className="flex items-center space-x-2 text-gray-600">
              <MapPin className="h-4 w-4" />
              <span className="text-sm">{locationChartData.length} zones</span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={locationChartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {locationChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => [formatCurrency(value), 'Revenus']}
                labelStyle={{ color: '#000' }}
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Graphique linéaire - Comparaison mensuelle vs trimestrielle */}
        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Tendances de Croissance</h3>
              <p className="text-gray-600">Évolution et prévisions</p>
            </div>
            <div className="flex items-center space-x-2 text-gray-600">
              <DollarSign className="h-4 w-4" />
              <span className="text-sm">Période: {period}</span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={monthlyData.slice(-6)}>
              {' '}
              {/* 6 derniers mois */}
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" />
              <XAxis
                dataKey="month"
                stroke="rgba(0,0,0,0.6)"
                fontSize={11}
                tick={{ fill: 'rgba(0,0,0,0.7)' }}
              />
              <YAxis
                stroke="rgba(0,0,0,0.6)"
                fontSize={11}
                tick={{ fill: 'rgba(0,0,0,0.7)' }}
                tickFormatter={formatCurrency}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#00B3A6"
                strokeWidth={2}
                dot={{ fill: '#00B3A6', strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, stroke: '#00B3A6', strokeWidth: 2 }}
                name="Revenus"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
