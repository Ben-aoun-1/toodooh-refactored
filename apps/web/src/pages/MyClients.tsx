import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Users,
  Loader2,
  Search,
  PlusCircle,
  User,
  Mail,
  Phone,
  Building2,
  Eye,
  Pencil,
  Trash2,
  X,
  Save,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth.store';
import { toast } from 'react-hot-toast';

function getMonth(dateStr: string) {
  return new Date(dateStr).getMonth() + 1;
}
function getYear(dateStr: string) {
  return new Date(dateStr).getFullYear();
}

export default function MyClients() {
  const user = useAuthStore((state) => state.user);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    contact_email: '',
    contact_phone: '',
    societe: '',
  });

  useEffect(() => {
    async function fetchClients() {
      setLoading(true);
      if (!user) return;
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (!error) setClients(data || []);
      setLoading(false);
    }
    fetchClients();
  }, [user]);

  // Stats
  const totalClients = clients.length;
  const now = new Date();
  const newThisMonth = clients.filter(
    (c) =>
      getMonth(c.created_at) === now.getMonth() + 1 && getYear(c.created_at) === now.getFullYear(),
  ).length;

  // Filtrage
  const filtered = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.contact_email.toLowerCase().includes(search.toLowerCase()) ||
      c.societe?.toLowerCase().includes(search.toLowerCase()),
  );

  // Fonctions utilitaires
  const resetForm = () => {
    setFormData({
      name: '',
      contact_email: '',
      contact_phone: '',
      societe: '',
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Ajouter un client
  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const { error } = await supabase.from('clients').insert([
        {
          ...formData,
          user_id: user.id,
        },
      ]);

      if (error) throw error;

      toast.success('Client ajouté avec succès');
      setShowAddModal(false);
      resetForm();
      // Recharger la liste
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setClients(data || []);
    } catch (error) {
      console.error("Erreur lors de l'ajout:", error);
      toast.error("Erreur lors de l'ajout du client");
    }
  };

  // Modifier un client
  const handleEditClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;

    try {
      const { error } = await supabase.from('clients').update(formData).eq('id', selectedClient.id);

      if (error) throw error;

      toast.success('Client modifié avec succès');
      setShowEditModal(false);
      resetForm();
      setSelectedClient(null);
      // Recharger la liste
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setClients(data || []);
    } catch (error) {
      console.error('Erreur lors de la modification:', error);
      toast.error('Erreur lors de la modification du client');
    }
  };

  // Supprimer un client
  const handleDeleteClient = async () => {
    if (!selectedClient) return;

    try {
      const { error } = await supabase.from('clients').delete().eq('id', selectedClient.id);

      if (error) throw error;

      toast.success('Client supprimé avec succès');
      setShowDeleteModal(false);
      setSelectedClient(null);
      // Recharger la liste
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setClients(data || []);
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast.error('Erreur lors de la suppression du client');
    }
  };

  // Ouvrir modals
  const openViewModal = (client: any) => {
    setSelectedClient(client);
    setShowViewModal(true);
  };

  const openEditModal = (client: any) => {
    setSelectedClient(client);
    setFormData({
      name: client.name,
      contact_email: client.contact_email,
      contact_phone: client.contact_phone,
      societe: client.societe || '',
    });
    setShowEditModal(true);
  };

  const openDeleteModal = (client: any) => {
    setSelectedClient(client);
    setShowDeleteModal(true);
  };

  return (
    <div className="max-w-6xl mx-auto py-10 px-4 space-y-8">
      {/* Header visuel */}
      <div className="bg-white rounded-xl p-8 shadow-lg border border-gray-200">
        <div className="flex items-center space-x-4">
          <div className="p-4 rounded-xl bg-[#00B3A6]/10 border border-[#00B3A6]/20 flex items-center justify-center">
            <Users className="h-10 w-10 text-[#00B3A6]" />
          </div>
          <div>
            <h1 className="text-3xl font-bold mb-2 text-gray-900">Mes clients</h1>
            <p className="text-lg text-gray-600">Gérez facilement vos clients et contacts</p>
          </div>
        </div>
      </div>

      {/* Cartes statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 flex flex-col items-center shadow-lg border border-gray-200">
          <Users className="h-8 w-8 text-[#00B3A6] mb-2" />
          <div className="text-2xl font-bold text-gray-900">{totalClients}</div>
          <div className="text-sm text-gray-500">Clients</div>
        </div>
        <div className="bg-green-50 rounded-xl p-6 flex flex-col items-center shadow-lg border border-green-200">
          <PlusCircle className="h-8 w-8 text-green-600 mb-2" />
          <div className="text-2xl font-bold text-green-700">{newThisMonth}</div>
          <div className="text-sm text-green-700">Nouveaux ce mois</div>
        </div>
      </div>

      {/* Barre de recherche + bouton ajout */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-4 gap-2">
        <div className="relative w-full max-w-xs">
          <input
            type="text"
            placeholder="Rechercher un client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent transition-all text-gray-700 bg-white shadow"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center px-5 py-3 bg-[#00B3A6] text-white rounded-xl font-semibold shadow hover:bg-[#00B3A6]/90 transition-all"
        >
          <PlusCircle className="h-5 w-5 mr-2" /> Ajouter un client
        </button>
      </div>

      {/* Tableau moderne */}
      <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin h-8 w-8 text-[#00B3A6]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-gray-500">
            <Users className="h-12 w-12 mb-4 text-gray-300" />
            <div>Aucun client trouvé.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[120px]">
                    Nom
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[180px]">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[130px]">
                    Téléphone
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[140px]">
                    Société
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[110px]">
                    Date d'ajout
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[160px]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filtered.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap min-w-[120px]">
                      <span className="inline-flex items-center gap-2">
                        <User className="h-4 w-4 text-[#00B3A6]" />{' '}
                        <span className="truncate max-w-[120px]">{client.name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap min-w-[180px]">
                      <span className="inline-flex items-center gap-2">
                        <Mail className="h-4 w-4 text-gray-400" />{' '}
                        <span className="truncate max-w-[150px]">{client.contact_email}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap min-w-[130px]">
                      <span className="inline-flex items-center gap-2">
                        <Phone className="h-4 w-4 text-gray-400" />{' '}
                        <span className="truncate max-w-[100px]">{client.contact_phone}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap min-w-[140px]">
                      <span className="inline-flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-gray-400" />{' '}
                        <span className="truncate max-w-[110px]">{client.societe}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap min-w-[110px] text-gray-900">
                      {new Date(client.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap min-w-[160px]">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => openViewModal(client)}
                          className="p-2 rounded-full bg-[#00B3A6] text-white shadow hover:bg-[#00B3A6]/90 transition-all"
                          title="Voir"
                        >
                          <Eye className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => openEditModal(client)}
                          className="p-2 rounded-full bg-gray-200 text-gray-600 shadow hover:bg-gray-300 transition-all"
                          title="Éditer"
                        >
                          <Pencil className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => openDeleteModal(client)}
                          className="p-2 rounded-full bg-red-100 text-red-600 shadow hover:bg-red-200 transition-all"
                          title="Supprimer"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Ajouter Client */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Ajouter un client</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <form onSubmit={handleAddClient} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nom complet</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6] transition-all text-gray-900"
                  placeholder="Nom du client"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  name="contact_email"
                  value={formData.contact_email}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6] transition-all text-gray-900"
                  placeholder="email@exemple.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Téléphone</label>
                <input
                  type="tel"
                  name="contact_phone"
                  value={formData.contact_phone}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6] transition-all text-gray-900"
                  placeholder="+216 XX XXX XXX"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Société (optionnel)
                </label>
                <input
                  type="text"
                  name="societe"
                  value={formData.societe}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6] transition-all text-gray-900"
                  placeholder="Nom de la société"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    resetForm();
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-[#00B3A6] text-white rounded-xl hover:bg-[#00B3A6]/90 transition-all flex items-center space-x-2"
                >
                  <Save className="h-4 w-4" />
                  <span>Ajouter</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Voir Client */}
      {showViewModal && selectedClient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Détails du client</h2>
              <button
                onClick={() => setShowViewModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center space-x-3">
                <User className="h-5 w-5 text-[#00B3A6]" />
                <div>
                  <p className="text-sm text-gray-600">Nom complet</p>
                  <p className="font-semibold text-gray-900">{selectedClient.name}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <Mail className="h-5 w-5 text-[#00B3A6]" />
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="font-semibold text-gray-900">{selectedClient.contact_email}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <Phone className="h-5 w-5 text-[#00B3A6]" />
                <div>
                  <p className="text-sm text-gray-600">Téléphone</p>
                  <p className="font-semibold text-gray-900">{selectedClient.contact_phone}</p>
                </div>
              </div>
              {selectedClient.societe && (
                <div className="flex items-center space-x-3">
                  <Building2 className="h-5 w-5 text-[#00B3A6]" />
                  <div>
                    <p className="text-sm text-gray-600">Société</p>
                    <p className="font-semibold text-gray-900">{selectedClient.societe}</p>
                  </div>
                </div>
              )}
              <div className="pt-4 border-t">
                <p className="text-sm text-gray-600">Date d'ajout</p>
                <p className="font-semibold text-gray-900">
                  {new Date(selectedClient.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Modifier Client */}
      {showEditModal && selectedClient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Modifier le client</h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedClient(null);
                  resetForm();
                }}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <form onSubmit={handleEditClient} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nom complet</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6] transition-all text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  name="contact_email"
                  value={formData.contact_email}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6] transition-all text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Téléphone</label>
                <input
                  type="tel"
                  name="contact_phone"
                  value={formData.contact_phone}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6] transition-all text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Société (optionnel)
                </label>
                <input
                  type="text"
                  name="societe"
                  value={formData.societe}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6] transition-all text-gray-900"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setSelectedClient(null);
                    resetForm();
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-[#00B3A6] text-white rounded-xl hover:bg-[#00B3A6]/90 transition-all flex items-center space-x-2"
                >
                  <Save className="h-4 w-4" />
                  <span>Modifier</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Supprimer Client */}
      {showDeleteModal && selectedClient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Supprimer le client</h2>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setSelectedClient(null);
                }}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-600 mb-6">
                Êtes-vous sûr de vouloir supprimer le client <strong>{selectedClient.name}</strong>{' '}
                ? Cette action est irréversible.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSelectedClient(null);
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={handleDeleteClient}
                  className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all flex items-center space-x-2"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Supprimer</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
