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
import React, { useState, useEffect, type ReactNode } from 'react';
import { toast } from 'react-hot-toast';
import { useLocation } from 'react-router-dom';

import { isValidPassword, passwordChecks } from '@/features/auth/utils/password';
import { getErrorMessage } from '@/lib/errors';

type TabId = 'responsable' | 'entreprise' | 'notifications' | 'confidentialite';
type EntrepriseSubId = 'informations' | 'adresse' | 'documents' | 'coordonnees-bancaires';
type ConfidentialiteSubId = 'password' | 'delete';

/**
 * Normalized form values, pre-mapped from the role's profile read by the
 * wrapper (advertiser `useUserProfile`, owner `useBusinessProfile`) so this
 * component is decoupled from the two profile shapes.
 */
export interface ProfileFormInitialValues {
  last_name: string;
  first_name: string;
  fonction: string;
  contact_phone: string;
  business_name: string;
  tax_number: string;
  business_sector_id: string;
  company_size: string;
  number_of_screens: string;
  number_of_rooms: string;
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id: string;
  zone: string;
  notify_news_updates: boolean;
  notify_reminders_events: boolean;
  notify_promotions_offers: boolean;
}

interface ContactPatch {
  contact_name: string;
  contact_phone: string;
  fonction: string | null;
}
interface BusinessPatch {
  business_name: string;
  tax_number: string;
  business_sector_id?: string;
  company_size?: string;
}
interface AddressPatch {
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id?: string;
  zone?: string | null;
}
interface NotificationsPatch {
  notify_news_updates: boolean;
  notify_reminders_events: boolean;
  notify_promotions_offers: boolean;
}

interface ProfileSettingsProps {
  /** Drives owner-only field/slot rendering and (B4b) owner wiring. */
  variant: 'advertiser' | 'owner';
  loading: boolean;
  /** `false` → "Profil non trouvé". */
  profileLoaded: boolean;
  initialValues: ProfileFormInitialValues | null;
  userEmail: string | null | undefined;
  /** `profile.documents?.registration` — shows the saved-document card. */
  documentRegistered: boolean;
  governorates: { id: string; name: string }[];

  // Section saves — normalized callbacks (wrapper wires its own mutation/service).
  onSaveContact: (patch: ContactPatch) => Promise<void>;
  onSaveBusiness: (patch: BusinessPatch) => Promise<void>;
  onSaveAddress: (patch: AddressPatch) => Promise<void>;
  onSaveNotifications: (patch: NotificationsPatch) => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onUploadDocument: (file: File) => Promise<void>;
  getDocumentUrl: () => Promise<string | null>;

  // Entreprise config (injected, not derived).
  sector: {
    options: { id: string; name: string }[];
    required: boolean;
    label: string;
    /** When set, the sector is shown read-only with this value (advertiser agency case). */
    readOnlyValue?: string;
  };
  /** Max upload size in bytes; undefined → no client-side limit (advertiser). */
  documentMaxBytes?: number;
  /** Dashed-dropzone title (advertiser: registre; owner B4b: CIN/registre by type). */
  documentDropTitle: string;
  /** Saved-document card display name. */
  documentFileLabel: string;
  /** Which optional Entreprise fields render for this role. */
  fields: {
    companySize: boolean;
    numberOfScreens: boolean;
    numberOfRooms: boolean;
    zone: boolean;
  };
  copy: {
    remindersText: string;
    addressLabel: string;
  };
  /** Owner-only "Mes coordonnées bancaires" sub-tab content (B4b). */
  bankSlot?: ReactNode;
  bankSubLabel?: string;
}

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

const NOTIFICATIONS_SUB = [
  { id: 'preferences' as const, label: 'Préférences', icon: <Bell className="h-5 w-5" /> },
];

const CONFIDENTIALITE_SUB: { id: ConfidentialiteSubId; label: string; icon: React.ReactNode }[] = [
  { id: 'password', label: 'Modifier le mot de passe', icon: <Lock className="h-5 w-5" /> },
  { id: 'delete', label: 'Supprimer le compte', icon: <Trash2 className="h-5 w-5" /> },
];

const SAVE_BUTTON_CLASS = 'px-5 py-2.5 rounded-xl font-medium text-brand-deep hover:opacity-90';
const SAVE_BUTTON_STYLE = { background: '#76E6AB' } as const;
const FIELD_CLASS =
  'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary';

const CITIES = [
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
];

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Shared profile/settings tabbed content for the advertiser (`/profile`) and
 * screenhost (`/owner-settings`) pages. Renders the inner tabs only — layout
 * chrome (AdvertiserLayout / OwnerNavigation) stays in each wrapper.
 *
 * Inject-don't-derive (slice-2 B4): role behavior enters via props — section
 * saves, document/password callbacks, sector source/required/label, field
 * visibility, role copy, and an owner-only `bankSlot`. Cosmetics are
 * normalized to one canon (B4a ruling). Owner-only paths are typed and present
 * but unexercised until the owner wrapper is wired (B4b).
 */
export default function ProfileSettings({
  variant: _variant,
  loading,
  profileLoaded,
  initialValues,
  userEmail,
  documentRegistered,
  governorates,
  onSaveContact,
  onSaveBusiness,
  onSaveAddress,
  onSaveNotifications,
  onChangePassword,
  onUploadDocument,
  getDocumentUrl,
  sector,
  documentMaxBytes,
  documentDropTitle,
  documentFileLabel,
  fields,
  copy,
  bankSlot,
  bankSubLabel,
}: ProfileSettingsProps) {
  const location = useLocation();
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
    company_size: '',
    number_of_screens: '',
    number_of_rooms: '',
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
  const [uploadingDocument, setUploadingDocument] = useState(false);

  const entrepriseSubItems: { id: EntrepriseSubId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'informations',
      label: "Informations sur l'entreprise",
      icon: <Building2 className="h-5 w-5" />,
    },
    { id: 'adresse', label: "Adresse de l'entreprise", icon: <MapPin className="h-5 w-5" /> },
    { id: 'documents', label: 'Documents légaux', icon: <FileText className="h-5 w-5" /> },
    ...(bankSlot
      ? [
          {
            id: 'coordonnees-bancaires' as const,
            label: bankSubLabel ?? 'Mes coordonnées bancaires',
            icon: <FileText className="h-5 w-5" />,
          },
        ]
      : []),
  ];

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
    const v = initialValues;
    if (!v) return;
    setResponsableForm({
      last_name: v.last_name,
      first_name: v.first_name,
      fonction: v.fonction,
      contact_phone: v.contact_phone,
    });
    setEntrepriseForm({
      business_name: v.business_name,
      tax_number: v.tax_number,
      business_sector_id: v.business_sector_id,
      company_size: v.company_size,
      number_of_screens: v.number_of_screens,
      number_of_rooms: v.number_of_rooms,
    });
    setAdresseForm({
      street_address: v.street_address,
      city: v.city,
      postal_code: v.postal_code,
      governorate_id: v.governorate_id,
      zone: v.zone,
    });
    setNotificationsForm({
      notify_news_updates: v.notify_news_updates,
      notify_reminders_events: v.notify_reminders_events,
      notify_promotions_offers: v.notify_promotions_offers,
    });
  }, [initialValues]);

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
      await onSaveContact({
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
    if (sector.required && !entrepriseForm.business_sector_id) {
      toast.error('Le secteur d’activité est obligatoire');
      return;
    }
    try {
      await onSaveBusiness({
        business_name: entrepriseForm.business_name,
        tax_number: entrepriseForm.tax_number,
        // undefined (not null) when empty: JSON.stringify omits it → the uuid optional is left
        // unchanged rather than 400'd (null fails z.uuid()).
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
      const patch: AddressPatch = {
        street_address: adresseForm.street_address,
        city: adresseForm.city,
        postal_code: adresseForm.postal_code,
        governorate_id: adresseForm.governorate_id || undefined,
      };
      if (fields.zone) patch.zone = adresseForm.zone.trim() || null;
      await onSaveAddress(patch);
      toast.success('Adresse enregistrée');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la mise à jour');
    }
  };

  const handleSaveNotifications = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onSaveNotifications({
        notify_news_updates: notificationsForm.notify_news_updates,
        notify_reminders_events: notificationsForm.notify_reminders_events,
        notify_promotions_offers: notificationsForm.notify_promotions_offers,
      });
      toast.success('Préférences enregistrées');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la mise à jour');
    }
  };

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
      await onChangePassword(passwordData.currentPassword, passwordData.newPassword);
      toast.success('Mot de passe mis à jour');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Erreur lors de la mise à jour du mot de passe');
    }
  };

  const handleUploadDocument = async () => {
    if (!documentFile) {
      toast.error('Veuillez sélectionner un fichier');
      return;
    }
    if (documentMaxBytes && documentFile.size > documentMaxBytes) {
      toast.error('Le fichier dépasse la taille maximale autorisée (5 MB)');
      return;
    }
    setUploadingDocument(true);
    try {
      await onUploadDocument(documentFile);
      setDocumentFile(null);
      toast.success('Document enregistré');
    } catch (err) {
      // Clear the optimistic file so a failed upload leaves no false "saved" row; the
      // server-confirmed badge (documentRegistered) stays off until the refetch says otherwise.
      setDocumentFile(null);
      toast.error(getErrorMessage(err) || 'Erreur upload');
    } finally {
      setUploadingDocument(false);
    }
  };

  const openDocumentForView = async () => {
    if (documentFile) {
      const url = URL.createObjectURL(documentFile);
      window.open(url, '_blank', 'noopener,noreferrer');
      URL.revokeObjectURL(url);
      return;
    }
    try {
      const url = await getDocumentUrl();
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else toast.error('Aucun document à afficher');
    } catch (err) {
      toast.error(getErrorMessage(err) || "Impossible d'ouvrir le document");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-brand-primary border-t-transparent mx-auto" />
      </div>
    );
  }

  if (!profileLoaded) {
    return <div className="max-w-4xl mx-auto p-8 text-center text-gray-600">Profil non trouvé</div>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Onglets principaux */}
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
                    className={FIELD_CLASS}
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
                    className={FIELD_CLASS}
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
                    className={FIELD_CLASS}
                    placeholder="Ex: UI UX Designer"
                    id="fonction"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
                    Email professionnel <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    readOnly
                    value={userEmail ?? ''}
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
                    className={FIELD_CLASS}
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
                <button type="submit" className={SAVE_BUTTON_CLASS} style={SAVE_BUTTON_STYLE}>
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'entreprise' && (
        <div className="flex gap-6 flex-col lg:flex-row lg:items-stretch">
          <aside className="lg:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 p-4 lg:min-h-0">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
              Paramètres de l&apos;entreprise
            </p>
            <nav className="space-y-1">
              {entrepriseSubItems.map((sub) => (
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

          <div className="flex-1 min-w-0 bg-white overflow-hidden">
            {entrepriseSub === 'informations' && (
              <form onSubmit={handleSaveEntreprise} className="p-6 space-y-6">
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Téléchargez votre logo</p>
                  <p className="text-xs text-gray-500 mb-3">Min 400×400px, PNG ou JPEG</p>
                  <div className="flex items-start gap-4">
                    <div className="w-24 h-24 rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                      <Building2 className="h-10 w-10 text-gray-300" />
                    </div>
                    <div className="flex flex-col gap-2">
                      {/* Logo upload/remove disabled (no backend logo storage yet). */}
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
                      className={FIELD_CLASS}
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
                      className={FIELD_CLASS}
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
                      {sector.label} <span className="text-red-500">*</span>
                    </label>
                    {sector.readOnlyValue !== undefined ? (
                      <input
                        id="profile-business-sector"
                        type="text"
                        value={sector.readOnlyValue}
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
                        {sector.options.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {fields.companySize && (
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
                  )}
                  {fields.numberOfScreens && (
                    <div>
                      <label
                        className="block text-sm font-medium text-gray-700 mb-1"
                        htmlFor="number-of-screens"
                      >
                        Nombre d&apos;écrans (bientôt disponible)
                      </label>
                      <input
                        id="number-of-screens"
                        type="text"
                        value={entrepriseForm.number_of_screens}
                        disabled
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 cursor-not-allowed opacity-60"
                      />
                    </div>
                  )}
                  {fields.numberOfRooms && (
                    <div>
                      <label
                        className="block text-sm font-medium text-gray-700 mb-1"
                        htmlFor="number-of-rooms"
                      >
                        Nombre de salles (bientôt disponible)
                      </label>
                      <input
                        id="number-of-rooms"
                        type="text"
                        value={entrepriseForm.number_of_rooms}
                        disabled
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 cursor-not-allowed opacity-60"
                      />
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button type="submit" className={SAVE_BUTTON_CLASS} style={SAVE_BUTTON_STYLE}>
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
                    {copy.addressLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={adresseForm.street_address}
                    onChange={(e) =>
                      setAdresseForm((p) => ({ ...p, street_address: e.target.value }))
                    }
                    className={FIELD_CLASS}
                    placeholder="Adresse"
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
                        list="profile-ville-list"
                        value={adresseForm.city}
                        onChange={(e) => setAdresseForm((p) => ({ ...p, city: e.target.value }))}
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary focus:border-brand-primary pr-10"
                        placeholder="Ex: Tunis"
                        id="city"
                      />
                      <datalist id="profile-ville-list">
                        {CITIES.map((c) => (
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
                      className={FIELD_CLASS}
                      placeholder="Ex: 1000"
                      maxLength={10}
                      id="postal-code"
                    />
                  </div>
                </div>
                {fields.zone && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="zone">
                      Zone / secteur
                    </label>
                    <input
                      type="text"
                      value={adresseForm.zone}
                      onChange={(e) => setAdresseForm((p) => ({ ...p, zone: e.target.value }))}
                      className={FIELD_CLASS}
                      placeholder="Zone / secteur"
                      id="zone"
                    />
                  </div>
                )}
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
                  <button type="submit" className={SAVE_BUTTON_CLASS} style={SAVE_BUTTON_STYLE}>
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
                  <p className="text-base font-semibold text-gray-900">{documentDropTitle}</p>
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

                {(documentRegistered || documentFile) && (
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
                          {documentFile ? documentFile.name : documentFileLabel}
                        </p>
                        <p className="text-xs text-gray-500">
                          {documentFile ? formatFileSize(documentFile.size) : 'Document enregistré'}
                        </p>
                      </div>
                      {documentRegistered && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Check className="h-5 w-5 text-green-600" />
                          <span className="text-sm text-gray-600">Enregistré</span>
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={!documentFile}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDocumentFile(null);
                      }}
                      className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
                      title={documentFile ? 'Retirer le fichier' : 'Suppression bientôt disponible'}
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
                    className="px-5 py-2.5 rounded-xl font-medium text-brand-deep hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={SAVE_BUTTON_STYLE}
                  >
                    {uploadingDocument ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            )}

            {entrepriseSub === 'coordonnees-bancaires' && bankSlot}
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="flex gap-6 flex-col lg:flex-row lg:items-stretch">
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
                <NotificationToggle
                  checked={notificationsForm.notify_news_updates}
                  onToggle={() =>
                    setNotificationsForm((p) => ({
                      ...p,
                      notify_news_updates: !p.notify_news_updates,
                    }))
                  }
                  title="Actualités et mises à jour"
                  description="Restez informé(e) des dernières actualités, mises à jour et annonces."
                />
                <NotificationToggle
                  checked={notificationsForm.notify_reminders_events}
                  onToggle={() =>
                    setNotificationsForm((p) => ({
                      ...p,
                      notify_reminders_events: !p.notify_reminders_events,
                    }))
                  }
                  title="Rappels et événements"
                  description={copy.remindersText}
                />
                <NotificationToggle
                  checked={notificationsForm.notify_promotions_offers}
                  onToggle={() =>
                    setNotificationsForm((p) => ({
                      ...p,
                      notify_promotions_offers: !p.notify_promotions_offers,
                    }))
                  }
                  title="Promotions et offres"
                  description="Recevez des notifications concernant les promotions spéciales, les réductions et les offres exclusives."
                />
              </div>
              <div className="flex gap-3 pt-8 justify-end">
                <button
                  type="button"
                  onClick={() =>
                    initialValues &&
                    setNotificationsForm({
                      notify_news_updates: initialValues.notify_news_updates,
                      notify_reminders_events: initialValues.notify_reminders_events,
                      notify_promotions_offers: initialValues.notify_promotions_offers,
                    })
                  }
                  className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button type="submit" className={SAVE_BUTTON_CLASS} style={SAVE_BUTTON_STYLE}>
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'confidentialite' && (
        <div className="flex gap-6 flex-col lg:flex-row lg:items-stretch">
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
                    className={FIELD_CLASS}
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
                    className={FIELD_CLASS}
                    placeholder="Confirmer le nouveau mot de passe"
                    id="confirm-password"
                  />
                </div>
                <div className="pt-2">
                  <p className="text-xs font-medium text-gray-700 mb-2">Doit contenir au moins</p>
                  <ul className="space-y-1.5 text-sm text-gray-600">
                    <PasswordRule
                      ok={passwordRequirements.uppercase}
                      label="Au moins une majuscule"
                    />
                    <PasswordRule
                      ok={passwordRequirements.lowercase}
                      label="Au moins une minuscule"
                    />
                    <PasswordRule ok={passwordRequirements.digit} label="Au moins un chiffre" />
                    <PasswordRule
                      ok={passwordRequirements.minLength}
                      label="Minimum 10 caractères"
                    />
                  </ul>
                </div>
                <div className="flex gap-3 pt-4 justify-end">
                  <button
                    type="button"
                    className="px-5 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button type="submit" className={SAVE_BUTTON_CLASS} style={SAVE_BUTTON_STYLE}>
                    Enregistrer
                  </button>
                </div>
              </form>
            )}

            {confidentialiteSub === 'delete' && (
              <div className="p-6 max-w-xl space-y-4">
                {/* Deactivation control disabled until the backend /api/account/deactivate
                    endpoint ships (the Supabase re-auth path is a broken no-op post-repoint).
                    Static interim message preserves the right to close via support. */}
                <div className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center">
                    <Info className="h-4 w-4 text-white" />
                  </div>
                  <p className="text-sm text-gray-700">
                    La désactivation de compte sera bientôt disponible. Pour fermer votre compte,
                    contactez le support à{' '}
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
  );
}

function NotificationToggle({
  checked,
  onToggle,
  title,
  description,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-primary ${
          checked ? 'bg-brand-primary' : 'bg-gray-200'
        }`}
      >
        <span
          className={`block w-5 h-5 mt-0.5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div>
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function PasswordRule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={ok ? 'text-brand-primary' : 'text-gray-300'}>
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </span>
      {label}
    </li>
  );
}
