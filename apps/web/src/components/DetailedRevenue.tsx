import React, { useState } from 'react';
import { 
  BarChart3, 
  X, 
  DollarSign,
  TrendingUp,
  TrendingDown,
  Calendar,
  Monitor,
  Filter
} from 'lucide-react';

interface RevenueData {
  screenId: string;
  screenName: string;
  campaignId: string;
  campaignName: string;
  revenue: number;
  impressions: number;
  clicks: number;
  date: string;
  duration: number; // en heures
}

interface DetailedRevenueProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DetailedRevenue({ isOpen, onClose }: DetailedRevenueProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<string>('month');
  const [selectedScreen, setSelectedScreen] = useState<string>('all');

  // Données simulées
  const revenueData: RevenueData[] = [
    {
      screenId: '1',
      screenName: 'Écran Centre-ville',
      campaignId: 'camp1',
      campaignName: 'Campagne Coca-Cola',
      revenue: 450.25,
      impressions: 12500,
      clicks: 125,
      date: '2024-01-15',
      duration: 24
    },
    {
      screenId: '1',
      screenName: 'Écran Centre-ville',
      campaignId: 'camp2',
      campaignName: 'Campagne Nike',
      revenue: 320.50,
      impressions: 8900,
      clicks: 89,
      date: '2024-01-14',
      duration: 18
    },
    {
      screenId: '2',
      screenName: 'Écran Mall',
      campaignId: 'camp3',
      campaignName: 'Campagne Samsung',
      revenue: 280.75,
      impressions: 7600,
      clicks: 76,
      date: '2024-01-15',
      duration: 12
    },
    {
      screenId: '2',
      screenName: 'Écran Mall',
      campaignId: 'camp4',
      campaignName: 'Campagne McDonald\'s',
      revenue: 195.30,
      impressions: 5200,
      clicks: 52,
      date: '2024-01-13',
      duration: 16
    },
    {
      screenId: '3',
      screenName: 'Écran Station',
      campaignId: 'camp5',
      campaignName: 'Campagne Orange',
      revenue: 0,
      impressions: 0,
      clicks: 0,
      date: '2024-01-15',
      duration: 0
    }
  ];

  const screens = [
    { id: 'all', name: 'Tous les écrans' },
    { id: '1', name: 'Écran Centre-ville' },
    { id: '2', name: 'Écran Mall' },
    { id: '3', name: 'Écran Station' }
  ];

  const periods = [
    { id: 'week', name: 'Cette semaine' },
    { id: 'month', name: 'Ce mois' },
    { id: 'quarter', name: 'Ce trimestre' },
    { id: 'year', name: 'Cette année' }
  ];

  const filteredData = revenueData.filter(item => 
    selectedScreen === 'all' || item.screenId === selectedScreen
  );

  const totalRevenue = filteredData.reduce((sum, item) => sum + item.revenue, 0);
  const totalImpressions = filteredData.reduce((sum, item) => sum + item.impressions, 0);
  const totalClicks = filteredData.reduce((sum, item) => sum + item.clicks, 0);
  const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(2) : '0';

  const getRevenueChange = () => {
    // Simulation de variation
    return Math.random() > 0.5 ? 12.5 : -8.3;
  };

  const revenueChange = getRevenueChange();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <BarChart3 className="h-6 w-6 text-purple-600" />
            <h2 className="text-xl font-bold text-gray-900">Revenus Détaillés</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4 text-gray-600" />
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex items-center space-x-2">
              <Monitor className="h-4 w-4 text-gray-600" />
              <select
                value={selectedScreen}
                onChange={(e) => setSelectedScreen(e.target.value)}
                className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                {screens.map((screen) => (
                  <option key={screen.id} value={screen.id}>
                    {screen.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="px-6 py-4 border-b">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Revenus Totaux</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {totalRevenue.toLocaleString('fr-TN', { style: 'currency', currency: 'TND' })}
                  </p>
                </div>
                <div className={`flex items-center space-x-1 ${revenueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {revenueChange >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">{Math.abs(revenueChange)}%</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Impressions</p>
                <p className="text-2xl font-bold text-gray-900">
                  {totalImpressions.toLocaleString('fr-FR')}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Clics</p>
                <p className="text-2xl font-bold text-gray-900">
                  {totalClicks.toLocaleString('fr-FR')}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Taux de Clic</p>
                <p className="text-2xl font-bold text-gray-900">{avgCTR}%</p>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Table */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4">
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Écran
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Campagne
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Durée
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Impressions
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Clics
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        CTR
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Revenus
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredData.map((item, index) => {
                      const ctr = item.impressions > 0 ? (item.clicks / item.impressions * 100).toFixed(2) : '0';
                      return (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{item.screenName}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{item.campaignName}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {new Date(item.date).toLocaleDateString('fr-FR')}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">{item.duration}h</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {item.impressions.toLocaleString('fr-FR')}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {item.clicks.toLocaleString('fr-FR')}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{ctr}%</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {item.revenue.toLocaleString('fr-TN', { style: 'currency', currency: 'TND' })}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 