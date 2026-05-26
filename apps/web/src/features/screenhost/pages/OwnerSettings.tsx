/**
 * Paramètres propriétaire — même structure UX que la page profil annonceur (UserProfile),
 * contenu et champs adaptés aux propriétaires (local / parc).
 * Ne pas modifier UserProfile.tsx : ce fichier est autonome.
 */
import {
  Eye,
  EyeOff,
  FileText,
  Building2,
  MapPin,
  Wallet,
  Bell,
  Upload,
  User,
  Lock,
  Trash2,
  Check,
  Info,
} from 'lucide-react';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

import { useBusinessProfile } from '@/features/auth/hooks/useBusinessProfile';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { useOwnerBusinessSectors } from '@/features/auth/hooks/useOwnerBusinessSectors';
import { useOwnerProfileMutations } from '@/features/auth/hooks/useOwnerProfileMutations';
import { useSectors } from '@/features/auth/hooks/useSectors';
import { authService } from '@/features/auth/services/auth.service';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import type { BusinessProfile } from '@/features/auth/types/auth';
import { isValidPassword, passwordChecks } from '@/features/auth/utils/password';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import { useSaveBankDetails } from '@/features/wallet/hooks/useSaveBankDetails';
import { supabase } from '@/lib/supabase';

type TabId = 'responsable' | 'entreprise' | 'notifications' | 'confidentialite';
type EntrepriseSubId = 'informations' | 'adresse' | 'documents' | 'coordonnees-bancaires';

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
  {
    id: 'coordonnees-bancaires',
    label: 'Mes coordonnées bancaires',
    icon: <Wallet className="h-5 w-5" />,
  },
];

const NOTIFICATIONS_SUB = [
  { id: 'preferences' as const, label: 'Préférences', icon: <Bell className="h-5 w-5" /> },
];

type ConfidentialiteSubId = 'password' | 'delete';
const CONFIDENTIALITE_SUB: { id: ConfidentialiteSubId; label: string; icon: React.ReactNode }[] = [
  { id: 'password', label: 'Modifier le mot de passe', icon: <Lock className="h-5 w-5" /> },
  { id: 'delete', label: 'Supprimer le compte', icon: <Trash2 className="h-5 w-5" /> },
];

const SCREEN_COUNT_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '12+'];
const ROOM_COUNT_OPTIONS = Array.from({ length: 30 }, (_, i) => String(i + 1));
const PARC_SIZE_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '12+'];

export default function OwnerSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profileType, needsApproval, validationStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const isFleetOwner = profileType === 'fleet_owner';

  const { profile, loading } = useBusinessProfile(user?.id);
  const { data: sectors = [] } = useSectors();
  const { data: ownerSectors = [] } = useOwnerBusinessSectors();
  const { data: governorates = [] } = useGovernorates();
  const profileMutations = useOwnerProfileMutations(user?.id);
  const saveBankDetailsMutation = useSaveBankDetails();

  const [activeTab, setActiveTab] = useState<TabId>('responsable');
  const [entrepriseSub, setEntrepriseSub] = useState<EntrepriseSubId>('informations');
  const [confidentialiteSub, setConfidentialiteSub] = useState<ConfidentialiteSubId>('password');
  const [showPassword, setShowPassword] = useState(false);

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
    number_of_screens: '',
    number_of_rooms: '',
    company_size: '',
  });
  const [adresseForm, setAdresseForm] = useState({
    street_address: '',
    city: '',
    postal_code: '',
    governorate_id: '',
    zone: '',
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

  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [bankDocFile, setBankDocFile] = useState<File | null>(null);
  const [bankForm, setBankForm] = useState({
    bank_account_holder: '',
    bank_rib: '',
    bank_iban: '',
  });
  const [existingBankDocPath, setExistingBankDocPath] = useState<string | null>(null);
  const [existingBankDocUrl, setExistingBankDocUrl] = useState<string | null>(null);

  const isIndividualOwner = profileType === 'individual_owner';
  const ownerSectorOptions = useMemo(() => {
    const selectedId = entrepriseForm.business_sector_id;
    if (!selectedId || ownerSectors.some((s) => s.id === selectedId)) return ownerSectors;
    const legacy = sectors.find((s) => s.id === selectedId);
    return legacy ? [...ownerSectors, legacy] : ownerSectors;
  }, [ownerSectors, sectors, entrepriseForm.business_sector_id]);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

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
      subParam === 'informations' ||
      subParam === 'adresse' ||
      subParam === 'documents' ||
      subParam === 'coordonnees-bancaires'
    ) {
      setEntrepriseSub(subParam);
    }
  }, [location.search]);

  /**
   * Re-seeds the editable forms from a profile row. Driven by the
   * `useBusinessProfile` query on load + after every mutation (the mutations
   * invalidate `authKeys.profile`, so a fresh row flows back here), and called
   * directly by the "Annuler" buttons to revert unsaved edits.
   */
  const applyProfileToForms = useCallback((p: BusinessProfile) => {
    const full = (p.contact_name ?? '').trim();
    const space = full.indexOf(' ');
    const last_name = space <= 0 ? full : full.slice(0, space);
    const first_name = space <= 0 ? '' : full.slice(space + 1).trim();
    setResponsableForm({
      last_name,
      first_name,
      fonction: p.fonction ?? '',
      contact_phone: p.contact_phone ?? '',
    });
    setEntrepriseForm({
      business_name: p.business_name ?? '',
      tax_number: p.tax_number ?? '',
      business_sector_id: p.business_sector_id ?? '',
      number_of_screens:
        p.number_of_screens != null && p.number_of_screens !== undefined
          ? String(p.number_of_screens)
          : '',
      number_of_rooms:
        p.number_of_rooms != null && p.number_of_rooms !== undefined
          ? String(p.number_of_rooms)
          : '',
      company_size: p.company_size ?? '',
    });
    setAdresseForm({
      street_address: p.street_address ?? '',
      city: p.city ?? '',
      postal_code: p.postal_code ?? '',
      governorate_id: p.governorate_id ?? '',
      zone: p.zone ?? '',
    });
    setBankForm({
      bank_account_holder: p.bank_account_holder ?? '',
      bank_rib: p.bank_rib ?? '',
      bank_iban: p.bank_iban ?? '',
    });
    setExistingBankDocPath(p.bank_doc_path ?? null);
    setExistingBankDocUrl(p.bank_doc_url ?? null);
    setNotificationsForm({
      notify_news_updates: p.notify_news_updates ?? false,
      notify_reminders_events: p.notify_reminders_events ?? true,
      notify_promotions_offers: p.notify_promotions_offers ?? false,
    });
  }, []);

  useEffect(() => {
    if (profile) applyProfileToForms(profile);
  }, [profile, applyProfileToForms]);

  const handleSaveResponsable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responsableForm.last_name.trim() || !responsableForm.contact_phone.trim()) {
      toast.error('Nom et téléphone sont obligatoires');
      return;
    }
    try {
      const contact_name = [responsableForm.last_name, responsableForm.first_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      await profileMutations.updateContact.mutateAsync({
        contact_name,
        contact_phone: responsableForm.contact_phone,
        fonction: responsableForm.fonction || null,
      });
      toast.success('Informations enregistrées');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      toast.error(m);
    }
  };

  const parseScreenCount = (v: string) => {
    if (v === '12+') return 12;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  };

  const handleSaveEntreprise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entrepriseForm.business_name.trim() || !entrepriseForm.tax_number.trim()) {
      toast.error("Nom de l'entreprise et matricule fiscal sont obligatoires");
      return;
    }
    if (!entrepriseForm.business_sector_id) {
      toast.error('La catégorie est obligatoire');
      return;
    }
    // Phase-1f F4b §2: number_of_screens/rooms/company_size have NO backend column in slice 1
    // (owner-extras → owner slice). Requiring them would block saving the persisted fields with
    // data that then strips (a trap) — so they are no longer required here, and their inputs are
    // disabled (see the render). The wire still forwards them (empty → backend-stripped) for
    // forward-compat (the owner slice re-enables the inputs + adds columns; no wire change then).
    try {
      const ns = parseScreenCount(entrepriseForm.number_of_screens);
      const nr = parseInt(entrepriseForm.number_of_rooms, 10);
      await profileMutations.updateBusiness.mutateAsync({
        business_name: entrepriseForm.business_name,
        tax_number: entrepriseForm.tax_number,
        business_sector_id: entrepriseForm.business_sector_id,
        number_of_screens: ns,
        number_of_rooms: Number.isNaN(nr) ? null : nr,
        ...(isFleetOwner ? { company_size: entrepriseForm.company_size || null } : {}),
      });
      toast.success('Informations entreprise enregistrées');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      toast.error(m);
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
      await profileMutations.updateAddress.mutateAsync({
        street_address: adresseForm.street_address,
        city: adresseForm.city,
        postal_code: adresseForm.postal_code,
        // undefined (not null) when empty — JSON drops it → the uuid optional is left unchanged
        // rather than 400'd (null fails z.uuid()). zone is nullable → ||null clears it. (F4a §2.B.)
        governorate_id: adresseForm.governorate_id || undefined,
        zone: adresseForm.zone?.trim() || null,
      });
      toast.success('Adresse enregistrée');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      toast.error(m);
    }
  };

  const handleSaveNotifications = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await profileMutations.updateNotifications.mutateAsync({
        notify_news_updates: notificationsForm.notify_news_updates,
        notify_reminders_events: notificationsForm.notify_reminders_events,
        notify_promotions_offers: notificationsForm.notify_promotions_offers,
      });
      toast.success('Préférences enregistrées');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      toast.error(m);
    }
  };

  // Phase-1f F6 — converge to the shared 12-char policy (utils/password.ts = the backend's rule:
  // 12 + upper + lower + digit). Adds a lowercase requirement (the FE now accepts exactly what the
  // backend accepts — no FE-pass/BE-reject mismatch).
  const pwChecks = passwordChecks(passwordData.newPassword);
  const passwordRequirements = {
    uppercase: pwChecks.upper,
    lowercase: pwChecks.lower,
    digit: pwChecks.digit,
    minLength: pwChecks.minLen,
  };
  const passwordValid = isValidPassword(passwordData.newPassword);

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
      await profileMutations.updatePasswordWithOld.mutateAsync({
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });
      toast.success('Mot de passe mis à jour');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: unknown) {
      const m =
        err instanceof Error ? err.message : 'Erreur lors de la mise à jour du mot de passe';
      toast.error(m);
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
    if (documentFile.size > 5 * 1024 * 1024) {
      toast.error('Fichier trop volumineux (max 5 Mo)');
      return;
    }
    try {
      await profileMutations.uploadDocument.mutateAsync({
        file: documentFile,
        isIndividualOwner,
      });
      setDocumentFile(null);
      toast.success('Document enregistré');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Erreur upload';
      toast.error(m);
    }
  };

  const openDocumentForView = async () => {
    if (documentFile) {
      const url = URL.createObjectURL(documentFile);
      window.open(url, '_blank', 'noopener,noreferrer');
      URL.revokeObjectURL(url);
      return;
    }
    // Phase-1f F5 — presign the role's document (CIN for individual, RNE for fleet) on demand.
    try {
      const url = await authService.getProfileDocumentUrl(isIndividualOwner ? 'cin' : 'rne');
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else toast.error('Aucun document à afficher');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : "Impossible d'ouvrir le document";
      toast.error(m);
    }
  };

  const openBankDocumentForView = async () => {
    if (!profile) return;
    if (bankDocFile) {
      const url = URL.createObjectURL(bankDocFile);
      window.open(url, '_blank', 'noopener,noreferrer');
      URL.revokeObjectURL(url);
      return;
    }
    if (profile.bank_doc_path) {
      try {
        const { data: signed, error } = await supabase.storage
          .from('registres')
          .createSignedUrl(profile.bank_doc_path, 3600);
        if (error || !signed?.signedUrl) throw error;
        window.open(signed.signedUrl, '_blank', 'noopener,noreferrer');
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : "Impossible d'ouvrir le document bancaire";
        toast.error(m);
      }
      return;
    }
    if (profile.bank_doc_url) {
      window.open(profile.bank_doc_url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSaveBankDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const holder = bankForm.bank_account_holder.trim();
    const rib = bankForm.bank_rib.trim();
    const iban = bankForm.bank_iban.trim();
    if (!holder || !rib || !iban) {
      toast.error('Nom, RIB et IBAN sont obligatoires');
      return;
    }
    if (!bankDocFile && !existingBankDocPath && !existingBankDocUrl) {
      toast.error("Ajoutez le relevé d'identité bancaire");
      return;
    }

    if (bankDocFile && bankDocFile.size > 5 * 1024 * 1024) {
      toast.error('Fichier trop volumineux (max 5 Mo)');
      return;
    }

    try {
      await saveBankDetailsMutation.mutateAsync({
        userId: user.id,
        name: holder,
        rib,
        iban,
        bankDocFile,
        existingBankDocPath,
      });
      setBankDocFile(null);
      toast.success('Coordonnées bancaires enregistrées');
      navigate('/owner-dashboard');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Erreur lors de la mise à jour bancaire';
      toast.error(m);
    }
  };

  const hasDocument =
    !!documentFile ||
    (!!profile &&
      (isIndividualOwner ? !!profile.documents?.cin : !!profile.documents?.registration));
  const hasBankDocument = !!bankDocFile || !!profile?.bank_doc_path || !!profile?.bank_doc_url;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <OwnerNavigation isDisabled={isDisabled} />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-brand-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <OwnerNavigation isDisabled={isDisabled} />
        <div className="flex-1 p-8 text-center text-gray-600">Profil non trouvé</div>
      </div>
    );
  }

  const inputClass =
    'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary bg-white';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex min-h-screen">
        <OwnerNavigation isDisabled={isDisabled} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 shrink-0">
            <h1 className="text-xl font-bold text-gray-900">Paramètres</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Gérez les informations de votre compte propriétaire
            </p>
          </header>
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
            <div className="max-w-6xl mx-auto">
              <div className="border-b border-gray-200 mb-6">
                <nav className="flex gap-6 sm:gap-8 flex-wrap" aria-label="Paramètres">
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

              {activeTab === 'responsable' && (
                <div className="flex gap-6 flex-col lg:flex-row lg:items-stretch">
                  <aside className="lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 p-4">
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
                  <div className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                            className={inputClass}
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
                            className={inputClass}
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
                            className={inputClass}
                            placeholder="Ex: UI UX Designer"
                            id="fonction"
                          />
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-1"
                            htmlFor="email"
                          >
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
                        <div className="md:col-span-2">
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
                            className={inputClass}
                            placeholder="+216 52 44 1144"
                            id="contact-phone"
                          />
                        </div>
                      </div>
                      <div className="flex gap-3 pt-6 justify-end max-w-3xl">
                        <button
                          type="button"
                          onClick={() => {
                            if (profile) applyProfileToForms(profile);
                          }}
                          className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                        >
                          Annuler
                        </button>
                        <button
                          type="submit"
                          className="px-5 py-2.5 rounded-xl font-medium text-brand-deep hover:opacity-90"
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
                  <aside className="lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 p-4">
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
                          <span
                            className={
                              entrepriseSub === sub.id ? 'text-[#132B1B]' : 'text-gray-400'
                            }
                          >
                            {sub.icon}
                          </span>
                          {sub.label}
                        </button>
                      ))}
                    </nav>
                  </aside>

                  <div className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
                    {entrepriseSub === 'informations' && (
                      <form onSubmit={handleSaveEntreprise} className="p-6 space-y-6">
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-1">
                            Téléchargez votre logo
                          </p>
                          <p className="text-xs text-gray-500 mb-3">Min 400×400px, PNG or JPEG</p>
                          <div className="flex items-start gap-4">
                            <div className="w-24 h-24 rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                              <Building2 className="h-10 w-10 text-gray-300" />
                            </div>
                            <div className="flex flex-col gap-2">
                              {/* Phase-1f F7b — logo upload/remove disabled (D-F4-4): no backend
                                  logo storage yet; deferred to a later "logo storage" slice.
                                  Path severed (handlers + Supabase storage chain removed);
                                  static disabled markup + caption is the honest interim UX. */}
                              <div className="flex gap-2 flex-wrap">
                                <span className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-400 cursor-not-allowed opacity-60">
                                  Changer
                                </span>
                                <button
                                  type="button"
                                  disabled
                                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-400 bg-white cursor-not-allowed opacity-60"
                                >
                                  Supprimer
                                </button>
                              </div>
                              <p className="text-xs text-gray-400">Bientôt disponible</p>
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
                              className={inputClass}
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
                              className={inputClass}
                              placeholder="Matricule fiscal"
                              id="tax-number"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label
                              className="block text-sm font-medium text-gray-700 mb-1"
                              htmlFor="business-sector-id"
                            >
                              Catégorie <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={entrepriseForm.business_sector_id}
                              onChange={(e) =>
                                setEntrepriseForm((p) => ({
                                  ...p,
                                  business_sector_id: e.target.value,
                                }))
                              }
                              className={`${inputClass} appearance-none pr-10`}
                              id="business-sector-id"
                            >
                              <option value="">Sélectionner</option>
                              {ownerSectorOptions.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label
                              className="block text-sm font-medium text-gray-700 mb-1"
                              htmlFor="number-of-screens"
                            >
                              Nombre d&apos;écrans{' '}
                              <span className="text-xs text-gray-400">(bientôt disponible)</span>
                            </label>
                            <select
                              value={entrepriseForm.number_of_screens}
                              disabled
                              onChange={(e) =>
                                setEntrepriseForm((p) => ({
                                  ...p,
                                  number_of_screens: e.target.value,
                                }))
                              }
                              className={`${inputClass} appearance-none pr-10 opacity-60 cursor-not-allowed`}
                              id="number-of-screens"
                            >
                              <option value="">Sélectionner</option>
                              {SCREEN_COUNT_OPTIONS.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {isFleetOwner && (
                          <div>
                            <label
                              className="block text-sm font-medium text-gray-700 mb-1"
                              htmlFor="company-size"
                            >
                              Nombre d&apos;établissements du parc{' '}
                              <span className="text-xs text-gray-400">(bientôt disponible)</span>
                            </label>
                            <select
                              value={entrepriseForm.company_size}
                              disabled
                              onChange={(e) =>
                                setEntrepriseForm((p) => ({ ...p, company_size: e.target.value }))
                              }
                              className={`${inputClass} appearance-none pr-10 max-w-md opacity-60 cursor-not-allowed`}
                              id="company-size"
                            >
                              <option value="">Sélectionner</option>
                              {PARC_SIZE_OPTIONS.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-1"
                            htmlFor="number-of-rooms"
                          >
                            Nombre de salles{' '}
                            <span className="text-xs text-gray-400">(bientôt disponible)</span>
                          </label>
                          <select
                            value={entrepriseForm.number_of_rooms}
                            disabled
                            onChange={(e) =>
                              setEntrepriseForm((p) => ({ ...p, number_of_rooms: e.target.value }))
                            }
                            className={`${inputClass} appearance-none pr-10 max-w-full md:max-w-2xl opacity-60 cursor-not-allowed`}
                            id="number-of-rooms"
                          >
                            <option value="">Sélectionner</option>
                            {ROOM_COUNT_OPTIONS.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex gap-3 pt-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              if (profile) applyProfileToForms(profile);
                            }}
                            className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                          >
                            Annuler
                          </button>
                          <button
                            type="submit"
                            className="px-5 py-2.5 rounded-xl font-medium text-brand-deep hover:opacity-90"
                            style={{ background: '#76E6AB' }}
                          >
                            Enregistrer
                          </button>
                        </div>
                      </form>
                    )}

                    {entrepriseSub === 'adresse' && (
                      <form onSubmit={handleSaveAdresse} className="p-6 space-y-4 max-w-2xl">
                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-1"
                            htmlFor="street-address"
                          >
                            Adresse du siège <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={adresseForm.street_address}
                            onChange={(e) =>
                              setAdresseForm((p) => ({ ...p, street_address: e.target.value }))
                            }
                            className={inputClass}
                            placeholder="Adresse"
                            id="street-address"
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label
                              className="block text-sm font-medium text-gray-700 mb-1"
                              htmlFor="city"
                            >
                              Ville <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                              <input
                                type="text"
                                list="owner-ville-list"
                                value={adresseForm.city}
                                onChange={(e) =>
                                  setAdresseForm((p) => ({ ...p, city: e.target.value }))
                                }
                                className={`${inputClass} pr-10`}
                                placeholder="Ex: Tunis"
                                id="city"
                              />
                              <datalist id="owner-ville-list">
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
                              className={inputClass}
                              placeholder="Ex: 1000"
                              maxLength={10}
                              id="postal-code"
                            />
                          </div>
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-1"
                            htmlFor="zone"
                          >
                            Zone / secteur
                          </label>
                          <input
                            type="text"
                            value={adresseForm.zone}
                            onChange={(e) =>
                              setAdresseForm((p) => ({ ...p, zone: e.target.value }))
                            }
                            className={inputClass}
                            placeholder="Zone géographique ou secteur"
                            id="zone"
                          />
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
                              className={`${inputClass} appearance-none pr-10`}
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
                            onClick={() => {
                              if (profile) applyProfileToForms(profile);
                            }}
                            className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                          >
                            Annuler
                          </button>
                          <button
                            type="submit"
                            className="px-5 py-2.5 rounded-xl font-medium text-brand-deep hover:opacity-90"
                            style={{ background: '#76E6AB' }}
                          >
                            Enregistrer
                          </button>
                        </div>
                      </form>
                    )}

                    {entrepriseSub === 'documents' && (
                      <div className="p-6 space-y-6">
                        <p className="text-sm text-gray-600">
                          {isIndividualOwner
                            ? 'Téléchargez votre pièce d’identité (CIN) ou document équivalent.'
                            : 'Téléchargez le registre de commerce / patente de votre entreprise.'}
                        </p>
                        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center min-h-[200px] gap-3 bg-gray-50/50">
                          <div className="rounded-full p-3" style={{ background: '#E6F7ED' }}>
                            <Upload className="h-8 w-8" style={{ color: '#22c55e' }} />
                          </div>
                          <p className="text-base font-semibold text-gray-900 text-center">
                            {isIndividualOwner
                              ? 'Ajouter votre CIN ou pièce d’identité'
                              : 'Ajouter votre registre de commerce'}
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
                              onChange={(e) =>
                                e.target.files?.[0] && setDocumentFile(e.target.files[0])
                              }
                            />
                          </label>
                        </div>

                        {hasDocument && (
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
                                  {documentFile ? documentFile.name : 'Document enregistré'}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {documentFile
                                    ? formatFileSize(documentFile.size)
                                    : 'Fichier validé'}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Check className="h-5 w-5 text-green-600" />
                                <span className="text-sm text-gray-600">Enregistré</span>
                              </div>
                            </button>
                            {/* Phase-1f F7b — clears a freshly-picked local file; removing an
                                UPLOADED document is disabled (no DELETE endpoint — replace by
                                re-uploading). D-F5-3 defer wired: the dead else-branch is gone;
                                disabled gates this button when no local file is present. */}
                            <button
                              type="button"
                              disabled={!documentFile}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setDocumentFile(null);
                              }}
                              className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
                              title={
                                documentFile
                                  ? 'Retirer le fichier'
                                  : 'Suppression bientôt disponible'
                              }
                            >
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        )}

                        <div className="flex items-center gap-3 pt-2 flex-wrap">
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
                            disabled={!documentFile || profileMutations.uploadDocument.isPending}
                            className="px-5 py-2.5 rounded-xl font-medium text-gray-900 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ background: '#76E6AB' }}
                          >
                            {profileMutations.uploadDocument.isPending
                              ? 'Enregistrement...'
                              : 'Enregistrer'}
                          </button>
                        </div>
                      </div>
                    )}

                    {entrepriseSub === 'coordonnees-bancaires' && (
                      <form onSubmit={handleSaveBankDetails} className="p-6 space-y-5 max-w-3xl">
                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-1"
                            htmlFor="bank-account-holder"
                          >
                            Nom et prénom du titulaire <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={bankForm.bank_account_holder}
                            onChange={(e) =>
                              setBankForm((p) => ({ ...p, bank_account_holder: e.target.value }))
                            }
                            className={inputClass}
                            placeholder="Nom et prénom"
                            id="bank-account-holder"
                          />
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-1"
                            htmlFor="bank-rib"
                          >
                            RIB <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={bankForm.bank_rib}
                            onChange={(e) =>
                              setBankForm((p) => ({ ...p, bank_rib: e.target.value }))
                            }
                            className={inputClass}
                            placeholder="RIB"
                            id="bank-rib"
                          />
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-1"
                            htmlFor="bank-iban"
                          >
                            IBAN <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={bankForm.bank_iban}
                            onChange={(e) =>
                              setBankForm((p) => ({ ...p, bank_iban: e.target.value }))
                            }
                            className={inputClass}
                            placeholder="IBAN"
                            id="bank-iban"
                          />
                        </div>

                        <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-gray-50/50">
                          <p className="text-sm font-medium text-gray-800 text-center">
                            Ajouter le relevé d&apos;identité bancaire de votre établissement
                          </p>
                          <p className="text-xs text-gray-500">
                            Formats acceptés : PDF, JPG, JPEG, PNG (Max 5 MB)
                          </p>
                          <label className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100 border border-gray-300 bg-white">
                            Parcourir les fichiers
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              className="hidden"
                              onChange={(e) =>
                                e.target.files?.[0] && setBankDocFile(e.target.files[0])
                              }
                            />
                          </label>
                        </div>

                        {hasBankDocument && (
                          <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                            <button
                              type="button"
                              onClick={openBankDocumentForView}
                              className="flex flex-1 items-center gap-4 min-w-0 text-left rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex-shrink-0 rounded-lg p-2 bg-gray-100">
                                <FileText className="h-6 w-6 text-gray-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {bankDocFile ? bankDocFile.name : 'Document bancaire enregistré'}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {bankDocFile
                                    ? formatFileSize(bankDocFile.size)
                                    : 'Fichier validé'}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Check className="h-5 w-5 text-green-600" />
                                <span className="text-sm text-gray-600">Enregistré</span>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => setBankDocFile(null)}
                              className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 flex-shrink-0"
                              title="Retirer"
                            >
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        )}

                        <div className="flex gap-3 pt-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setBankDocFile(null);
                              setBankForm({
                                bank_account_holder: profile?.bank_account_holder ?? '',
                                bank_rib: profile?.bank_rib ?? '',
                                bank_iban: profile?.bank_iban ?? '',
                              });
                            }}
                            className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                          >
                            Annuler
                          </button>
                          <button
                            type="submit"
                            disabled={saveBankDetailsMutation.isPending}
                            className="px-5 py-2.5 rounded-xl font-medium text-gray-900 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{ background: '#76E6AB' }}
                          >
                            {saveBankDetailsMutation.isPending
                              ? 'Enregistrement...'
                              : 'Enregistrer'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'notifications' && (
                <div className="flex gap-6 flex-col lg:flex-row lg:items-stretch">
                  <aside className="lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 p-4">
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
                  <div className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <form onSubmit={handleSaveNotifications} className="p-6">
                      <div className="space-y-6 max-w-2xl">
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
                              notificationsForm.notify_news_updates
                                ? 'bg-brand-primary'
                                : 'bg-gray-200'
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
                            <p className="text-sm font-medium text-gray-900">
                              Actualités et mises à jour
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Restez informé(e) des dernières actualités, mises à jour et annonces.
                            </p>
                          </div>
                        </div>
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
                              notificationsForm.notify_reminders_events
                                ? 'bg-brand-primary'
                                : 'bg-gray-200'
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
                            <p className="text-sm font-medium text-gray-900">
                              Rappels et événements
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Recevez des rappels pour diffuser vos campagnes et vos événements.
                            </p>
                          </div>
                        </div>
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
                            <p className="text-sm font-medium text-gray-900">
                              Promotions et offres
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Recevez des notifications concernant les promotions spéciales, les
                              offres exclusives.
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
                          className="px-5 py-2.5 rounded-xl font-medium text-gray-900 hover:opacity-90"
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
                  <aside className="lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 p-4">
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

                  <div className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                              className={`${inputClass} pr-10`}
                              placeholder="Mot de passe actuel"
                              id="current-password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                              {showPassword ? (
                                <EyeOff className="h-5 w-5" />
                              ) : (
                                <Eye className="h-5 w-5" />
                              )}
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
                            className={inputClass}
                            placeholder="Nouveau mot de passe"
                            id="new-password"
                          />
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-1"
                            htmlFor="confirm-password"
                          >
                            Confirmer le nouveau mot de passe{' '}
                            <span className="text-red-500">*</span>
                          </label>
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={passwordData.confirmPassword}
                            onChange={(e) =>
                              setPasswordData((p) => ({ ...p, confirmPassword: e.target.value }))
                            }
                            className={inputClass}
                            placeholder="Confirmer le nouveau mot de passe"
                            id="confirm-password"
                          />
                        </div>
                        <div className="pt-2">
                          <p className="text-xs font-medium text-gray-700 mb-2">
                            Doit contenir au moins
                          </p>
                          <ul className="space-y-1.5 text-sm text-gray-600">
                            <li className="flex items-center gap-2">
                              <span
                                className={
                                  passwordRequirements.uppercase
                                    ? 'text-brand-primary'
                                    : 'text-gray-300'
                                }
                              >
                                <Check className="h-4 w-4" strokeWidth={2.5} />
                              </span>
                              Au moins une majuscule
                            </li>
                            <li className="flex items-center gap-2">
                              <span
                                className={
                                  passwordRequirements.lowercase
                                    ? 'text-brand-primary'
                                    : 'text-gray-300'
                                }
                              >
                                <Check className="h-4 w-4" strokeWidth={2.5} />
                              </span>
                              Au moins une minuscule
                            </li>
                            <li className="flex items-center gap-2">
                              <span
                                className={
                                  passwordRequirements.digit
                                    ? 'text-brand-primary'
                                    : 'text-gray-300'
                                }
                              >
                                <Check className="h-4 w-4" strokeWidth={2.5} />
                              </span>
                              Au moins un chiffre
                            </li>
                            <li className="flex items-center gap-2">
                              <span
                                className={
                                  passwordRequirements.minLength
                                    ? 'text-brand-primary'
                                    : 'text-gray-300'
                                }
                              >
                                <Check className="h-4 w-4" strokeWidth={2.5} />
                              </span>
                              Minimum 12 caractères
                            </li>
                          </ul>
                        </div>
                        <div className="flex gap-3 pt-4 justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              setPasswordData({
                                currentPassword: '',
                                newPassword: '',
                                confirmPassword: '',
                              })
                            }
                            className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                          >
                            Annuler
                          </button>
                          <button
                            type="submit"
                            className="px-5 py-2.5 rounded-xl font-medium text-brand-deep hover:opacity-90"
                            style={{ background: '#76E6AB' }}
                          >
                            Enregistrer
                          </button>
                        </div>
                      </form>
                    )}

                    {confidentialiteSub === 'delete' && (
                      <div className="p-6 max-w-xl space-y-4">
                        {/* Phase-1f F7b — D-F7-2 ruling: deactivation control disabled until the
                            backend /api/account/deactivate endpoint ships. Pre-K the form
                            re-auth-confirmed via supabase.auth.signInWithPassword before
                            destroying the account; post-K the Supabase auth store is no longer
                            the password source (users live in apps/api's users table), so the
                            re-auth was a broken no-op that rejected every password attempt — a
                            class-(b) security gap. The static message below is the honest
                            interim path while preserving the user's right to close their
                            account via the support team. */}
                        <div className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
                          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center">
                            <Info className="h-4 w-4 text-white" />
                          </div>
                          <p className="text-sm text-gray-700">
                            La désactivation de compte sera bientôt disponible. Pour fermer votre
                            compte, contactez le support à{' '}
                            <a
                              href="mailto:support@too-dooh.com"
                              className="font-medium text-brand-primary underline"
                            >
                              support@too-dooh.com
                            </a>
                            .
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
