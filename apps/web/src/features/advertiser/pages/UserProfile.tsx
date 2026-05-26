import {
  Eye,
  EyeOff,
  FileText,
  Building2,
  MapPin,
  Bell,
  Upload,
  User,
  Lock,
  Trash2,
  Check,
  Info,
} from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate, useLocation } from 'react-router-dom';

import {
  AGENCY_BUSINESS_SECTOR_NAME,
  sectorsForAdvertiserProfile,
} from '@/features/advertiser/constants/advertiserBusinessSectors';
import { useProfileMutations } from '@/features/advertiser/hooks/useProfileMutations';
import { useUserProfile } from '@/features/advertiser/hooks/useUserProfile';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { useSectors } from '@/features/auth/hooks/useSectors';
import { authService } from '@/features/auth/services/auth.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type TabId = 'responsable' | 'entreprise' | 'notifications' | 'confidentialite';
type EntrepriseSubId = 'informations' | 'adresse' | 'documents';

const TABS: { id: TabId; label: string }[] = [
  { id: 'responsable', label: 'Responsable' },
  { id: 'entreprise', label: 'Entreprise' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'confidentialite', label: 'Confidentialité et sécurité' },
];

const RESPONSABLE_SUB = [
  {
    id: 'informations' as const,
    label: 'Informations sur le responsable',
    icon: <User className="h-5 w-5" />,
  },
];

const ENTREPRISE_SUB: { id: EntrepriseSubId; label: string; icon: React.ReactNode }[] = [
  {
    id: 'informations',
    label: "Informations sur l'entreprise",
    icon: <Building2 className="h-5 w-5" />,
  },
  { id: 'adresse', label: "Adresse de l'entreprise", icon: <MapPin className="h-5 w-5" /> },
  { id: 'documents', label: 'Documents légaux', icon: <FileText className="h-5 w-5" /> },
];

const NOTIFICATIONS_SUB = [
  { id: 'preferences' as const, label: 'Préférences', icon: <Bell className="h-5 w-5" /> },
];

type ConfidentialiteSubId = 'password' | 'delete';
const CONFIDENTIALITE_SUB: { id: ConfidentialiteSubId; label: string; icon: React.ReactNode }[] = [
  { id: 'password', label: 'Modifier le mot de passe', icon: <Lock className="h-5 w-5" /> },
  { id: 'delete', label: 'Supprimer le compte', icon: <Trash2 className="h-5 w-5" /> },
];

export default function UserProfile() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<TabId>('responsable');
  const [entrepriseSub, setEntrepriseSub] = useState<EntrepriseSubId>('informations');
  const [confidentialiteSub, setConfidentialiteSub] = useState<ConfidentialiteSubId>('password');
  const [showPassword, setShowPassword] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const [responsableForm, setResponsableForm] = useState({
    last_name: '',
    first_name: '',
    fonction: '',
    contact_phone: '',
  });
  const [entrepriseForm, setEntrepriseForm] = useState({
    business_name: '',
    tax_number: '',
    business_sector_id: '',
    company_size: '',
  });
  const [adresseForm, setAdresseForm] = useState({
    street_address: '',
    city: '',
    postal_code: '',
    governorate_id: '',
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [notificationsForm, setNotificationsForm] = useState({
    notify_news_updates: false,
    notify_reminders_events: true,
    notify_promotions_offers: false,
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);

  const user = useAuthStore((s) => s.user);
  const { profile, loading } = useUserProfile(user?.id);
  const { data: sectors = [] } = useSectors();
  const { data: governorates = [] } = useGovernorates();
  const {
    updateContact,
    updateBusiness,
    updateAddress,
    updateNotifications,
    updateProfile,
    uploadLogo,
    uploadDocument,
  } = useProfileMutations(user?.id);
  const isAgencyProfile = profile?.profile_type === 'agency';

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    const subParam = params.get('sub');

    if (
      tabParam === 'responsable' ||
      tabParam === 'entreprise' ||
      tabParam === 'notifications' ||
      tabParam === 'confidentialite'
    ) {
      setActiveTab(tabParam);
    }

    if (
      tabParam === 'entreprise' &&
      (subParam === 'informations' || subParam === 'adresse' || subParam === 'documents')
    ) {
      setEntrepriseSub(subParam);
    }
  }, [location.search]);

  useEffect(() => {
    if (profile) {
      const full = (profile.contact_name ?? '').trim();
      const space = full.indexOf(' ');
      const last_name = space <= 0 ? full : full.slice(0, space);
      const first_name = space <= 0 ? '' : full.slice(space + 1).trim();
      setResponsableForm({
        last_name,
        first_name,
        fonction: profile.fonction ?? '',
        contact_phone: profile.contact_phone ?? '',
      });
      setEntrepriseForm({
        business_name: profile.business_name ?? '',
        tax_number: profile.tax_number ?? '',
        business_sector_id: profile.business_sector_id ?? '',
        number_of_screens: profile.number_of_screens ?? '',
        number_of_rooms: profile.number_of_rooms ?? '',
      });
      setAdresseForm({
        street_address: profile.street_address ?? '',
        city: profile.city ?? '',
        postal_code: profile.postal_code ?? '',
        governorate_id: profile.governorate_id ?? '',
      });
      if (profile.logo_url) setLogoPreview(profile.logo_url);
      setNotificationsForm({
        notify_news_updates: profile.notify_news_updates ?? false,
        notify_reminders_events: profile.notify_reminders_events ?? true,
        notify_promotions_offers: profile.notify_promotions_offers ?? false,
      });
    }
  }, [profile]);

  useEffect(() => {
    if (!isAgencyProfile) return;
    const agencySector = sectors.find(
      (s) => s.name.trim().toLowerCase() === AGENCY_BUSINESS_SECTOR_NAME.toLowerCase(),
    );
    if (!agencySector) return;
    setEntrepriseForm((p) =>
      p.business_sector_id ? p : { ...p, business_sector_id: agencySector.id },
    );
  }, [isAgencyProfile, sectors]);

  const handleSaveResponsable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responsableForm.last_name.trim() || !responsableForm.contact_phone.trim()) {
      toast.error('Nom et téléphone sont obligatoires');
      return;
    }
    try {
      const contact_name =
        [responsableForm.last_name, responsableForm.first_name].filter(Boolean).join(' ').trim() ||
        responsableForm.last_name ||
        responsableForm.first_name;
      await updateContact.mutateAsync({
        contact_name,
        contact_phone: responsableForm.contact_phone,
        fonction: responsableForm.fonction || null,
      });
      toast.success('Informations enregistrées');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la mise à jour');
    }
  };

  const handleSaveEntreprise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entrepriseForm.business_name.trim() || !entrepriseForm.tax_number.trim()) {
      toast.error("Nom de l'entreprise et matricule fiscal sont obligatoires");
      return;
    }
    try {
      await updateBusiness.mutateAsync({
        business_name: entrepriseForm.business_name,
        tax_number: entrepriseForm.tax_number,
        // undefined (not null) when empty: JSON.stringify omits it → the uuid optional is left
        // unchanged rather than 400'd (null fails z.uuid()). See F4a plan §2.B.
        business_sector_id: entrepriseForm.business_sector_id || undefined,
        company_size: entrepriseForm.company_size || undefined,
      });
      toast.success('Informations entreprise enregistrées');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la mise à jour');
    }
  };

  const handleSaveAdresse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !adresseForm.street_address.trim() ||
      !adresseForm.city.trim() ||
      !adresseForm.postal_code.trim() ||
      !adresseForm.governorate_id
    ) {
      toast.error('Adresse, ville, code postal et gouvernorat sont obligatoires');
      return;
    }
    try {
      await updateAddress.mutateAsync({
        street_address: adresseForm.street_address,
        city: adresseForm.city,
        postal_code: adresseForm.postal_code,
        governorate_id: adresseForm.governorate_id || undefined,
      });
      toast.success('Adresse enregistrée');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la mise à jour');
    }
  };

  const handleSaveNotifications = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateNotifications.mutateAsync({
        notify_news_updates: notificationsForm.notify_news_updates,
        notify_reminders_events: notificationsForm.notify_reminders_events,
        notify_promotions_offers: notificationsForm.notify_promotions_offers,
      });
      toast.success('Préférences enregistrées');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la mise à jour');
    }
  };

  const passwordRequirements = {
    uppercase: /[A-Z]/.test(passwordData.newPassword),
    digit: /\d/.test(passwordData.newPassword),
    minLength: passwordData.newPassword.length >= 8,
  };
  const passwordValid =
    passwordRequirements.uppercase && passwordRequirements.digit && passwordRequirements.minLength;

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }
    if (!passwordValid) {
      toast.error('Le mot de passe ne respecte pas tous les critères');
      return;
    }
    try {
      await authService.updatePasswordWithOld(
        passwordData.currentPassword,
        passwordData.newPassword,
      );
      toast.success('Mot de passe mis à jour');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la mise à jour du mot de passe');
    }
  };

  const handleDeactivateAccount = async () => {
    if (!deleteConfirmPassword.trim()) {
      toast.error('Veuillez saisir votre mot de passe pour confirmer.');
      return;
    }
    if (!user?.email) {
      toast.error('Session invalide');
      return;
    }
    setDeactivating(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: deleteConfirmPassword,
      });
      if (signInError) {
        toast.error('Mot de passe incorrect');
        setDeactivating(false);
        return;
      }
      await authService.deactivateAccount();
      toast.success('Compte désactivé');
      navigate('/login');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la désactivation');
    } finally {
      setDeactivating(false);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(f.type)) {
      toast.error('Format accepté : PNG ou JPEG');
      return;
    }
    setLogoFile(f);
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const handleLogoUpload = async () => {
    if (!logoFile || !user) return;
    setUploadingLogo(true);
    try {
      await uploadLogo.mutateAsync(logoFile);
      setLogoFile(null);
      toast.success('Logo mis à jour');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleLogoRemove = async () => {
    try {
      await updateProfile.mutateAsync({ logo_url: null });
      setLogoPreview(null);
      setLogoFile(null);
      toast.success('Logo supprimé');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleUploadDocument = async () => {
    if (!documentFile || !user) {
      toast.error('Veuillez sélectionner un fichier');
      return;
    }
    setUploadingDocument(true);
    try {
      await uploadDocument.mutateAsync(documentFile);
      setDocumentFile(null);
      toast.success('Document enregistré');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur upload');
    } finally {
      setUploadingDocument(false);
    }
  };

  const handleRemoveDocument = async () => {
    try {
      await updateProfile.mutateAsync({
        registration_doc_url: null,
        registration_doc_path: null,
      });
      setDocumentFile(null);
      toast.success('Document supprimé');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur');
    }
  };

  const openDocumentForView = async () => {
    if (documentFile) {
      const url = URL.createObjectURL(documentFile);
      window.open(url, '_blank', 'noopener,noreferrer');
      URL.revokeObjectURL(url);
      return;
    }
    if (profile.registration_doc_path) {
      try {
        const { data: signed, error } = await supabase.storage
          .from('registres')
          .createSignedUrl(profile.registration_doc_path, 3600);
        if (error || !signed?.signedUrl) throw error;
        window.open(signed.signedUrl, '_blank', 'noopener,noreferrer');
      } catch (err) {
        toast.error(getErrorMessage(err) || "Impossible d'ouvrir le document");
      }
      return;
    }
    if (profile.registration_doc_url) {
      window.open(profile.registration_doc_url, '_blank', 'noopener,noreferrer');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-brand-primary border-t-transparent mx-auto" />
      </div>
    );
  }

  if (!profile) {
    return <div className="max-w-4xl mx-auto p-8 text-center text-gray-600">Profil non trouvé</div>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Onglets principaux */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-8" aria-label="Paramètres">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`pb-4 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'text-gray-900 border-brand-primary'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Contenu par onglet — même structure sidebar + contenu pour Responsable, Entreprise, Notifications */}
      {activeTab === 'responsable' && (
        <div className="flex gap-6 flex-col lg:flex-row lg:items-stretch">
          {/* Sidebar Paramètres du profil — même design que Entreprise / Notifications */}
          <aside className="lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 p-4 lg:min-h-0">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
              Paramètres du profil
            </p>
            <nav className="space-y-1">
              {RESPONSABLE_SUB.map((sub) => (
                <div
                  key={sub.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left bg-[#E6F7ED] text-[#132B1B]"
                >
                  <span className="text-[#132B1B]">{sub.icon}</span>
                  {sub.label}
                </div>
              ))}
            </nav>
          </aside>

          <div className="flex-1 min-w-0 bg-white overflow-hidden">
            <form onSubmit={handleSaveResponsable} className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="last-name"
                  >
                    Nom <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={responsableForm.last_name}
                    onChange={(e) =>
                      setResponsableForm((p) => ({ ...p, last_name: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                    placeholder="Nom"
                    id="last-name"
                  />
                </div>
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="first-name"
                  >
                    Prénom <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={responsableForm.first_name}
                    onChange={(e) =>
                      setResponsableForm((p) => ({ ...p, first_name: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                    placeholder="Prénom"
                    id="first-name"
                  />
                </div>
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="fonction"
                  >
                    Fonction <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={responsableForm.fonction}
                    onChange={(e) =>
                      setResponsableForm((p) => ({ ...p, fonction: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                    placeholder="Ex: UI UX Designer"
                    id="fonction"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
                    Email professionnel <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    readOnly
                    value={user?.email ?? ''}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-600 cursor-not-allowed"
                    placeholder="contact@entreprise.com"
                    id="email"
                  />
                </div>
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="contact-phone"
                  >
                    Téléphone <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={responsableForm.contact_phone}
                    onChange={(e) =>
                      setResponsableForm((p) => ({ ...p, contact_phone: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                    placeholder="+216 52 44 1144"
                    id="contact-phone"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-6 justify-end">
                <button
                  type="button"
                  className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl font-medium text-black hover:opacity-90"
                  style={{ background: '#76E6AB' }}
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'entreprise' && (
        <div className="flex gap-6 flex-col lg:flex-row lg:items-stretch">
          {/* Sidebar paramètres entreprise — même design que Responsable / Notifications */}
          <aside className="lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 p-4 lg:min-h-0">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
              Paramètres de l&apos;entreprise
            </p>
            <nav className="space-y-1">
              {ENTREPRISE_SUB.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setEntrepriseSub(sub.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${
                    entrepriseSub === sub.id
                      ? 'bg-[#E6F7ED] text-[#132B1B]'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className={entrepriseSub === sub.id ? 'text-[#132B1B]' : 'text-gray-400'}>
                    {sub.icon}
                  </span>
                  {sub.label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Contenu selon sous-onglet — pas de bordure ni titre pour Informations */}
          <div className="flex-1 min-w-0 bg-white overflow-hidden">
            {entrepriseSub === 'informations' && (
              <>
                <form onSubmit={handleSaveEntreprise} className="p-6 space-y-6">
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-1">Téléchargez votre logo</p>
                    <p className="text-xs text-gray-500 mb-3">Min 400x400px, PNG ou JPEG</p>
                    <div className="flex items-start gap-4">
                      <div className="w-24 h-24 rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {logoPreview ? (
                          <img
                            src={logoPreview}
                            alt="Logo"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <Building2 className="h-10 w-10 text-gray-300" />
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        {/* Logo upload disabled (Phase-1f D-F4-4): no backend logo storage yet —
                            the control is deferred to a later "logo storage" slice. */}
                        <div className="flex gap-2">
                          <label className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-400 cursor-not-allowed opacity-60">
                            Changer
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              disabled
                              onChange={handleLogoChange}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={handleLogoRemove}
                            disabled
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-400 bg-white cursor-not-allowed opacity-60"
                          >
                            Supprimer
                          </button>
                        </div>
                        <p className="text-xs text-gray-400">Bientôt disponible</p>
                        {logoFile && (
                          <button
                            type="button"
                            onClick={handleLogoUpload}
                            disabled={uploadingLogo}
                            className="self-start px-3 py-2 rounded-lg text-sm font-medium text-black disabled:opacity-50 hover:opacity-90"
                            style={{ background: '#76E6AB' }}
                          >
                            {uploadingLogo ? 'Envoi...' : 'Enregistrer le logo'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label
                        className="block text-sm font-medium text-gray-700 mb-1"
                        htmlFor="business-name"
                      >
                        Nom de l&apos;entreprise <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={entrepriseForm.business_name}
                        onChange={(e) =>
                          setEntrepriseForm((p) => ({ ...p, business_name: e.target.value }))
                        }
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                        placeholder="Raison sociale"
                        id="business-name"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-sm font-medium text-gray-700 mb-1"
                        htmlFor="tax-number"
                      >
                        Matricule fiscal <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={entrepriseForm.tax_number}
                        onChange={(e) =>
                          setEntrepriseForm((p) => ({ ...p, tax_number: e.target.value }))
                        }
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                        placeholder="Matricule fiscal"
                        id="tax-number"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label
                        className="block text-sm font-medium text-gray-700 mb-1"
                        htmlFor="profile-business-sector"
                      >
                        Secteur d&apos;activité <span className="text-red-500">*</span>
                      </label>
                      {isAgencyProfile ? (
                        <input
                          id="profile-business-sector"
                          type="text"
                          value="Agence de publicité"
                          readOnly
                          className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-gray-100 text-gray-700 cursor-not-allowed"
                        />
                      ) : (
                        <select
                          id="profile-business-sector"
                          value={entrepriseForm.business_sector_id}
                          onChange={(e) =>
                            setEntrepriseForm((p) => ({ ...p, business_sector_id: e.target.value }))
                          }
                          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary bg-white"
                        >
                          <option value="">Sélectionner</option>
                          {sectorsForAdvertiserProfile(
                            sectors,
                            entrepriseForm.business_sector_id,
                          ).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label
                        className="block text-sm font-medium text-gray-700 mb-1"
                        htmlFor="company-size"
                      >
                        Taille de l&apos;entreprise <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={entrepriseForm.company_size}
                        onChange={(e) =>
                          setEntrepriseForm((p) => ({ ...p, company_size: e.target.value }))
                        }
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary bg-white"
                        id="company-size"
                      >
                        <option value="">Sélectionner</option>
                        <option value="1-5">1-5</option>
                        <option value="6-10">6-10</option>
                        <option value="11-50">11-50</option>
                        <option value="51-200">51-200</option>
                        <option value="200+">200+</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-xl font-medium text-black hover:opacity-90"
                      style={{ background: '#76E6AB' }}
                    >
                      Enregistrer
                    </button>
                  </div>
                </form>
              </>
            )}

            {entrepriseSub === 'adresse' && (
              <form onSubmit={handleSaveAdresse} className="p-6 space-y-4 max-w-2xl">
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="street-address"
                  >
                    Adresse <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={adresseForm.street_address}
                    onChange={(e) =>
                      setAdresseForm((p) => ({ ...p, street_address: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                    placeholder="Ex: Barista's Ain Zaghouen"
                    id="street-address"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="city">
                      Ville <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        list="ville-list"
                        value={adresseForm.city}
                        onChange={(e) => setAdresseForm((p) => ({ ...p, city: e.target.value }))}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary pr-10"
                        placeholder="Ex: Tunis"
                        id="city"
                      />
                      <datalist id="ville-list">
                        {[
                          'Tunis',
                          'Sfax',
                          'Sousse',
                          'Nabeul',
                          'Bizerte',
                          'Gabès',
                          'Ariana',
                          'Ben Arous',
                          'Manouba',
                          'Médenine',
                          'Monastir',
                          'Kairouan',
                          'Zaghouan',
                        ].map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                        <svg
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div>
                    <label
                      className="block text-sm font-medium text-gray-700 mb-1"
                      htmlFor="postal-code"
                    >
                      Code postal <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={adresseForm.postal_code}
                      onChange={(e) =>
                        setAdresseForm((p) => ({ ...p, postal_code: e.target.value }))
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                      placeholder="Ex: 2045"
                      maxLength={10}
                      id="postal-code"
                    />
                  </div>
                </div>
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="governorate-id"
                  >
                    Gouvernorat <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={adresseForm.governorate_id}
                      onChange={(e) =>
                        setAdresseForm((p) => ({ ...p, governorate_id: e.target.value }))
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary bg-white appearance-none pr-10"
                      id="governorate-id"
                    >
                      <option value="">Sélectionner</option>
                      {governorates.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </span>
                  </div>
                </div>
                <div className="flex gap-3 pt-4 justify-end">
                  <button
                    type="button"
                    className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl font-medium text-black hover:opacity-90"
                    style={{ background: '#76E6AB' }}
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            )}

            {entrepriseSub === 'documents' && (
              <div className="p-6 space-y-6">
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center min-h-[200px] gap-3 bg-gray-50/50">
                  <div className="rounded-full p-3" style={{ background: '#E6F7ED' }}>
                    <Upload className="h-8 w-8" style={{ color: '#22c55e' }} />
                  </div>
                  <p className="text-base font-semibold text-gray-900">
                    Ajouter votre registre de commerce
                  </p>
                  <p className="text-sm text-gray-500">
                    Formats acceptés : PDF, JPG, JPEG, PNG (Max 5 MB)
                  </p>
                  <label className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 border border-gray-300 bg-white">
                    Parcourir les fichiers
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && setDocumentFile(e.target.files[0])}
                    />
                  </label>
                </div>

                {(profile.registration_doc_path ||
                  profile.registration_doc_url ||
                  documentFile) && (
                  <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                    <button
                      type="button"
                      onClick={openDocumentForView}
                      className="flex flex-1 items-center gap-4 min-w-0 text-left rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-shrink-0 rounded-lg p-2 bg-gray-100">
                        <FileText className="h-6 w-6 text-gray-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {documentFile ? documentFile.name : 'Registre de commerce'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {documentFile ? formatFileSize(documentFile.size) : 'Document enregistré'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Check className="h-5 w-5 text-green-600" />
                        <span className="text-sm text-gray-600">Completed</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (documentFile) {
                          setDocumentFile(null);
                        } else {
                          handleRemoveDocument();
                        }
                      }}
                      className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 flex-shrink-0"
                      title="Supprimer"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setDocumentFile(null)}
                    className="px-5 py-2.5 rounded-xl font-medium text-gray-700 border border-gray-300 bg-white hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleUploadDocument}
                    disabled={!documentFile || uploadingDocument}
                    className="px-5 py-2.5 rounded-xl font-medium text-black hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: '#76E6AB' }}
                  >
                    {uploadingDocument ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="flex gap-6 flex-col lg:flex-row lg:items-stretch">
          {/* Sidebar paramètres notifications — même design que Responsable / Entreprise */}
          <aside className="lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 p-4 lg:min-h-0">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
              Paramètres de notifications
            </p>
            <nav className="space-y-1">
              {NOTIFICATIONS_SUB.map((sub) => (
                <div
                  key={sub.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left bg-[#E6F7ED] text-[#132B1B]"
                >
                  <span className="text-[#132B1B]">{sub.icon}</span>
                  {sub.label}
                </div>
              ))}
            </nav>
          </aside>
          <div className="flex-1 min-w-0 bg-white overflow-hidden">
            <form onSubmit={handleSaveNotifications} className="p-6">
              <div className="space-y-6 max-w-2xl">
                {/* Actualités et mises à jour */}
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notificationsForm.notify_news_updates}
                    onClick={() =>
                      setNotificationsForm((p) => ({
                        ...p,
                        notify_news_updates: !p.notify_news_updates,
                      }))
                    }
                    className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-primary ${
                      notificationsForm.notify_news_updates ? 'bg-brand-primary' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 mt-0.5 rounded-full bg-white shadow transition-transform ${
                        notificationsForm.notify_news_updates
                          ? 'translate-x-5 ml-0.5'
                          : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Actualités et mises à jour</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Restez informé(e) des dernières actualités, mises à jour et annonces.
                    </p>
                  </div>
                </div>
                {/* Rappels et événements */}
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notificationsForm.notify_reminders_events}
                    onClick={() =>
                      setNotificationsForm((p) => ({
                        ...p,
                        notify_reminders_events: !p.notify_reminders_events,
                      }))
                    }
                    className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-primary ${
                      notificationsForm.notify_reminders_events ? 'bg-brand-primary' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 mt-0.5 rounded-full bg-white shadow transition-transform ${
                        notificationsForm.notify_reminders_events
                          ? 'translate-x-5 ml-0.5'
                          : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Rappels et événements</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Recevez des rappels pour vos événements, échéances et rendez-vous à venir.
                    </p>
                  </div>
                </div>
                {/* Promotions et offres */}
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notificationsForm.notify_promotions_offers}
                    onClick={() =>
                      setNotificationsForm((p) => ({
                        ...p,
                        notify_promotions_offers: !p.notify_promotions_offers,
                      }))
                    }
                    className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-primary ${
                      notificationsForm.notify_promotions_offers
                        ? 'bg-brand-primary'
                        : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 mt-0.5 rounded-full bg-white shadow transition-transform ${
                        notificationsForm.notify_promotions_offers
                          ? 'translate-x-5 ml-0.5'
                          : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Promotions et offres</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Recevez des notifications concernant les promotions spéciales, les réductions
                      et les offres exclusives.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-8 justify-end">
                <button
                  type="button"
                  onClick={() =>
                    profile &&
                    setNotificationsForm({
                      notify_news_updates: profile.notify_news_updates ?? false,
                      notify_reminders_events: profile.notify_reminders_events ?? true,
                      notify_promotions_offers: profile.notify_promotions_offers ?? false,
                    })
                  }
                  className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl font-medium text-black hover:opacity-90"
                  style={{ background: '#76E6AB' }}
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'confidentialite' && (
        <div className="flex gap-6 flex-col lg:flex-row lg:items-stretch">
          {/* Sidebar Paramètres de sécurité — même design que les autres onglets */}
          <aside className="lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 p-4 lg:min-h-0">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
              Paramètres de sécurité
            </p>
            <nav className="space-y-1">
              {CONFIDENTIALITE_SUB.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setConfidentialiteSub(sub.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${
                    confidentialiteSub === sub.id
                      ? sub.id === 'delete'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-[#E6F7ED] text-[#132B1B]'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span
                    className={
                      confidentialiteSub === sub.id
                        ? sub.id === 'delete'
                          ? 'text-red-600'
                          : 'text-[#132B1B]'
                        : 'text-gray-400'
                    }
                  >
                    {sub.icon}
                  </span>
                  {sub.label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="flex-1 min-w-0 bg-white overflow-hidden">
            {confidentialiteSub === 'password' && (
              <form onSubmit={handleUpdatePassword} className="p-6 max-w-xl space-y-4">
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="current-password"
                  >
                    Mot de passe actuel <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={passwordData.currentPassword}
                      onChange={(e) =>
                        setPasswordData((p) => ({ ...p, currentPassword: e.target.value }))
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary pr-10"
                      placeholder="Mot de passe actuel"
                      id="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="new-password"
                  >
                    Nouveau mot de passe <span className="text-red-500">*</span>
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={passwordData.newPassword}
                    onChange={(e) =>
                      setPasswordData((p) => ({ ...p, newPassword: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                    placeholder="Nouveau mot de passe"
                    id="new-password"
                  />
                </div>
                <div>
                  <label
                    className="block text-sm font-medium text-gray-700 mb-1"
                    htmlFor="confirm-password"
                  >
                    Confirmer le nouveau mot de passe <span className="text-red-500">*</span>
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={passwordData.confirmPassword}
                    onChange={(e) =>
                      setPasswordData((p) => ({ ...p, confirmPassword: e.target.value }))
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                    placeholder="Confirmer le nouveau mot de passe"
                    id="confirm-password"
                  />
                </div>
                <div className="pt-2">
                  <p className="text-xs font-medium text-gray-700 mb-2">Doit contenir au moins</p>
                  <ul className="space-y-1.5 text-sm text-gray-600">
                    <li className="flex items-center gap-2">
                      <span
                        className={
                          passwordRequirements.uppercase ? 'text-brand-primary' : 'text-gray-300'
                        }
                      >
                        <Check className="h-4 w-4" strokeWidth={2.5} />
                      </span>
                      Au moins une majuscule
                    </li>
                    <li className="flex items-center gap-2">
                      <span
                        className={
                          passwordRequirements.digit ? 'text-brand-primary' : 'text-gray-300'
                        }
                      >
                        <Check className="h-4 w-4" strokeWidth={2.5} />
                      </span>
                      Au moins un chiffre
                    </li>
                    <li className="flex items-center gap-2">
                      <span
                        className={
                          passwordRequirements.minLength ? 'text-brand-primary' : 'text-gray-300'
                        }
                      >
                        <Check className="h-4 w-4" strokeWidth={2.5} />
                      </span>
                      Minimum 8 caractères
                    </li>
                  </ul>
                </div>
                <div className="flex gap-3 pt-4 justify-end">
                  <button
                    type="button"
                    className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl font-medium text-black hover:opacity-90"
                    style={{ background: '#76E6AB' }}
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            )}

            {confidentialiteSub === 'delete' && (
              <div className="p-6 max-w-xl space-y-5">
                <div className="flex items-start gap-3 p-4 rounded-xl border border-red-200 bg-red-50">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                    <Info className="h-4 w-4 text-white" />
                  </div>
                  <p className="text-sm font-medium text-red-800">Cette action est irréversible.</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-gray-700">
                    Toutes vos données, y compris votre profil, vos publications et vos informations
                    personnelles, seront définitivement supprimées.
                  </p>
                  <p className="text-sm text-gray-700">
                    En saisissant votre mot de passe, vous confirmez avoir compris et accepté les
                    conséquences de la suppression de votre compte.
                  </p>
                </div>
                <div>
                  <label
                    className="block text-sm font-medium text-gray-900 mb-1.5"
                    htmlFor="delete-confirm-password"
                  >
                    Confirmer la suppression *
                  </label>
                  <div className="relative">
                    <input
                      type={showDeletePassword ? 'text' : 'password'}
                      value={deleteConfirmPassword}
                      onChange={(e) => setDeleteConfirmPassword(e.target.value)}
                      className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-gray-900 placeholder-gray-400"
                      placeholder="••••••••"
                      id="delete-confirm-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDeletePassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                      aria-label={
                        showDeletePassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
                      }
                    >
                      {showDeletePassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  <div className="flex items-start gap-2 mt-1.5">
                    <div className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-400 flex items-center justify-center mt-0.5">
                      <Info className="h-2.5 w-2.5 text-white" />
                    </div>
                    <p className="text-xs text-gray-500">
                      Veuillez saisir votre mot de passe pour procéder à la suppression de votre
                      compte.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmPassword('')}
                    className="px-5 py-2.5 rounded-xl font-medium text-gray-700 border border-gray-300 bg-white hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleDeactivateAccount}
                    disabled={deactivating || !deleteConfirmPassword.trim()}
                    className="px-5 py-2.5 rounded-xl font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                  >
                    {deactivating ? 'Désactivation...' : 'Désactiver le compte'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
