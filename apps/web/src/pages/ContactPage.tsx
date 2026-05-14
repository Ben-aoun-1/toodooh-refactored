import {
  MessageCircle,
  Mail,
  Phone,
  MapPin,
  Clock,
  Send,
  RefreshCw,
  Bell,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import OwnerNavigation from '../components/OwnerNavigation';
import { useAuthStore } from '../stores/auth.store';

interface ContactForm {
  name: string;
  email: string;
  subject: string;
  message: string;
  priority: 'low' | 'medium' | 'high';
}

export default function ContactPage() {
  const navigate = useNavigate();
  const { user, contactName } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [formData, setFormData] = useState<ContactForm>({
    name: '',
    email: '',
    subject: '',
    message: '',
    priority: 'medium',
  });

  useEffect(() => {
    const checkAuth = async () => {
      if (!user) {
        navigate('/login');
        return;
      }


      // Pré-remplir le formulaire avec les données utilisateur
      setFormData((prev) => ({
        ...prev,
        name: contactName || user.email || '',
        email: user.email || '',
      }));

      setLoading(false);
    };

    checkAuth();
  }, [user, navigate]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.email || !formData.subject || !formData.message) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }

    setSending(true);

    // Simulation d'envoi
    setTimeout(() => {
      setSending(false);
      toast.success(
        'Message envoyé avec succès ! Nous vous répondrons dans les plus brefs délais.',
      );
      setFormData({
        name: '',
        email: '',
        subject: '',
        message: '',
        priority: 'medium',
      });
    }, 2000);
  };

  const contactInfo = [
    {
      icon: Mail,
      title: 'Email',
      value: 'support@toodooh.tn',
      description: 'Réponse sous 24h',
    },
    {
      icon: Phone,
      title: 'Téléphone',
      value: '+216 71 234 567',
      description: 'Lun-Ven 9h-18h',
    },
    {
      icon: MapPin,
      title: 'Adresse',
      value: 'Tunis, Tunisie',
      description: 'Siège social',
    },
    {
      icon: Clock,
      title: 'Horaires',
      value: '9h - 18h',
      description: 'Lundi à Vendredi',
    },
  ];

  const faqItems = [
    {
      question: 'Comment ajouter un nouvel écran ?',
      answer:
        'Accédez à la section "Mes Écrans" et cliquez sur "Ajouter un Écran". Remplissez les informations requises et validez.',
    },
    {
      question: 'Comment déclarer une indisponibilité ?',
      answer:
        'Dans le tableau de bord, utilisez l\'action rapide "Déclarer Indisponibilité" ou accédez au calendrier d\'indisponibilités.',
    },
    {
      question: 'Comment consulter mes revenus ?',
      answer:
        'La section "Revenus" vous donne accès à toutes vos statistiques financières et graphiques de performance.',
    },
    {
      question: 'Comment échanger mes points fidélité ?',
      answer:
        'Accédez au "Catalogue Cadeaux" et choisissez parmi les récompenses disponibles selon vos points.',
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
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
                      <MessageCircle className="h-6 w-6 text-[#00B3A6] mr-2" />
                      Nous Contacter
                    </h1>
                    <p className="text-sm text-gray-600 mt-1">Support et assistance technique</p>
                  </div>
                  <span className="px-3 py-1 text-sm font-medium bg-[#00B3A6]/10 text-[#00B3A6] border border-[#00B3A6]/20 rounded-full">
                    Support 24/7
                  </span>
                </div>

                <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors relative text-gray-600">
                  <Bell className="h-6 w-6" />
                  <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    2
                  </span>
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Informations de contact */}
                <div className="lg:col-span-1">
                  <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
                      <MessageCircle className="h-5 w-5 text-[#00B3A6] mr-2" />
                      Informations de contact
                    </h2>

                    <div className="space-y-4">
                      {contactInfo.map((info, index) => {
                        const Icon = info.icon;
                        return (
                          <div key={index} className="flex items-start space-x-3">
                            <div className="p-2 bg-[#00B3A6]/10 rounded-lg">
                              <Icon className="h-5 w-5 text-[#00B3A6]" />
                            </div>
                            <div>
                              <h3 className="text-gray-900 font-medium">{info.title}</h3>
                              <p className="text-gray-600 text-sm">{info.value}</p>
                              <p className="text-gray-500 text-xs">{info.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* FAQ */}
                    <div className="mt-8 pt-6 border-t border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Questions fréquentes
                      </h3>
                      <div className="space-y-3">
                        {faqItems.map((item, index) => (
                          <div key={index} className="bg-gray-50 rounded-lg p-3">
                            <h4 className="text-gray-900 font-medium text-sm mb-1">
                              {item.question}
                            </h4>
                            <p className="text-gray-600 text-xs">{item.answer}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Formulaire de contact */}
                <div className="lg:col-span-2">
                  <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center">
                      <Send className="h-5 w-5 text-[#00B3A6] mr-2" />
                      Envoyer un message
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label
                            htmlFor="name"
                            className="block text-sm font-medium text-gray-700 mb-2"
                          >
                            Nom / Raison sociale *
                          </label>
                          <input
                            type="text"
                            id="name"
                            name="name"
                            value={formData.name}
                            onChange={handleInputChange}
                            className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6]"
                            placeholder="Votre nom ou raison sociale"
                            required
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="email"
                            className="block text-sm font-medium text-gray-700 mb-2"
                          >
                            Email *
                          </label>
                          <input
                            type="email"
                            id="email"
                            name="email"
                            value={formData.email}
                            onChange={handleInputChange}
                            className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6]"
                            placeholder="votre@email.com"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="subject"
                          className="block text-sm font-medium text-gray-700 mb-2"
                        >
                          Sujet *
                        </label>
                        <input
                          type="text"
                          id="subject"
                          name="subject"
                          value={formData.subject}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6]"
                          placeholder="Sujet de votre message"
                          required
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="priority"
                          className="block text-sm font-medium text-gray-700 mb-2"
                        >
                          Priorité
                        </label>
                        <select
                          id="priority"
                          name="priority"
                          value={formData.priority}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6]"
                        >
                          <option value="low">Basse</option>
                          <option value="medium">Moyenne</option>
                          <option value="high">Haute</option>
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="message"
                          className="block text-sm font-medium text-gray-700 mb-2"
                        >
                          Message *
                        </label>
                        <textarea
                          id="message"
                          name="message"
                          value={formData.message}
                          onChange={handleInputChange}
                          rows={6}
                          className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00B3A6] focus:border-[#00B3A6] resize-none"
                          placeholder="Décrivez votre demande en détail..."
                          required
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 text-gray-500 text-sm">
                          <CheckCircle className="h-4 w-4" />
                          <span>Champs obligatoires marqués *</span>
                        </div>

                        <button
                          type="submit"
                          disabled={sending}
                          className="flex items-center space-x-2 px-6 py-3 bg-[#00B3A6] text-white rounded-lg font-medium hover:bg-[#00B3A6]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {sending ? (
                            <>
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              <span>Envoi en cours...</span>
                            </>
                          ) : (
                            <>
                              <Send className="h-4 w-4" />
                              <span>Envoyer le message</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Statut du support */}
                  <div className="mt-6 bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                      <AlertCircle className="h-5 w-5 text-yellow-500 mr-2" />
                      Statut du support
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                        <div>
                          <p className="text-gray-900 font-medium">Support technique</p>
                          <p className="text-gray-600 text-sm">En ligne</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                        <div>
                          <p className="text-gray-900 font-medium">Support commercial</p>
                          <p className="text-gray-600 text-sm">En ligne</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse"></div>
                        <div>
                          <p className="text-gray-900 font-medium">Temps de réponse</p>
                          <p className="text-gray-600 text-sm">2-4 heures</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
