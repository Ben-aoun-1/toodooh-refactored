import { Upload, FileText, X, Building2, MapPin, MoreVertical, Trash2 } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import inscriptionImg from '../../assets/inscription.png';
import adresseStepIcon from '../../assets/inscrit/adressex.png';
import agenceIcon from '../../assets/inscrit/agence.png';
import agenceIconS from '../../assets/inscrit/agences.png';
import annonceurIcon from '../../assets/inscrit/annonceur.png';
import annonceurIconS from '../../assets/inscrit/annonceurs.png';
import responsableStepIcon from '../../assets/inscrit/connexion.png';
import documentStepIcon from '../../assets/inscrit/documentx.png';
import individuelIcon from '../../assets/inscrit/individuel.png';
import individuelIconS from '../../assets/inscrit/individuels.png';
import parcIcon from '../../assets/inscrit/parc.png';
import parcIconS from '../../assets/inscrit/parcs.png';
import {
  AGENCY_BUSINESS_SECTOR_NAME,
  sectorsForAdvertiserAgencySignup,
} from '../../constants/advertiserBusinessSectors';
import { authService } from '../../services/auth.service';
import type {
  BusinessSector,
  Governorate,
  SignUpData,
  FleetEstablishmentInput,
  CompanySizeOption,
} from '../../types/auth';

type ProfileType = 'advertiser' | 'agency' | 'individual_owner' | 'fleet_owner';

interface Props {
  currentStep: number;
  onStepChange: (step: number) => void;
  onProfileTypeChange?: (type: ProfileType) => void;
}

const profileCards: {
  id: ProfileType;
  title: string;
  description: string;
  icon: string;
  iconSelected: string;
  group: 'visibility' | 'revenue';
}[] = [
  {
    id: 'advertiser',
    title: 'Annonceur',
    description: 'Je suis une entreprise et je fais de la publicité pour ma marque',
    icon: annonceurIcon,
    iconSelected: annonceurIconS,
    group: 'visibility',
  },
  {
    id: 'agency',
    title: 'Agence',
    description: 'Je suis une agence et je gère des campagnes pour mes clients',
    icon: agenceIcon,
    iconSelected: agenceIconS,
    group: 'visibility',
  },
  {
    id: 'individual_owner',
    title: 'Propriétaire individuel',
    description: 'Je monétise mon écran dans mon établissement',
    icon: individuelIcon,
    iconSelected: individuelIconS,
    group: 'revenue',
  },
  {
    id: 'fleet_owner',
    title: 'Propriétaire de parc',
    description: "Je monétise mes écrans dans mon réseau d'établissements",
    icon: parcIcon,
    iconSelected: parcIconS,
    group: 'revenue',
  },
];

const ownerZones = [
  'La Marsa (Banlieue Nord)',
  'Jardins de Carthage',
  'Aouina/Ain Zaghouan',
  'Berges du Lac',
  'Ariana',
  'El Menzah/El Manar',
  'Centre Ville Tunis',
  'Rades/Megrine/Ben Arous/Banlieue Sud',
  'Manouba',
];

const tunisianCities = [
  'Tunis',
  'Ariana',
  'Ben Arous',
  'Manouba',
  'Nabeul',
  'Zaghouan',
  'Bizerte',
  'Béja',
  'Jendouba',
  'Le Kef',
  'Siliana',
  'Kairouan',
  'Kasserine',
  'Sidi Bouzid',
  'Sousse',
  'Monastir',
  'Mahdia',
  'Sfax',
  'Gafsa',
  'Tozeur',
  'Kebili',
  'Tataouine',
  'Médenine',
  'Gabès',
];

type FleetRow = FleetEstablishmentInput & { id: string };

function parseFleetScreenCount(v: string): number {
  if (v === '6-10') return 8;
  if (v === '10+') return 10;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

const formuleOptions = [
  {
    id: 'abonnement',
    title: 'Abonnement',
    description:
      'Toodooh prend en charge votre abonnement IPTV, Diwan Sport, etc., sans aucun frais',
    icon: '📺',
  },
  {
    id: 'revenue_share',
    title: 'Revenue share',
    description: 'Générez des revenus variables en recevant une part sur les publicités diffusées',
    icon: '🤝',
  },
];

export default function SignUpForm({ currentStep, onStepChange, onProfileTypeChange }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sectors, setSectors] = useState<BusinessSector[]>([]);
  const [ownerSectors, setOwnerSectors] = useState<BusinessSector[]>([]);
  const [companySizeOptions, setCompanySizeOptions] = useState<CompanySizeOption[]>([]);
  const [governorates, setGovernorates] = useState<Governorate[]>([]);
  const [selectedProfileType, setSelectedProfileType] = useState<ProfileType>('advertiser');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [addDocumentLater, setAddDocumentLater] = useState(false);
  const [addBankLater, setAddBankLater] = useState(false);
  const [bankDocFile, setBankDocFile] = useState<File | null>(null);
  const [ownerCertificationAccepted, setOwnerCertificationAccepted] = useState(false);
  const [etablissementName, setEtablissementName] = useState('');
  const [etablissementScreens, setEtablissementScreens] = useState<string>('');
  const [etablissementRooms, setEtablissementRooms] = useState('');

  const [fleetEstablishments, setFleetEstablishments] = useState<FleetRow[]>([]);
  const [fleetDraftName, setFleetDraftName] = useState('');
  const [fleetDraftScreens, setFleetDraftScreens] = useState('');
  const [fleetDraftRooms, setFleetDraftRooms] = useState('');
  const [fleetDraftStreet, setFleetDraftStreet] = useState('');
  const [fleetDraftCity, setFleetDraftCity] = useState('');
  const [fleetDraftZone, setFleetDraftZone] = useState('');
  const [fleetDraftGovernorate, setFleetDraftGovernorate] = useState('');
  const [fleetMenuOpenId, setFleetMenuOpenId] = useState<string | null>(null);
  const [companyLogo, setCompanyLogo] = useState<File | null>(null);
  const [companyLogoPreview, setCompanyLogoPreview] = useState<string | null>(null);
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [fonction, setFonction] = useState('');
  const [emailConflict, setEmailConflict] = useState<string | null>(null);
  const [phoneConflict, setPhoneConflict] = useState<string | null>(null);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formData, setFormData] = useState<Partial<SignUpData>>({
    email: '',
    password: '',
    business_name: '',
    tax_number: '',
    business_sector_id: '',
    business_type: 'local',
    profile_type: 'advertiser',
    contact_name: '',
    contact_phone: '+216',
    street_address: '',
    city: '',
    postal_code: '',
    governorate_id: '',
    zone: '',
    cin: '',
    formule: '',
    agent_toodooh: '',
    number_of_screens: undefined,
    number_of_rooms: undefined,
    company_size: '',
    terms_accepted: false,
  });

  const isOwner =
    selectedProfileType === 'individual_owner' || selectedProfileType === 'fleet_owner';
  const prevProfileTypeRef = useRef<ProfileType | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [sectorsData, ownerSectorsData, companySizeData, governoratesData] =
          await Promise.all([
            authService.getBusinessSectors(),
            authService.getOwnerBusinessSectors(),
            authService.getCompanySizeOptions(),
            authService.getGovernorates(),
          ]);
        setSectors(sectorsData);
        setOwnerSectors(ownerSectorsData);
        setCompanySizeOptions(companySizeData);
        setGovernorates(governoratesData);
      } catch {
        toast.error('Erreur lors du chargement des données');
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      profile_type: selectedProfileType,
      business_type: selectedProfileType === 'agency' ? 'agency' : 'local',
    }));
  }, [selectedProfileType]);

  useEffect(() => {
    onProfileTypeChange?.(selectedProfileType);
  }, [selectedProfileType, onProfileTypeChange]);

  useEffect(() => {
    if (selectedProfileType !== 'fleet_owner') {
      setFleetEstablishments([]);
      setFleetDraftName('');
      setFleetDraftScreens('');
      setFleetDraftRooms('');
      setFleetDraftStreet('');
      setFleetDraftCity('');
      setFleetDraftZone('');
      setFleetDraftGovernorate('');
      setFleetMenuOpenId(null);
    }
  }, [selectedProfileType]);

  const getDisplaySectors = () => {
    if (isOwner) return ownerSectors;
    return sectorsForAdvertiserAgencySignup(sectors);
  };

  useEffect(() => {
    const prev = prevProfileTypeRef.current;
    prevProfileTypeRef.current = selectedProfileType;

    if (selectedProfileType === 'advertiser' && prev !== null && prev !== 'advertiser') {
      setFormData((p) => ({ ...p, business_sector_id: '' }));
    }
    if (selectedProfileType === 'agency') {
      const row = sectors.find((s) => s.name === AGENCY_BUSINESS_SECTOR_NAME);
      if (!row) return;
      setFormData((p) => {
        if (prev !== 'agency') return { ...p, business_sector_id: row.id };
        if (!p.business_sector_id) return { ...p, business_sector_id: row.id };
        return p;
      });
    }
  }, [selectedProfileType, sectors]);

  const validatePassword = (pw: string) =>
    pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const normalizePhone = (value: string) => (value || '').replace(/\s+/g, '').trim();
  const isValidTunisiaPhone = (value: string) => /^\+216\d{8}$/.test(normalizePhone(value));
  const pwHasUpper = /[A-Z]/.test(formData.password || '');
  const pwHasDigit = /\d/.test(formData.password || '');
  const pwHasMinLen = (formData.password || '').length >= 8;
  const pwMatch = Boolean(
    formData.password && confirmPassword && formData.password === confirmPassword,
  );

  // Sync contact_name from nom + prénom
  useEffect(() => {
    const fullName = `${firstName} ${lastName}`.trim();
    setFormData((prev) => ({ ...prev, contact_name: fullName }));
  }, [firstName, lastName]);

  const validateUniqueCredentials = async (
    showToast = true,
    scope: 'both' | 'email' | 'phone' = 'both',
  ): Promise<boolean> => {
    const normalizedEmail = String(formData.email || '')
      .trim()
      .toLowerCase();
    const normalizedPhone = normalizePhone(String(formData.contact_phone || ''));

    const checkEmail = scope === 'both' || scope === 'email';
    const checkPhone = scope === 'both' || scope === 'phone';

    if (checkEmail && !emailRegex.test(normalizedEmail)) {
      setEmailConflict('Format email invalide');
      if (showToast) toast.error('📧 Veuillez saisir une adresse email valide.');
      return false;
    }

    if (checkPhone && !isValidTunisiaPhone(normalizedPhone)) {
      setPhoneConflict('Numéro invalide (format attendu: +216XXXXXXXX)');
      if (showToast) toast.error('📞 Numéro invalide. Utilisez le format +216XXXXXXXX.');
      return false;
    }

    // L'unicité du téléphone n'est plus bloquante.
    if (!checkEmail) {
      setPhoneConflict(null);
      return true;
    }

    setCheckingConflicts(true);
    try {
      const { emailExists } = await authService.checkSignupConflicts(
        normalizedEmail,
        normalizedPhone,
      );
      const nextEmailConflict =
        checkEmail && emailExists ? 'Cette adresse email existe déjà' : null;
      setEmailConflict(nextEmailConflict);
      setPhoneConflict(null);

      if (nextEmailConflict) {
        if (showToast)
          toast.error(
            '📧 Cette adresse email est déjà utilisée. Veuillez vous connecter ou utiliser une autre adresse.',
          );
        return false;
      }
      return true;
    } catch {
      if (showToast) toast.error('Impossible de vérifier la disponibilité de l’email. Réessayez.');
      return false;
    } finally {
      setCheckingConflicts(false);
    }
  };

  /* ── navigation helpers ── */
  const canGoNext = () => {
    switch (currentStep) {
      case 0:
        return Boolean(selectedProfileType);
      case 1:
        return Boolean(
          lastName.trim() &&
          firstName.trim() &&
          fonction.trim() &&
          formData.agent_toodooh?.trim() &&
          formData.email?.trim() &&
          emailRegex.test(String(formData.email || '').trim()) &&
          formData.password &&
          validatePassword(formData.password) &&
          pwMatch &&
          formData.contact_phone &&
          isValidTunisiaPhone(String(formData.contact_phone || '')) &&
          !emailConflict &&
          !phoneConflict &&
          !checkingConflicts,
        );
      case 2:
        if (selectedProfileType === 'individual_owner') {
          return Boolean(
            etablissementName.trim() &&
            formData.tax_number?.trim() &&
            formData.business_sector_id &&
            etablissementScreens &&
            etablissementRooms.trim(),
          );
        }
        return Boolean(
          formData.business_name?.trim() &&
          formData.tax_number?.trim() &&
          (selectedProfileType === 'agency' ? true : formData.business_sector_id) &&
          formData.company_size &&
          formData.street_address?.trim() &&
          formData.city?.trim() &&
          formData.zone?.trim() &&
          (selectedProfileType === 'fleet_owner' ? formData.postal_code?.trim() : true) &&
          formData.governorate_id,
        );
      case 3:
        if (isOwner) {
          if (selectedProfileType === 'fleet_owner') return fleetEstablishments.length >= 1;
          return Boolean(
            formData.street_address?.trim() &&
            formData.city?.trim() &&
            formData.postal_code?.trim() &&
            formData.zone?.trim() &&
            formData.governorate_id,
          );
        }
        return Boolean(
          formData.street_address?.trim() &&
          formData.city?.trim() &&
          formData.postal_code?.trim() &&
          formData.governorate_id,
        );
      case 4:
        return true;
      default:
        return false;
    }
  };

  const goNext = () => {
    if (currentStep >= 4 || !canGoNext()) return;
    if (currentStep === 1) {
      const run = async () => {
        const available = await validateUniqueCredentials(true);
        if (!available) return;
        onStepChange(currentStep + 1);
      };
      void run();
      return;
    }
    if (selectedProfileType === 'individual_owner' && currentStep === 2) {
      const screensNum =
        etablissementScreens === '6-10'
          ? 8
          : etablissementScreens === '10+'
            ? 10
            : parseInt(etablissementScreens, 10);
      setFormData((prev) => ({
        ...prev,
        business_name: etablissementName.trim(),
        number_of_screens: Number.isNaN(screensNum) ? undefined : screensNum,
        number_of_rooms: parseInt(etablissementRooms, 10) || undefined,
      }));
    }
    if (isOwner && currentStep === 3 && selectedProfileType === 'individual_owner') {
      setFormData((prev) => ({
        ...prev,
        business_name: prev.business_name?.trim() || etablissementName.trim(),
      }));
    }
    if (isOwner && currentStep === 3 && selectedProfileType === 'fleet_owner') {
      const totalScreens = fleetEstablishments.reduce((a, e) => a + e.screen_count, 0);
      const totalRooms = fleetEstablishments.reduce((a, e) => a + e.room_count, 0);
      setFormData((prev) => ({
        ...prev,
        number_of_screens: totalScreens,
        number_of_rooms: totalRooms,
      }));
    }
    onStepChange(currentStep + 1);
  };

  const isFleetDraftValid = () => {
    const rooms = parseInt(fleetDraftRooms, 10);
    const screens = parseFleetScreenCount(fleetDraftScreens);
    return Boolean(
      fleetDraftName.trim() &&
      fleetDraftScreens &&
      screens > 0 &&
      fleetDraftRooms.trim() &&
      !Number.isNaN(rooms) &&
      fleetDraftStreet.trim() &&
      fleetDraftCity &&
      fleetDraftZone.trim() &&
      fleetDraftGovernorate,
    );
  };

  const addFleetEstablishment = () => {
    if (!isFleetDraftValid()) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }
    const rooms = parseInt(fleetDraftRooms, 10);
    const screenCount = parseFleetScreenCount(fleetDraftScreens);
    const row: FleetRow = {
      id: crypto.randomUUID(),
      name: fleetDraftName.trim(),
      screen_count: screenCount,
      room_count: rooms,
      street_address: fleetDraftStreet.trim(),
      city: fleetDraftCity,
      zone: fleetDraftZone.trim(),
      governorate_id: fleetDraftGovernorate,
    };
    setFleetEstablishments((prev) => [...prev, row]);
    setFleetDraftName('');
    setFleetDraftScreens('');
    setFleetDraftRooms('');
    setFleetDraftStreet('');
    setFleetDraftCity('');
    setFleetDraftZone('');
    setFleetDraftGovernorate('');
    toast.success('Établissement ajouté au réseau');
  };

  const removeFleetEstablishment = (id: string) => {
    setFleetEstablishments((prev) => prev.filter((e) => e.id !== id));
    setFleetMenuOpenId(null);
    toast.success('Établissement retiré');
  };

  const goPrev = () => {
    if (currentStep > 0) onStepChange(currentStep - 1);
  };

  /* ── submit (step 5) ── */
  const handleSubmit = async () => {
    if (!formData.terms_accepted) {
      toast.error('Veuillez accepter les conditions générales');
      return;
    }
    if (isOwner && !ownerCertificationAccepted) {
      toast.error('Veuillez certifier que vous êtes autorisé(e) à inscrire cet établissement.');
      return;
    }
    setLoading(true);
    try {
      const composedContactName = `${firstName} ${lastName}`.trim();
      const signupDataWithFile: SignUpData = {
        ...(formData as SignUpData),
        contact_name: composedContactName,
        profile_type: selectedProfileType,
        fonction: fonction.trim() || undefined,
        registration_doc: !isOwner ? documentFile || undefined : undefined,
        company_logo: companyLogo || undefined,
        bank_doc: isOwner && !addBankLater ? bankDocFile || undefined : undefined,
        fleet_establishments:
          selectedProfileType === 'fleet_owner' && fleetEstablishments.length > 0
            ? fleetEstablishments.map(({ id: _id, ...rest }) => rest)
            : undefined,
      };
      await authService.signUp(signupDataWithFile);
      await new Promise((r) => setTimeout(r, 1000));
      await authService.logout();
      toast.success('Inscription réussie ! Veuillez vous connecter.');
      setTimeout(() => navigate('/login'), 2000);
    } catch (error: any) {
      toast.error(error?.message || 'Une erreur inattendue');
    } finally {
      setLoading(false);
    }
  };

  /* ── render helpers ── */
  const inputClass =
    'w-full px-4 py-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#00B3A6]/30 focus:border-[#00B3A6] transition-all text-sm text-gray-900 placeholder-gray-400';
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5';

  /* ═══════ Step 0: Profile selection ═══════ */
  const renderProfileSelection = () => {
    const visibilityCards = profileCards.filter((c) => c.group === 'visibility');
    const revenueCards = profileCards.filter((c) => c.group === 'revenue');

    const groupColors = {
      visibility: { bg: '#F5FAF8', title: '#2D4A43', accent: '#76E6AB' },
      revenue: { bg: '#EFF1FE', title: '#4A4D8A', accent: '#9297F1' },
    };

    const renderGroup = (
      label: string,
      cards: typeof profileCards,
      groupType: 'visibility' | 'revenue',
    ) => {
      const colors = groupColors[groupType];
      return (
        <div className="rounded-3xl p-3 pt-6" style={{ background: colors.bg }}>
          <p
            className="text-center font-medium text-lg mb-5"
            style={{ color: colors.title, letterSpacing: '-0.006em' }}
          >
            {label}
          </p>
          <div className="flex gap-2">
            {cards.map((card) => {
              const isSelected = selectedProfileType === card.id;
              const imgSrc = isSelected ? card.iconSelected : card.icon;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setSelectedProfileType(card.id)}
                  className="flex-1 relative flex flex-col items-start text-left rounded-xl p-4 pb-6 transition-all"
                  style={{
                    background: '#FFFFFF',
                    border: `1px solid ${isSelected ? colors.accent : '#EBEBEB'}`,
                    boxShadow: '0px 1px 2px rgba(10, 13, 20, 0.03)',
                    gap: '14px',
                  }}
                >
                  {/* Radio */}
                  <div className="absolute top-4 right-4">
                    {isSelected ? (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: colors.accent }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6.5L4.5 8.5L9.5 3.5"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    ) : (
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: '#EBEBEB' }}
                      >
                        <div
                          className="w-[13px] h-[13px] rounded-full bg-white"
                          style={{ boxShadow: '0px 2px 2px rgba(27, 28, 29, 0.12)' }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Icon */}
                  <img src={imgSrc} alt="" className="w-12 h-12 object-contain flex-shrink-0" />

                  {/* Text */}
                  <div className="flex flex-col gap-1">
                    <h4
                      className="font-medium text-sm"
                      style={{ color: '#171717', letterSpacing: '-0.006em' }}
                    >
                      {card.title}
                    </h4>
                    <p
                      className="text-xs leading-4"
                      style={{ color: '#5C5C5C', letterSpacing: '-0.006em' }}
                    >
                      {card.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      );
    };

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <img src={inscriptionImg} alt="" className="w-20 h-20 object-contain mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Choisissez votre profil</h2>
        <p className="text-sm text-gray-500 mb-8">
          Sélectionnez le type de profil qui correspond le mieux à votre activité
        </p>
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6">
          {renderGroup('+ de visibilité', visibilityCards, 'visibility')}
          {renderGroup('+ de revenue', revenueCards, 'revenue')}
        </div>
      </div>
    );
  };

  /* ═══════ Step 1: Responsable ═══════ */
  const renderStep1 = () => (
    <div className="max-w-3xl mx-auto w-full space-y-5">
      <div className="text-center mb-6">
        <img src={responsableStepIcon} alt="" className="w-16 h-16 object-contain mx-auto mb-3" />
        <h2 className="text-xl font-bold text-gray-900">
          {selectedProfileType === 'individual_owner'
            ? "Information sur l'agent"
            : 'Informations sur le responsable'}
        </h2>
        <p className="text-sm text-gray-500">Renseignez vos informations professionnelles</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Nom */}
        <div>
          <label className={labelClass}>
            Nom <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
            placeholder="Nom"
          />
        </div>
        {/* Prénom */}
        <div>
          <label className={labelClass}>
            Prénom <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
            placeholder="Prénom"
          />
        </div>
        {/* Fonction */}
        <div>
          <label className={labelClass}>
            Fonction <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={fonction}
            onChange={(e) => setFonction(e.target.value)}
            className={inputClass}
            placeholder="Fonction"
          />
        </div>
        {/* Email */}
        <div>
          <label className={labelClass}>
            Email professionnel <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            required
            value={formData.email}
            onChange={(e) => {
              setEmailConflict(null);
              setFormData({ ...formData, email: e.target.value });
            }}
            onBlur={() => {
              if (formData.email?.trim()) void validateUniqueCredentials(false, 'email');
            }}
            className={inputClass}
            placeholder="contact@entreprise.com"
          />
          {emailConflict && <p className="text-xs text-red-600 mt-1">{emailConflict}</p>}
        </div>
        {/* Téléphone */}
        <div>
          <label className={labelClass}>
            Téléphone <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            required
            value={formData.contact_phone}
            onChange={(e) => {
              setPhoneConflict(null);
              const v = normalizePhone(e.target.value);
              if (!v || v.length < 4) setFormData({ ...formData, contact_phone: '+216' });
              else if (v.startsWith('+216')) setFormData({ ...formData, contact_phone: v });
              else setFormData({ ...formData, contact_phone: '+216' + v.replace(/^\+/, '') });
            }}
            onBlur={() => {
              if (formData.contact_phone?.trim()) void validateUniqueCredentials(false, 'phone');
            }}
            className={inputClass}
            placeholder="+21612345678"
          />
          {phoneConflict && <p className="text-xs text-red-600 mt-1">{phoneConflict}</p>}
        </div>
        {/* Code screencast/screenhost agent (après email et téléphone) */}
        <div>
          <label className={labelClass}>
            CODE DE VOTRE {isOwner ? 'SCREENHOST' : 'SCREENCAST'} AGENT{' '}
            <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={formData.agent_toodooh}
            onChange={(e) => setFormData({ ...formData, agent_toodooh: e.target.value })}
            className={inputClass}
            placeholder="- - - - - - - - - -"
          />
        </div>
        {/* Mot de passe */}
        <div>
          <label className={labelClass}>
            Mot de passe <span className="text-red-500">*</span>
          </label>
          <input
            type={showPassword ? 'text' : 'password'}
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className={inputClass}
            placeholder="••••••••••"
          />
        </div>
        {/* Confirmer mot de passe */}
        <div>
          <label className={labelClass}>
            Confirmer Mot de passe <span className="text-red-500">*</span>
          </label>
          <input
            type={showConfirmPassword ? 'text' : 'password'}
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
            placeholder="••••••••••"
          />
        </div>
      </div>
      {/* Password strength indicators */}
      <div className="space-y-1 pt-1">
        <p className="text-xs text-gray-500">Doit contenir au moins</p>
        <div className="flex items-center gap-1.5">
          <div
            className={`w-4 h-4 rounded-full flex items-center justify-center ${pwHasUpper ? 'bg-[#00B3A6]' : 'bg-gray-200'}`}
          >
            {pwHasUpper && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 6.5L4.5 8.5L9.5 3.5"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          <span className={`text-xs ${pwHasUpper ? 'text-gray-700' : 'text-gray-400'}`}>
            Au moins une majuscule
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`w-4 h-4 rounded-full flex items-center justify-center ${pwHasDigit ? 'bg-[#00B3A6]' : 'bg-gray-200'}`}
          >
            {pwHasDigit && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 6.5L4.5 8.5L9.5 3.5"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          <span className={`text-xs ${pwHasDigit ? 'text-gray-700' : 'text-gray-400'}`}>
            Au moins un chiffre
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`w-4 h-4 rounded-full flex items-center justify-center ${pwHasMinLen ? 'bg-[#00B3A6]' : 'bg-gray-200'}`}
          >
            {pwHasMinLen && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 6.5L4.5 8.5L9.5 3.5"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
          <span className={`text-xs ${pwHasMinLen ? 'text-gray-700' : 'text-gray-400'}`}>
            Minimum 8 caractères
          </span>
        </div>
      </div>
    </div>
  );

  /* ═══════ Step 2: Entreprise (champs capture uniquement) ═══════ */
  const parcCountOptions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '12+'];
  const renderStep2 = () => (
    <div className="max-w-3xl mx-auto w-full space-y-5">
      {selectedProfileType === 'individual_owner' ? (
        <>
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-[#e8f8ee] flex items-center justify-center mx-auto mb-3">
              <Building2 className="w-8 h-8 text-gray-700" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Etablissement</h2>
            <p className="text-sm text-gray-500">
              Renseignez les informations de votre établissement
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Téléchargez votre logo</p>
              <p className="text-xs text-gray-400">Min 400×400px, PNG or JPEG</p>
            </div>
            <div className="flex items-center gap-3 ml-auto flex-shrink-0">
              <div
                className="rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden"
                style={{ width: 56, height: 56 }}
              >
                {companyLogoPreview ? (
                  <img src={companyLogoPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Building2 className="w-6 h-6 text-gray-300" />
                )}
              </div>
              <label className="cursor-pointer px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors whitespace-nowrap">
                Ajouter une image
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setCompanyLogo(file);
                      setCompanyLogoPreview(URL.createObjectURL(file));
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>
                Nom de l&apos;établissement <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={etablissementName}
                onChange={(e) => setEtablissementName(e.target.value)}
                className={inputClass}
                placeholder="Nom de l'établissement"
              />
            </div>
            <div>
              <label className={labelClass}>
                Matricule fiscal <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.tax_number}
                onChange={(e) => setFormData({ ...formData, tax_number: e.target.value })}
                className={inputClass}
                placeholder="Matricule fiscal"
              />
            </div>
            <div>
              <label className={labelClass}>
                Catégorie <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.business_sector_id}
                onChange={(e) => setFormData({ ...formData, business_sector_id: e.target.value })}
                className={inputClass}
              >
                <option value="">Sélectionnez votre secteur</option>
                {getDisplaySectors().map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                Nombre d&apos;écrans <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={etablissementScreens}
                onChange={(e) => setEtablissementScreens(e.target.value)}
                className={inputClass}
              >
                {screenOptions.map((o) => (
                  <option key={`io-${o.value || 'empty'}`} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                Nombre de salles <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={etablissementRooms}
                onChange={(e) => setEtablissementRooms(e.target.value)}
                className={inputClass}
                placeholder="2"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-[#e8f8ee] flex items-center justify-center mx-auto mb-3">
              <Building2 className="w-8 h-8 text-gray-700" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Informations sur l&apos;entreprise</h2>
            <p className="text-sm text-gray-500">Renseignez les informations de votre entreprise</p>
          </div>

          {/* Logo upload */}
          <div className="flex items-center gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Téléchargez votre logo</p>
              <p className="text-xs text-gray-400">Min 400×400px, PNG or JPEG</p>
            </div>
            <div className="flex items-center gap-3 ml-auto flex-shrink-0">
              <div
                className="rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden"
                style={{ width: 56, height: 56 }}
              >
                {companyLogoPreview ? (
                  <img src={companyLogoPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Building2 className="w-6 h-6 text-gray-300" />
                )}
              </div>
              <label className="cursor-pointer px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors whitespace-nowrap">
                Ajouter une image
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setCompanyLogo(file);
                      setCompanyLogoPreview(URL.createObjectURL(file));
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>
                Nom de l&apos;entreprise <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.business_name}
                onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                className={inputClass}
                placeholder="Nom de l'entreprise"
              />
            </div>
            <div>
              <label className={labelClass}>
                Matricule fiscal <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.tax_number}
                onChange={(e) => setFormData({ ...formData, tax_number: e.target.value })}
                className={inputClass}
                placeholder="Matricule fiscal"
              />
            </div>
            <div>
              <label className={labelClass}>
                Catégorie <span className="text-red-500">*</span>
              </label>
              {selectedProfileType === 'agency' ? (
                <>
                  <input
                    type="text"
                    value="Agence de publicité"
                    readOnly
                    className={`${inputClass} bg-gray-100 text-gray-700 cursor-not-allowed`}
                  />
                  <input type="hidden" value={formData.business_sector_id || ''} />
                </>
              ) : (
                <select
                  required
                  value={formData.business_sector_id}
                  onChange={(e) => setFormData({ ...formData, business_sector_id: e.target.value })}
                  className={inputClass}
                >
                  {selectedProfileType === 'advertiser' && (
                    <option value="">ajoutez votre secteur d&apos;activité</option>
                  )}
                  {isOwner && <option value="">Sélectionnez votre secteur</option>}
                  {getDisplaySectors().map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className={labelClass}>
                {isOwner ? "Nombre d'établissements de votre parc" : "Taille de l'entreprise"}{' '}
                <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.company_size || ''}
                onChange={(e) => setFormData({ ...formData, company_size: e.target.value })}
                className={inputClass}
              >
                <option value="">{isOwner ? '12' : 'Sélectionnez la taille'}</option>
                {isOwner
                  ? parcCountOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))
                  : companySizeOptions.map((o) => (
                      <option key={o.id} value={o.value}>
                        {o.value}
                      </option>
                    ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>
              Adresse du siège <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.street_address}
              onChange={(e) => setFormData({ ...formData, street_address: e.target.value })}
              className={inputClass}
              placeholder="Adresse"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass}>
                Ville <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className={inputClass}
                placeholder="Ville"
              />
            </div>
            <div>
              <label className={labelClass}>
                Zone <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.zone}
                onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
                className={inputClass}
                placeholder="1000"
              />
            </div>
          </div>
          {selectedProfileType === 'fleet_owner' && (
            <div>
              <label className={labelClass}>
                Code postal <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                pattern="\d{4}"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                className={inputClass}
                placeholder="1000"
              />
            </div>
          )}

          <div>
            <label className={labelClass}>
              Gouvernorat <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={formData.governorate_id}
              onChange={(e) => setFormData({ ...formData, governorate_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Gouvernorat</option>
              {governorates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );

  const screenOptions = [
    { value: '', label: 'Sélectionnez' },
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' },
    { value: '5', label: '5' },
    { value: '6-10', label: '6-10' },
    { value: '10+', label: '10+' },
  ];

  /* ═══════ Step 3 (owner): Établissement — propriétaire individuel ═══════ */
  const renderEtablissementIndividual = () => (
    <div className="max-w-3xl mx-auto w-full space-y-5">
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-full bg-[#e8f8ee] flex items-center justify-center mx-auto mb-3">
          <MapPin className="w-8 h-8 text-gray-700" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Votre établissement</h2>
        <p className="text-sm text-gray-500">Renseignez les informations de votre établissement</p>
      </div>
      <div className="space-y-5">
        <div>
          <label className={labelClass}>
            Nom de l&apos;établissement <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={etablissementName}
            onChange={(e) => setEtablissementName(e.target.value)}
            className={inputClass}
            placeholder="Nom de l'établissement"
          />
        </div>
        <div>
          <label className={labelClass}>
            Nombre d&apos;écrans <span className="text-red-500">*</span>
          </label>
          <select
            required
            value={etablissementScreens}
            onChange={(e) => setEtablissementScreens(e.target.value)}
            className={inputClass}
          >
            {screenOptions.map((o) => (
              <option key={o.value || 'empty'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>
            Nombre de salles <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={etablissementRooms}
            onChange={(e) => setEtablissementRooms(e.target.value)}
            className={inputClass}
            placeholder="2"
          />
        </div>
        <div>
          <label className={labelClass}>
            Adresse <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={formData.street_address}
            onChange={(e) => setFormData({ ...formData, street_address: e.target.value })}
            className={inputClass}
            placeholder="Adresse"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>
              Ville <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              className={inputClass}
              placeholder="Ville"
            />
          </div>
          <div>
            <label className={labelClass}>
              Zone <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.zone}
              onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
              className={inputClass}
              placeholder="Zone"
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>
            Gouvernorat <span className="text-red-500">*</span>
          </label>
          <select
            required
            value={formData.governorate_id}
            onChange={(e) => setFormData({ ...formData, governorate_id: e.target.value })}
            className={inputClass}
          >
            <option value="">Gouvernorat</option>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );

  /* ═══════ Step 3 (owner): Réseau — propriétaire de parc (localités) ═══════ */
  const renderEtablissementFleet = () => (
    <div className="max-w-3xl mx-auto w-full space-y-6">
      <div className="text-center mb-4">
        <div className="w-16 h-16 rounded-full bg-[#e8f8ee] flex items-center justify-center mx-auto mb-3">
          <MapPin className="w-8 h-8 text-gray-700" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Votre réseau d&apos;établissement</h2>
        <p className="text-sm text-gray-500 max-w-lg mx-auto">
          Ajouter les établissements éligibles à la diffusion de spots publicitaires
        </p>
      </div>

      {fleetEstablishments.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600 border-b border-gray-200">
                  <th className="px-4 py-3">Établissements enregistrés</th>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">Nombre d&apos;écrans</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">Nombre de salles</th>
                  <th className="px-3 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {fleetEstablishments.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                    <td className="px-4 py-3 text-gray-700">{row.city}</td>
                    <td className="px-4 py-3 text-center tabular-nums text-gray-800">
                      {row.screen_count}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-gray-800">
                      {row.room_count}
                    </td>
                    <td className="px-2 py-3 relative">
                      <button
                        type="button"
                        className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                        aria-label="Actions"
                        onClick={() => setFleetMenuOpenId((id) => (id === row.id ? null : row.id))}
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>
                      {fleetMenuOpenId === row.id && (
                        <>
                          <button
                            type="button"
                            className="fixed inset-0 z-10 cursor-default"
                            aria-label="Fermer le menu"
                            onClick={() => setFleetMenuOpenId(null)}
                          />
                          <div className="absolute right-2 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                              onClick={() => removeFleetEstablishment(row.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                              Supprimer
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label className={labelClass}>
            Nom de l&apos;établissement <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={fleetDraftName}
            onChange={(e) => setFleetDraftName(e.target.value)}
            className={inputClass}
            placeholder="Nom de l'établissement"
          />
        </div>
        <div>
          <label className={labelClass}>
            Nombre d&apos;écrans <span className="text-red-500">*</span>
          </label>
          <select
            value={fleetDraftScreens}
            onChange={(e) => setFleetDraftScreens(e.target.value)}
            className={inputClass}
          >
            {screenOptions.map((o) => (
              <option key={`f-${o.value || 'e'}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>
            Nombre de salles <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={fleetDraftRooms}
            onChange={(e) => setFleetDraftRooms(e.target.value)}
            className={inputClass}
            placeholder="2"
          />
        </div>
        <div>
          <label className={labelClass}>
            Adresse <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={fleetDraftStreet}
            onChange={(e) => setFleetDraftStreet(e.target.value)}
            className={inputClass}
            placeholder="Adresse"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>
              Ville <span className="text-red-500">*</span>
            </label>
            <select
              value={fleetDraftCity}
              onChange={(e) => setFleetDraftCity(e.target.value)}
              className={inputClass}
            >
              <option value="">Ville</option>
              {tunisianCities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>
              Zone <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={fleetDraftZone}
              onChange={(e) => setFleetDraftZone(e.target.value)}
              className={inputClass}
              placeholder="Zone ou code postal"
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>
            Gouvernorat <span className="text-red-500">*</span>
          </label>
          <select
            value={fleetDraftGovernorate}
            onChange={(e) => setFleetDraftGovernorate(e.target.value)}
            className={inputClass}
          >
            <option value="">Gouvernorat</option>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );

  const renderEtablissement = () =>
    selectedProfileType === 'fleet_owner'
      ? renderEtablissementFleet()
      : renderEtablissementIndividual();

  /* ═══════ Step 4 (owner): Coordonnées bancaires ═══════ */
  const renderCoordonneesBancaires = () => (
    <div className="max-w-3xl mx-auto w-full space-y-6">
      <div className="text-center mb-2">
        <div className="w-16 h-16 rounded-full bg-[#e8f8ee] flex items-center justify-center mx-auto mb-3">
          <FileText className="w-8 h-8 text-gray-700" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Coordonnées bancaires</h2>
        <p className="text-sm text-gray-500">
          Téléchargez vos coordonnées bancaires pour recevoir les revenus de vos campagnes
        </p>
      </div>

      <div className="rounded-2xl p-5" style={{ background: '#F5F5F5' }}>
        <label className="flex items-start cursor-pointer gap-3">
          <input
            type="checkbox"
            checked={addBankLater}
            onChange={(e) => {
              setAddBankLater(e.target.checked);
              if (e.target.checked) setBankDocFile(null);
            }}
            className="h-5 w-5 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded mt-0.5 flex-shrink-0"
          />
          <div>
            <p className="text-sm font-semibold text-gray-900">
              J&apos;ajouterai mes coordonnées bancaires plus tard
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Vous pourrez uploader vos documents depuis votre profil après inscription.
            </p>
          </div>
        </label>
      </div>

      {!addBankLater && (
        <div
          className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center"
          style={{ background: '#FAFAFA' }}
        >
          <div className="w-14 h-14 rounded-full bg-[#e8f8ee] flex items-center justify-center mx-auto mb-4">
            <Upload className="h-7 w-7 text-gray-700" />
          </div>
          <h4 className="font-medium text-gray-900 mb-1">
            Ajouter le relevé d&apos;identité bancaire de votre établissement
          </h4>
          <p className="text-xs text-gray-500 mb-5">
            Formats acceptés : PDF, JPG, JPEG, PNG (Max 5 MB)
          </p>
          <label className="inline-block cursor-pointer px-6 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors">
            Parcourir les fichiers
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 5 * 1024 * 1024) {
                    toast.error('Fichier trop volumineux (max 5 MB)');
                    return;
                  }
                  setBankDocFile(file);
                }
              }}
            />
          </label>
          {bankDocFile && <p className="mt-3 text-sm text-gray-600">{bankDocFile.name}</p>}
        </div>
      )}

      <div className="space-y-4 pt-2">
        <label className="flex items-start cursor-pointer gap-3">
          <input
            type="checkbox"
            checked={formData.terms_accepted}
            onChange={(e) => setFormData({ ...formData, terms_accepted: e.target.checked })}
            className="h-5 w-5 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-gray-700">
            J&apos;accepte{' '}
            <a href="/terms" className="text-gray-900 font-medium underline underline-offset-2">
              les conditions générales d&apos;utilisation
            </a>
          </span>
        </label>
        <label className="flex items-start cursor-pointer gap-3">
          <input
            type="checkbox"
            checked={ownerCertificationAccepted}
            onChange={(e) => setOwnerCertificationAccepted(e.target.checked)}
            className="h-5 w-5 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-gray-500">
            En validant mon inscription, je certifie être autorisé(e) à inscrire cet établissement
            sur Toodooh,
          </span>
        </label>
      </div>
    </div>
  );

  /* ═══════ Step 3: Adresse ═══════ */
  const renderStep3 = () => (
    <div className="max-w-3xl mx-auto w-full space-y-5">
      <div className="text-center mb-6">
        <img src={adresseStepIcon} alt="" className="w-16 h-16 object-contain mx-auto mb-3" />
        <h2 className="text-xl font-bold text-gray-900">Adresse</h2>
        <p className="text-sm text-gray-500">Renseignez l&apos;adresse de votre entreprise</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="md:col-span-2">
          <label className={labelClass}>
            Adresse <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={formData.street_address}
            onChange={(e) => setFormData({ ...formData, street_address: e.target.value })}
            className={inputClass}
            placeholder="123 Rue de la Paix"
          />
        </div>
        <div>
          <label className={labelClass}>
            Ville <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            className={inputClass}
            placeholder="Tunis"
          />
        </div>
        <div>
          <label className={labelClass}>
            Code postal <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            pattern="\d{4}"
            value={formData.postal_code}
            onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
            className={inputClass}
            placeholder="1000"
          />
        </div>
        {(selectedProfileType === 'fleet_owner' || selectedProfileType === 'individual_owner') && (
          <div className="md:col-span-2">
            <label className={labelClass}>
              Secteur/Zone <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={formData.zone}
              onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
              className={inputClass}
            >
              <option value="">-- Choisissez --</option>
              {ownerZones.map((z, i) => (
                <option key={i} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="md:col-span-2">
          <label className={labelClass}>
            Gouvernorat <span className="text-red-500">*</span>
          </label>
          <select
            required
            value={formData.governorate_id}
            onChange={(e) => setFormData({ ...formData, governorate_id: e.target.value })}
            className={inputClass}
          >
            <option value="">-- Choisissez --</option>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );

  /* ═══════ Step 4: Documents ═══════ */
  const renderStep4 = () => (
    <div className="max-w-3xl mx-auto w-full space-y-6">
      {/* Header */}
      <div className="text-center mb-2">
        <img src={documentStepIcon} alt="" className="w-16 h-16 object-contain mx-auto mb-3" />
        <h2 className="text-xl font-bold text-gray-900">Documents légaux</h2>
        <p className="text-sm text-gray-500">Téléchargez votre preuve d&apos;existence légale</p>
      </div>

      {/* Ajouter plus tard */}
      <div className="rounded-2xl p-5" style={{ background: '#F5F5F5' }}>
        <label className="flex items-start cursor-pointer gap-3">
          <input
            type="checkbox"
            checked={addDocumentLater}
            onChange={(e) => {
              setAddDocumentLater(e.target.checked);
              if (e.target.checked) setDocumentFile(null);
            }}
            className="h-5 w-5 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded mt-0.5 flex-shrink-0"
          />
          <div>
            <p className="text-sm font-semibold text-gray-900">
              J&apos;ajouterai mes documents plus tard
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Vous pourrez uploader vos documents depuis votre profil après inscription.
            </p>
            <p className="text-xs text-gray-500">
              Vous ne pourrez lancer votre première campagne une fois tous les documents téléchargés
              et validés.
            </p>
          </div>
        </label>
      </div>

      {/* Upload zone */}
      {!addDocumentLater && (
        <div className="space-y-4">
          <div
            className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center"
            style={{ background: '#FAFAFA' }}
          >
            <Upload className="h-10 w-10 text-gray-400 mx-auto mb-4" />
            <h4 className="font-medium text-gray-900 mb-1">
              Ajouter votre Registre du Commerce / Patente...
            </h4>
            <p className="text-xs text-gray-500 mb-5">
              Formats acceptés : PDF, JPG, JPEG, PNG (Max 5 MB)
            </p>
            <label className="inline-block cursor-pointer px-6 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Parcourir les fichiers
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    if (e.target.files[0].size > 5 * 1024 * 1024) {
                      toast.error('Fichier trop volumineux (max 5 MB)');
                      return;
                    }
                    setDocumentFile(e.target.files[0]);
                  }
                }}
              />
            </label>
          </div>
          {documentFile && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-900 text-sm">{documentFile.name}</p>
                  <p className="text-xs text-green-700">
                    {(documentFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDocumentFile(null)}
                className="flex items-center px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm"
              >
                <X className="h-4 w-4 mr-1" />
                Retirer
              </button>
            </div>
          )}
        </div>
      )}

      {/* CGU checkboxes */}
      <div className="space-y-4 pt-2">
        <label className="flex items-start cursor-pointer gap-3">
          <input
            type="checkbox"
            checked={formData.terms_accepted}
            onChange={(e) => setFormData({ ...formData, terms_accepted: e.target.checked })}
            className="h-5 w-5 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-gray-700">
            J&apos;accepte{' '}
            <a href="/terms" className="text-gray-900 font-medium underline underline-offset-2">
              les conditions générales d&apos;utilisation
            </a>
          </span>
        </label>
        <label className="flex items-start cursor-pointer gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-gray-500">
            En validant mon inscription, je certifie être autorisé(e) à inscrire cette entreprise
            sur Toodooh, et à engager des dépenses publicitaires en son nom
          </span>
        </label>
      </div>
    </div>
  );

  /* ═══════ Render ═══════ */
  const stepContent = () => {
    switch (currentStep) {
      case 0:
        return renderProfileSelection();
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        if (selectedProfileType === 'fleet_owner') return renderEtablissement();
        return renderStep3();
      case 4:
        return isOwner ? renderCoordonneesBancaires() : renderStep4();
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 flex flex-col px-4 py-8">
      {stepContent()}

      {/* Footer buttons */}
      {currentStep === 3 && selectedProfileType === 'fleet_owner' ? (
        <div className="max-w-3xl mx-auto w-full mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={goPrev}
            className="py-3.5 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 transition-all"
          >
            Retour
          </button>
          <button
            type="button"
            onClick={addFleetEstablishment}
            disabled={!isFleetDraftValid()}
            className="py-3.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: '#00B3A6' }}
          >
            Ajouter
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext()}
            className="py-3.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: '#76E6AB' }}
          >
            Suivant
          </button>
        </div>
      ) : (
        <div className="max-w-3xl mx-auto w-full mt-8 flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (currentStep === 0) navigate('/login');
              else goPrev();
            }}
            className="flex-1 py-3.5 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 transition-all"
          >
            {currentStep === 0 ? 'Annuler' : 'Retour'}
          </button>

          {currentStep < 4 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canGoNext()}
              className="flex-1 py-3.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#76E6AB' }}
            >
              Suivant
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                loading || !formData.terms_accepted || (isOwner && !ownerCertificationAccepted)
              }
              className="flex-1 py-3.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#76E6AB' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                  Inscription...
                </span>
              ) : (
                'Créer mon compte'
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
