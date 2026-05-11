import {
  Gift,
  Star,
  ShoppingCart,
  Heart,
  Filter,
  Search,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Bell,
  User,
  LogOut,
} from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import OwnerNavigation from '../components/OwnerNavigation';
import { useAuthStore } from '../stores/auth.store';

interface GiftItem {
  id: string;
  name: string;
  description: string;
  pointsRequired: number;
  image: string;
  category: 'electronics' | 'vouchers' | 'experiences' | 'gadgets';
  available: boolean;
}

export default function GiftCatalogPage() {
  const navigate = useNavigate();
  const { user, profileType } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [userPoints, setUserPoints] = useState(1250);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'points' | 'name' | 'popular'>('popular');
  const [showFilters, setShowFilters] = useState(false);

  // Données du catalogue cadeaux (mêmes que dans le composant GiftCatalog)
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

  const categories = [
    { id: 'all', name: 'Toutes les catégories', count: giftItems.length },
    {
      id: 'electronics',
      name: 'Électronique',
      count: giftItems.filter((item) => item.category === 'electronics').length,
    },
    {
      id: 'vouchers',
      name: 'Cartes cadeaux',
      count: giftItems.filter((item) => item.category === 'vouchers').length,
    },
    {
      id: 'experiences',
      name: 'Expériences',
      count: giftItems.filter((item) => item.category === 'experiences').length,
    },
    {
      id: 'gadgets',
      name: 'Gadgets',
      count: giftItems.filter((item) => item.category === 'gadgets').length,
    },
  ];

  useEffect(() => {
    const checkAuth = async () => {
      if (!user) {
        navigate('/login');
        return;
      }

      console.log('BYPASS: Accès autorisé pour tous les types de profil');
      console.log('Type de profil actuel:', profileType);

      setLoading(false);
    };

    checkAuth();
  }, [user, navigate]);

  const filteredItems = giftItems
    .filter(
      (item) =>
        (selectedCategory === 'all' || item.category === selectedCategory) &&
        (searchTerm === '' ||
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.description.toLowerCase().includes(searchTerm.toLowerCase())),
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'points':
          return a.pointsRequired - b.pointsRequired;
        case 'name':
          return a.name.localeCompare(b.name);
        case 'popular':
          return 0; // Pas de propriété popular dans le nouveau modèle
        default:
          return 0;
      }
    });

  const handleRedeem = (item: GiftItem) => {
    if (userPoints >= item.pointsRequired) {
      setUserPoints((prev) => prev - item.pointsRequired);
      toast.success(`Cadeau "${item.name}" échangé avec succès !`);
    } else {
      toast.error('Points insuffisants pour échanger ce cadeau');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement du catalogue...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center space-x-4">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                      <Gift className="h-6 w-6 text-[#00B3A6] mr-2" />
                      Catalogue Cadeaux
                    </h1>
                    <p className="text-sm text-gray-600 mt-1">
                      Échangez vos points contre des récompenses
                    </p>
                  </div>
                  <span className="px-3 py-1 text-sm font-medium bg-[#00B3A6]/10 text-[#00B3A6] border border-[#00B3A6]/20 rounded-full">
                    {filteredItems.length} cadeau{filteredItems.length > 1 ? 'x' : ''}
                  </span>
                </div>

                {/* Points utilisateur */}
                <div className="flex items-center space-x-4">
                  <div className="bg-white rounded-xl px-4 py-2 border border-gray-200 shadow-sm">
                    <div className="flex items-center space-x-2">
                      <Star className="h-5 w-5 text-yellow-500" />
                      <span className="text-gray-900 font-semibold">
                        {userPoints.toLocaleString()}
                      </span>
                      <span className="text-gray-600 text-sm">points</span>
                    </div>
                  </div>

                  <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative text-gray-600">
                    <Bell className="h-6 w-6" />
                    <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                      3
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {/* Filtres et recherche */}
              <div className="mb-8">
                <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
                    {/* Barre de recherche */}
                    <div className="relative flex-1 max-w-md">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Rechercher un cadeau..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6]"
                      />
                    </div>

                    {/* Filtres */}
                    <div className="flex items-center space-x-4">
                      <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Filter className="h-4 w-4" />
                        <span>Filtres</span>
                        {showFilters ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as 'points' | 'name' | 'popular')}
                        className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6]"
                      >
                        <option value="popular">Plus populaires</option>
                        <option value="points">Points croissants</option>
                        <option value="name">Ordre alphabétique</option>
                      </select>
                    </div>
                  </div>

                  {/* Filtres étendus */}
                  {showFilters && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex flex-wrap gap-2">
                        {categories.map((category) => (
                          <button
                            key={category.id}
                            onClick={() => setSelectedCategory(category.id)}
                            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                              selectedCategory === category.id
                                ? 'bg-[#00B3A6] text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {category.name} ({category.count})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Grille des cadeaux */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 flex flex-col h-full shadow-lg"
                  >
                    {/* Image du cadeau */}
                    <div className="relative h-48 bg-gradient-to-br from-[#00B3A6]/10 to-[#00B3A6]/5 flex items-center justify-center">
                      <div className="text-6xl">{item.image}</div>
                      {!item.available && (
                        <div className="absolute top-2 left-2 bg-yellow-500 text-white text-xs px-2 py-1 rounded-full font-medium">
                          Indisponible
                        </div>
                      )}
                      <button className="absolute top-2 right-2 p-2 bg-white/80 backdrop-blur-sm rounded-full hover:bg-white transition-colors">
                        <Heart className="h-4 w-4 text-gray-600" />
                      </button>
                    </div>

                    {/* Contenu du cadeau */}
                    <div className="p-4 flex flex-col h-full">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">{item.name}</h3>
                      <p className="text-gray-600 text-sm mb-4 line-clamp-2 flex-1">
                        {item.description}
                      </p>

                      <div className="space-y-3">
                        {/* Points */}
                        <div className="flex items-center space-x-2">
                          <Star className="h-4 w-4 text-yellow-500" />
                          <span className="text-gray-900 font-semibold">{item.pointsRequired}</span>
                          <span className="text-gray-600 text-sm">points</span>
                        </div>

                        {/* Bouton Échanger */}
                        <button
                          onClick={() => handleRedeem(item)}
                          disabled={userPoints < item.pointsRequired || !item.available}
                          className={`w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
                            userPoints >= item.pointsRequired && item.available
                              ? 'bg-[#00B3A6] text-white hover:bg-[#00B3A6]/90'
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          <ShoppingCart className="h-4 w-4" />
                          <span>Échanger</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Message si aucun résultat */}
              {filteredItems.length === 0 && (
                <div className="text-center py-12">
                  <Gift className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Aucun cadeau trouvé</h3>
                  <p className="text-gray-600">Essayez de modifier vos critères de recherche</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
