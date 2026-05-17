import { Gift, Star, X, ShoppingCart, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

interface GiftItem {
  id: string;
  name: string;
  description: string;
  pointsRequired: number;
  image: string;
  category: 'electronics' | 'vouchers' | 'experiences' | 'gadgets';
  available: boolean;
}

const giftItems: GiftItem[] = [
  {
    id: '1',
    name: 'Carte cadeau Carrefour',
    description: 'Carte cadeau de 100 TND pour vos courses',
    pointsRequired: 500,
    image: '🛒',
    category: 'vouchers',
    available: true,
  },
  {
    id: '2',
    name: 'Écouteurs Bluetooth',
    description: 'Écouteurs sans fil haute qualité',
    pointsRequired: 800,
    image: '🎧',
    category: 'electronics',
    available: true,
  },
  {
    id: '3',
    name: 'Montre connectée',
    description: "Montre intelligente avec suivi d'activité",
    pointsRequired: 1200,
    image: '⌚',
    category: 'electronics',
    available: true,
  },
  {
    id: '4',
    name: 'Carte cadeau restaurant',
    description: 'Carte cadeau de 150 TND pour un restaurant partenaire',
    pointsRequired: 750,
    image: '🍽️',
    category: 'vouchers',
    available: true,
  },
  {
    id: '5',
    name: 'Power Bank 10000mAh',
    description: 'Batterie externe portable',
    pointsRequired: 600,
    image: '🔋',
    category: 'gadgets',
    available: true,
  },
  {
    id: '6',
    name: 'Expérience spa',
    description: "Séance de spa d'une heure",
    pointsRequired: 1000,
    image: '💆',
    category: 'experiences',
    available: false,
  },
];

interface GiftCatalogProps {
  isOpen: boolean;
  onClose: () => void;
  userPoints: number;
}

export default function GiftCatalog({ isOpen, onClose, userPoints }: GiftCatalogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [isExchanging, setIsExchanging] = useState(false);

  const categories = [
    { id: 'all', name: 'Tous', icon: '🎁' },
    { id: 'electronics', name: 'Électronique', icon: '📱' },
    { id: 'vouchers', name: 'Cartes cadeaux', icon: '💳' },
    { id: 'experiences', name: 'Expériences', icon: '🌟' },
    { id: 'gadgets', name: 'Gadgets', icon: '⚡' },
  ];

  const filteredGifts =
    selectedCategory === 'all'
      ? giftItems
      : giftItems.filter((gift) => gift.category === selectedCategory);

  const handleExchange = async (gift: GiftItem) => {
    if (userPoints < gift.pointsRequired) {
      toast.error('Points insuffisants pour échanger ce cadeau');
      return;
    }

    setIsExchanging(true);

    // Simuler l'échange
    setTimeout(() => {
      setIsExchanging(false);
      setSelectedGift(null);
      toast.success(
        `Félicitations ! Vous avez échangé "${gift.name}" contre ${gift.pointsRequired} points.`,
      );
    }, 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <Gift className="h-6 w-6 text-purple-600" />
            <h2 className="text-xl font-bold text-gray-900">Catalogue Cadeaux</h2>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 bg-purple-100 px-3 py-1 rounded-full">
              <Star className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium text-purple-600">{userPoints} points</span>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Categories */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="flex space-x-2 overflow-x-auto">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-full whitespace-nowrap transition-colors ${
                  selectedCategory === category.id
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span>{category.icon}</span>
                <span className="text-sm font-medium">{category.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedGift ? (
            /* Gift Detail View */
            <div className="max-w-2xl mx-auto">
              <div className="bg-white rounded-lg border p-6">
                <div className="text-center mb-6">
                  <div className="text-6xl mb-4">{selectedGift.image}</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{selectedGift.name}</h3>
                  <p className="text-gray-600">{selectedGift.description}</p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <span className="text-gray-700">Points requis :</span>
                    <div className="flex items-center space-x-2">
                      <Star className="h-5 w-5 text-purple-600" />
                      <span className="font-bold text-gray-900">{selectedGift.pointsRequired}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <span className="text-gray-700">Vos points :</span>
                    <div className="flex items-center space-x-2">
                      <Star className="h-5 w-5 text-purple-600" />
                      <span className="font-bold text-gray-900">{userPoints}</span>
                    </div>
                  </div>

                  {!selectedGift.available && (
                    <div className="flex items-center space-x-2 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <AlertTriangle className="h-5 w-5 text-yellow-600" />
                      <span className="text-yellow-800">
                        Ce cadeau n'est pas disponible pour le moment
                      </span>
                    </div>
                  )}

                  <div className="flex space-x-3">
                    <button
                      onClick={() => setSelectedGift(null)}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Retour
                    </button>
                    <button
                      onClick={() => handleExchange(selectedGift)}
                      disabled={
                        !selectedGift.available ||
                        userPoints < selectedGift.pointsRequired ||
                        isExchanging
                      }
                      className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
                    >
                      {isExchanging ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span>Échange en cours...</span>
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="h-4 w-4" />
                          <span>Échanger</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Gift Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredGifts.map((gift) => (
                <div
                  key={gift.id}
                  role="button"
                  tabIndex={0}
                  className={`bg-white rounded-lg border p-6 hover:shadow-lg transition-shadow cursor-pointer ${
                    !gift.available ? 'opacity-60' : ''
                  }`}
                  onClick={() => setSelectedGift(gift)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedGift(gift);
                    }
                  }}
                >
                  <div className="text-center">
                    <div className="text-4xl mb-4">{gift.image}</div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{gift.name}</h3>
                    <p className="text-sm text-gray-600 mb-4">{gift.description}</p>

                    <div className="flex items-center justify-center space-x-2 mb-4">
                      <Star className="h-4 w-4 text-purple-600" />
                      <span className="font-bold text-gray-900">{gift.pointsRequired} points</span>
                    </div>

                    {!gift.available && (
                      <div className="flex items-center justify-center space-x-1 text-yellow-600 text-sm">
                        <Info className="h-4 w-4" />
                        <span>Non disponible</span>
                      </div>
                    )}

                    {gift.available && userPoints >= gift.pointsRequired && (
                      <div className="flex items-center justify-center space-x-1 text-green-600 text-sm">
                        <CheckCircle className="h-4 w-4" />
                        <span>Disponible</span>
                      </div>
                    )}

                    {gift.available && userPoints < gift.pointsRequired && (
                      <div className="flex items-center justify-center space-x-1 text-red-600 text-sm">
                        <AlertTriangle className="h-4 w-4" />
                        <span>Points insuffisants</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
