import { Upload, FileText, X, Building2, MapPin, MoreVertical, Trash2 } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import cguScreencastersUrl from '@/assets/cgu/cgu-screencasters.pdf?url';
import cguScreenhostsUrl from '@/assets/cgu/cgu-screenhosts.pdf?url';
import inscriptionImg from '@/assets/inscription.png';
import adresseStepIcon from '@/assets/inscrit/adressex.png';
import agenceIcon from '@/assets/inscrit/agence.png';
import agenceIconS from '@/assets/inscrit/agences.png';
import annonceurIcon from '@/assets/inscrit/annonceur.png';
import annonceurIconS from '@/assets/inscrit/annonceurs.png';
import responsableStepIcon from '@/assets/inscrit/connexion.png';
import documentStepIcon from '@/assets/inscrit/documentx.png';
import individuelIcon from '@/assets/inscrit/individuel.png';
import individuelIconS from '@/assets/inscrit/individuels.png';
import parcIcon from '@/assets/inscrit/parc.png';
import parcIconS from '@/assets/inscrit/parcs.png';
import {
  AGENCY_BUSINESS_SECTOR_NAME,
  sectorsForAdvertiserAgencySignup,
} from '@/features/advertiser/constants/advertiserBusinessSectors';
import { authService } from '@/features/auth/services/auth.service';
import type {
  BusinessSector,
  Governorate,
  SignUpData,
  FleetEstablishmentInput,
} from '@/features/auth/types/auth';
import { isValidPassword, passwordChecks } from '@/features/auth/utils/password';
import { getErrorMessage } from '@/lib/errors';

type ProfileType = 'advertiser' | 'agency' | 'individual_owner' | 'fleet_owner';

// Advertiser/agency company-size options — hardcoded (Phase-1f D8): the legacy `company_size_options`
// seed; `company_size` is backend-stripped, so only the display/value string matters (owners use
// `parcCountOptions`).
const COMPANY_SIZE_OPTIONS = ['0 - 10', '10 - 50', '50 - 100', '100 - 500', '500 et plus'];

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

// P3 — a manually-typed coordinate string → a finite number, or undefined when blank/invalid
// (so an empty field is omitted from the payload rather than sent as NaN).
function parseCoord(v: string): number | undefined {
  const f = Number.parseFloat(v);
  return v.trim() && Number.isFinite(f) ? f : undefined;
}

export default function SignUpForm({ currentStep, onStepChange, onProfileTypeChange }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  // CGU viewer: role-specific terms shown in an in-page modal (no route change → wizard state survives).
  const [cguOpen, setCguOpen] = useState(false);
  const [showPassword, _setShowPassword] = useState(false);
  const [showConfirmPassword, _setShowConfirmPassword] = useState(false);
  const [sectors, setSectors] = useState<BusinessSector[]>([]);
  const [ownerSectors, setOwnerSectors] = useState<BusinessSector[]>([]);
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
  // P3 — optional screenhost geo + WiFi per fleet establishment (carried into the FleetRow on add).
  const [fleetDraftLatitude, setFleetDraftLatitude] = useState('');
  const [fleetDraftLongitude, setFleetDraftLongitude] = useState('');
  const [fleetDraftWifiSsid, setFleetDraftWifiSsid] = useState('');
  const [fleetDraftWifiPassword, setFleetDraftWifiPassword] = useState('');
  const [fleetMenuOpenId, setFleetMenuOpenId] = useState<string | null>(null);
  // P3 — optional screenhost geo + WiFi for the individual owner's single location (attached at submit).
  const [ownerLatitude, setOwnerLatitude] = useState('');
  const [ownerLongitude, setOwnerLongitude] = useState('');
  const [ownerWifiSsid, setOwnerWifiSsid] = useState('');
  const [ownerWifiPassword, setOwnerWifiPassword] = useState('');
  const [companyLogo, setCompanyLogo] = useState<File | null>(null);
  const [companyLogoPreview, setCompanyLogoPreview] = useState<string | null>(null);
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [fonction, setFonction] = useState('');
  const [emailConflict, setEmailConflict] = useState<string | null>(null);
  const [phoneConflict, setPhoneConflict] = useState<string | null>(null);
  // C5 (#8a): step-2 tax_number FORMAT error (mirrors phoneConflict). Uniqueness stays
  // submit-time/server-side — there is no availability endpoint.
  const [taxNumberError, setTaxNumberError] = useState<string | null>(null);
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
        const [sectorsData, ownerSectorsData, governoratesData] = await Promise.all([
          authService.getBusinessSectors(),
          authService.getOwnerBusinessSectors(),
          authService.getGovernorates(),
        ]);
        setSectors(sectorsData);
        setOwnerSectors(ownerSectorsData);
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
      setFleetDraftLatitude('');
      setFleetDraftLongitude('');
      setFleetDraftWifiSsid('');
      setFleetDraftWifiPassword('');
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

  const validatePassword = (pw: string) => isValidPassword(pw);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const normalizePhone = (value: string) => (value || '').replace(/\s+/g, '').trim();
  const isValidTunisiaPhone = (value: string) => /^\+216\d{8}$/.test(normalizePhone(value));
  // C5 (#8a): mirror the backend matricule rule (apps/api/src/validation/tax-number.ts).
  const isValidTaxNumber = (value: string) => /^[A-Za-z0-9/]{7,20}$/.test(value);
  const TAX_NUMBER_ERROR = 'Matricule invalide (7 à 20 caractères alphanumériques ou /).';
  const pwChecks = passwordChecks(formData.password || '');
  const pwHasUpper = pwChecks.upper;
  const pwHasDigit = pwChecks.digit;
  const pwHasMinLen = pwChecks.minLen;
  const pwMatch = Boolean(
    formData.password && confirmPassword && formData.password === confirmPassword,
  );

  // Sync contact_name from nom + prénom
  useEffect(() => {
    const fullName = `${firstName} ${lastName}`.trim();
    setFormData((prev) => ({ ...prev, contact_name: fullName }));
  }, [firstName, lastName]);

  // Phase-1f F2: format-only (the client-side email-existence oracle is removed — anti-enumeration,
  // class-b §4.1). Duplicates are handled server-side by the 201-generic signup; the wizard no longer
  // discloses "email taken" pre-submit. `emailConflict`/`phoneConflict` now carry FORMAT errors only.
  const validateUniqueCredentials = (
    showToast = true,
    scope: 'both' | 'email' | 'phone' = 'both',
  ): boolean => {
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

    if (checkEmail) setEmailConflict(null);
    if (checkPhone) setPhoneConflict(null);
    return true;
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
          !phoneConflict,
        );
      case 2:
        if (selectedProfileType === 'individual_owner') {
          return Boolean(
            etablissementName.trim() &&
            formData.tax_number?.trim() &&
            isValidTaxNumber(String(formData.tax_number || '')) &&
            formData.business_sector_id &&
            etablissementScreens &&
            etablissementRooms.trim(),
          );
        }
        return Boolean(
          formData.business_name?.trim() &&
          formData.tax_number?.trim() &&
          isValidTaxNumber(String(formData.tax_number || '')) &&
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
      // Format-only check now (the existence oracle is gone — duplicates are server-side 201-generic).
      if (!validateUniqueCredentials(true)) return;
      onStepChange(currentStep + 1);
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

  // P3 — "Utiliser ma position": prefill the lat/lng inputs from the browser. Manual entry stays the
  // baseline (geolocation needs HTTPS + user consent), so a denial/absence just keeps the fields empty.
  const fillLocation = (setLat: (v: string) => void, setLng: (v: string) => void) => {
    if (!('geolocation' in navigator)) {
      toast.error("La géolocalisation n'est pas disponible sur cet appareil");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        toast.success('Position détectée');
      },
      () => toast.error("Impossible d'obtenir votre position. Saisissez-la manuellement."),
      { enableHighAccuracy: true, timeout: 10000 },
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
      // P3 — optional geo + WiFi ("add later"); omitted when blank.
      latitude: parseCoord(fleetDraftLatitude),
      longitude: parseCoord(fleetDraftLongitude),
      wifi_ssid: fleetDraftWifiSsid.trim() || undefined,
      wifi_password: fleetDraftWifiPassword.trim() || undefined,
    };
    setFleetEstablishments((prev) => [...prev, row]);
    setFleetDraftName('');
    setFleetDraftScreens('');
    setFleetDraftRooms('');
    setFleetDraftStreet('');
    setFleetDraftCity('');
    setFleetDraftZone('');
    setFleetDraftGovernorate('');
    setFleetDraftLatitude('');
    setFleetDraftLongitude('');
    setFleetDraftWifiSsid('');
    setFleetDraftWifiPassword('');
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
        // P3 — individual_owner's single screenhost location/WiFi (optional). The service omits any
        // blank field; the endpoint only consumes these for the individual_owner role.
        latitude:
          selectedProfileType === 'individual_owner' ? parseCoord(ownerLatitude) : undefined,
        longitude:
          selectedProfileType === 'individual_owner' ? parseCoord(ownerLongitude) : undefined,
        wifi_ssid:
          selectedProfileType === 'individual_owner'
            ? ownerWifiSsid.trim() || undefined
            : undefined,
        wifi_password:
          selectedProfileType === 'individual_owner'
            ? ownerWifiPassword.trim() || undefined
            : undefined,
        fleet_establishments:
          selectedProfileType === 'fleet_owner' && fleetEstablishments.length > 0
            ? fleetEstablishments.map(({ id: _id, ...rest }) => rest)
            : undefined,
      };
      // Signup creates an unverified account (no auto-login) and returns the 201-generic — no logout
      // needed (there is no session). Land on the validation screen (slice-1 auth-bug-1) which guides
      // the user to the confirmation email + offers a resend; the email rides router state so that
      // screen's resend button can call send-verification-email. Verifying the link auto-logs in.
      await authService.signUp(signupDataWithFile);
      navigate('/signup-success', { state: { email: formData.email } });
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Une erreur inattendue');
    } finally {
      setLoading(false);
    }
  };

  /* ── render helpers ── */
  const inputClass =
    'w-full px-4 py-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-all text-sm text-gray-900 placeholder-gray-400';
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
          <label className={labelClass} htmlFor="signup-last-name">
            Nom <span className="text-red-500">*</span>
          </label>
          <input
            id="signup-last-name"
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
          <label className={labelClass} htmlFor="signup-first-name">
            Prénom <span className="text-red-500">*</span>
          </label>
          <input
            id="signup-first-name"
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
          <label className={labelClass} htmlFor="signup-fonction">
            Fonction <span className="text-red-500">*</span>
          </label>
          <input
            id="signup-fonction"
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
          <label className={labelClass} htmlFor="signup-email">
            Email professionnel <span className="text-red-500">*</span>
          </label>
          <input
            id="signup-email"
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
          <label className={labelClass} htmlFor="signup-phone">
            Téléphone <span className="text-red-500">*</span>
          </label>
          <input
            id="signup-phone"
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
          <label className={labelClass} htmlFor="signup-agent-code">
            CODE DE VOTRE {isOwner ? 'SCREENHOST' : 'SCREENCAST'} AGENT{' '}
            <span className="text-red-500">*</span>
          </label>
          <input
            id="signup-agent-code"
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
          <label className={labelClass} htmlFor="signup-password">
            Mot de passe <span className="text-red-500">*</span>
          </label>
          <input
            id="signup-password"
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
          <label className={labelClass} htmlFor="signup-confirm-password">
            Confirmer Mot de passe <span className="text-red-500">*</span>
          </label>
          <input
            id="signup-confirm-password"
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
            className={`w-4 h-4 rounded-full flex items-center justify-center ${pwHasUpper ? 'bg-brand-primary' : 'bg-gray-200'}`}
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
            className={`w-4 h-4 rounded-full flex items-center justify-center ${pwHasDigit ? 'bg-brand-primary' : 'bg-gray-200'}`}
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
            className={`w-4 h-4 rounded-full flex items-center justify-center ${pwHasMinLen ? 'bg-brand-primary' : 'bg-gray-200'}`}
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
            Minimum 10 caractères
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
              <label className={labelClass} htmlFor="etablissement-name">
                Nom de l&apos;établissement <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={etablissementName}
                onChange={(e) => setEtablissementName(e.target.value)}
                className={inputClass}
                placeholder="Nom de l'établissement"
                id="etablissement-name"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="tax-number">
                Matricule fiscal <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.tax_number}
                onChange={(e) => {
                  setTaxNumberError(null);
                  setFormData({ ...formData, tax_number: e.target.value });
                }}
                onBlur={() =>
                  setTaxNumberError(
                    formData.tax_number && !isValidTaxNumber(formData.tax_number)
                      ? TAX_NUMBER_ERROR
                      : null,
                  )
                }
                className={inputClass}
                placeholder="Matricule fiscal"
                id="tax-number"
              />
              {taxNumberError && <p className="text-xs text-red-600 mt-1">{taxNumberError}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="business-sector-id">
                Catégorie <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.business_sector_id}
                onChange={(e) => setFormData({ ...formData, business_sector_id: e.target.value })}
                className={inputClass}
                id="business-sector-id"
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
              <label className={labelClass} htmlFor="etablissement-screens">
                Nombre d&apos;écrans <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={etablissementScreens}
                onChange={(e) => setEtablissementScreens(e.target.value)}
                className={inputClass}
                id="etablissement-screens"
              >
                {screenOptions.map((o) => (
                  <option key={`io-${o.value || 'empty'}`} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="etablissement-rooms">
                Nombre de salles <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={etablissementRooms}
                onChange={(e) => setEtablissementRooms(e.target.value)}
                className={inputClass}
                placeholder="2"
                id="etablissement-rooms"
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
              <label className={labelClass} htmlFor="business-name">
                Nom de l&apos;entreprise <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.business_name}
                onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                className={inputClass}
                placeholder="Nom de l'entreprise"
                id="business-name"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="tax-number-2">
                Matricule fiscal <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.tax_number}
                onChange={(e) => {
                  setTaxNumberError(null);
                  setFormData({ ...formData, tax_number: e.target.value });
                }}
                onBlur={() =>
                  setTaxNumberError(
                    formData.tax_number && !isValidTaxNumber(formData.tax_number)
                      ? TAX_NUMBER_ERROR
                      : null,
                  )
                }
                className={inputClass}
                placeholder="Matricule fiscal"
                id="tax-number-2"
              />
              {taxNumberError && <p className="text-xs text-red-600 mt-1">{taxNumberError}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="signup-business-sector">
                Catégorie <span className="text-red-500">*</span>
              </label>
              {selectedProfileType === 'agency' ? (
                <>
                  <input
                    id="signup-business-sector"
                    type="text"
                    value="Agence de publicité"
                    readOnly
                    className={`${inputClass} bg-gray-100 text-gray-700 cursor-not-allowed`}
                  />
                  <input type="hidden" value={formData.business_sector_id || ''} />
                </>
              ) : (
                <select
                  id="signup-business-sector"
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
              <label className={labelClass} htmlFor="company-size">
                {isOwner ? "Nombre d'établissements de votre parc" : "Taille de l'entreprise"}{' '}
                <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.company_size || ''}
                onChange={(e) => setFormData({ ...formData, company_size: e.target.value })}
                className={inputClass}
                id="company-size"
              >
                <option value="">{isOwner ? '12' : 'Sélectionnez la taille'}</option>
                {(isOwner ? parcCountOptions : COMPANY_SIZE_OPTIONS).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="street-address">
              Adresse du siège <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.street_address}
              onChange={(e) => setFormData({ ...formData, street_address: e.target.value })}
              className={inputClass}
              placeholder="Adresse"
              id="street-address"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass} htmlFor="city">
                Ville <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className={inputClass}
                placeholder="Ville"
                id="city"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="zone">
                Zone <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.zone}
                onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
                className={inputClass}
                placeholder="1000"
                id="zone"
              />
            </div>
          </div>
          {selectedProfileType === 'fleet_owner' && (
            <div>
              <label className={labelClass} htmlFor="postal-code">
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
                id="postal-code"
              />
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="governorate-id">
              Gouvernorat <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={formData.governorate_id}
              onChange={(e) => setFormData({ ...formData, governorate_id: e.target.value })}
              className={inputClass}
              id="governorate-id"
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
          <label className={labelClass} htmlFor="etablissement-name-2">
            Nom de l&apos;établissement <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={etablissementName}
            onChange={(e) => setEtablissementName(e.target.value)}
            className={inputClass}
            placeholder="Nom de l'établissement"
            id="etablissement-name-2"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="etablissement-screens-2">
            Nombre d&apos;écrans <span className="text-red-500">*</span>
          </label>
          <select
            required
            value={etablissementScreens}
            onChange={(e) => setEtablissementScreens(e.target.value)}
            className={inputClass}
            id="etablissement-screens-2"
          >
            {screenOptions.map((o) => (
              <option key={o.value || 'empty'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="etablissement-rooms-2">
            Nombre de salles <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={etablissementRooms}
            onChange={(e) => setEtablissementRooms(e.target.value)}
            className={inputClass}
            placeholder="2"
            id="etablissement-rooms-2"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="street-address-2">
            Adresse <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={formData.street_address}
            onChange={(e) => setFormData({ ...formData, street_address: e.target.value })}
            className={inputClass}
            placeholder="Adresse"
            id="street-address-2"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass} htmlFor="city-2">
              Ville <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              className={inputClass}
              placeholder="Ville"
              id="city-2"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="zone-2">
              Zone <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.zone}
              onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
              className={inputClass}
              placeholder="Zone"
              id="zone-2"
            />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="governorate-id-2">
            Gouvernorat <span className="text-red-500">*</span>
          </label>
          <select
            required
            value={formData.governorate_id}
            onChange={(e) => setFormData({ ...formData, governorate_id: e.target.value })}
            className={inputClass}
            id="governorate-id-2"
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
          <label className={labelClass} htmlFor="fleet-draft-name">
            Nom de l&apos;établissement <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={fleetDraftName}
            onChange={(e) => setFleetDraftName(e.target.value)}
            className={inputClass}
            placeholder="Nom de l'établissement"
            id="fleet-draft-name"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="fleet-draft-screens">
            Nombre d&apos;écrans <span className="text-red-500">*</span>
          </label>
          <select
            value={fleetDraftScreens}
            onChange={(e) => setFleetDraftScreens(e.target.value)}
            className={inputClass}
            id="fleet-draft-screens"
          >
            {screenOptions.map((o) => (
              <option key={`f-${o.value || 'e'}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="fleet-draft-rooms">
            Nombre de salles <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={fleetDraftRooms}
            onChange={(e) => setFleetDraftRooms(e.target.value)}
            className={inputClass}
            placeholder="2"
            id="fleet-draft-rooms"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="fleet-draft-street">
            Adresse <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={fleetDraftStreet}
            onChange={(e) => setFleetDraftStreet(e.target.value)}
            className={inputClass}
            placeholder="Adresse"
            id="fleet-draft-street"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass} htmlFor="fleet-draft-city">
              Ville <span className="text-red-500">*</span>
            </label>
            <select
              value={fleetDraftCity}
              onChange={(e) => setFleetDraftCity(e.target.value)}
              className={inputClass}
              id="fleet-draft-city"
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
            <label className={labelClass} htmlFor="fleet-draft-zone">
              Zone <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={fleetDraftZone}
              onChange={(e) => setFleetDraftZone(e.target.value)}
              className={inputClass}
              placeholder="Zone ou code postal"
              id="fleet-draft-zone"
            />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="fleet-draft-governorate">
            Gouvernorat <span className="text-red-500">*</span>
          </label>
          <select
            value={fleetDraftGovernorate}
            onChange={(e) => setFleetDraftGovernorate(e.target.value)}
            className={inputClass}
            id="fleet-draft-governorate"
          >
            <option value="">Gouvernorat</option>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        {renderLocationWifiFields({
          idPrefix: 'fleet-draft',
          lat: fleetDraftLatitude,
          setLat: setFleetDraftLatitude,
          lng: fleetDraftLongitude,
          setLng: setFleetDraftLongitude,
          ssid: fleetDraftWifiSsid,
          setSsid: setFleetDraftWifiSsid,
          pw: fleetDraftWifiPassword,
          setPw: setFleetDraftWifiPassword,
        })}
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
        <label
          className="flex items-start cursor-pointer gap-3"
          aria-label="J'ajouterai mes coordonnées bancaires plus tard"
        >
          <input
            type="checkbox"
            checked={addBankLater}
            onChange={(e) => {
              setAddBankLater(e.target.checked);
              if (e.target.checked) setBankDocFile(null);
            }}
            className="h-5 w-5 text-brand-primary focus:ring-brand-primary border-gray-300 rounded mt-0.5 flex-shrink-0"
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
        {/* CGU trigger lives OUTSIDE the acceptance label: opening the terms must never toggle
            terms_accepted. The label wraps only the checkbox + "J'accepte" text. */}
        <div className="flex items-start gap-3">
          <input
            id="signup-terms-owner"
            type="checkbox"
            checked={formData.terms_accepted}
            onChange={(e) => setFormData({ ...formData, terms_accepted: e.target.checked })}
            className="h-5 w-5 text-brand-primary focus:ring-brand-primary border-gray-300 rounded mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-gray-700">
            <label htmlFor="signup-terms-owner" className="cursor-pointer">
              J&apos;accepte
            </label>{' '}
            <button
              type="button"
              onClick={() => setCguOpen(true)}
              className="text-gray-900 font-medium underline underline-offset-2"
            >
              les conditions générales d&apos;utilisation
            </button>
          </span>
        </div>
        <label className="flex items-start cursor-pointer gap-3">
          <input
            type="checkbox"
            checked={ownerCertificationAccepted}
            onChange={(e) => setOwnerCertificationAccepted(e.target.checked)}
            className="h-5 w-5 text-brand-primary focus:ring-brand-primary border-gray-300 rounded mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-gray-500">
            En validant mon inscription, je certifie être autorisé(e) à inscrire cet établissement
            sur Toodooh,
          </span>
        </label>
      </div>
    </div>
  );

  /* ═══════ Screenhost geo + WiFi capture (P3) — shared by the individual-owner address step and
     each fleet-establishment draft. Manual lat/lng is the baseline (works on HTTP); "Utiliser ma
     position" only prefills. Everything here is optional — nothing blocks submission. ═══════ */
  const renderLocationWifiFields = (opts: {
    idPrefix: string;
    lat: string;
    setLat: (v: string) => void;
    lng: string;
    setLng: (v: string) => void;
    ssid: string;
    setSsid: (v: string) => void;
    pw: string;
    setPw: (v: string) => void;
  }) => (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">Position et WiFi de l&apos;écran</p>
        <p className="text-xs text-gray-500 mt-1">
          Optionnel — cela aide nos techniciens à installer votre écran. Vous pourrez l&apos;ajouter
          ou le modifier plus tard depuis votre profil.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className={labelClass} htmlFor={`${opts.idPrefix}-lat`}>
            Latitude
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={opts.lat}
            onChange={(e) => opts.setLat(e.target.value)}
            className={inputClass}
            placeholder="36.8065"
            id={`${opts.idPrefix}-lat`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${opts.idPrefix}-lng`}>
            Longitude
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={opts.lng}
            onChange={(e) => opts.setLng(e.target.value)}
            className={inputClass}
            placeholder="10.1815"
            id={`${opts.idPrefix}-lng`}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => fillLocation(opts.setLat, opts.setLng)}
        className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
      >
        <MapPin className="w-4 h-4" />
        Utiliser ma position
      </button>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className={labelClass} htmlFor={`${opts.idPrefix}-wifi-ssid`}>
            Nom du réseau WiFi (SSID)
          </label>
          <input
            type="text"
            value={opts.ssid}
            onChange={(e) => opts.setSsid(e.target.value)}
            className={inputClass}
            placeholder="MonReseauWiFi"
            id={`${opts.idPrefix}-wifi-ssid`}
            autoComplete="off"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${opts.idPrefix}-wifi-password`}>
            Mot de passe WiFi
          </label>
          <input
            type="text"
            value={opts.pw}
            onChange={(e) => opts.setPw(e.target.value)}
            className={inputClass}
            placeholder="••••••••"
            id={`${opts.idPrefix}-wifi-password`}
            autoComplete="off"
          />
        </div>
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
          <label className={labelClass} htmlFor="street-address-3">
            Adresse <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={formData.street_address}
            onChange={(e) => setFormData({ ...formData, street_address: e.target.value })}
            className={inputClass}
            placeholder="123 Rue de la Paix"
            id="street-address-3"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="city-3">
            Ville <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            className={inputClass}
            placeholder="Tunis"
            id="city-3"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="postal-code-2">
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
            id="postal-code-2"
          />
        </div>
        {(selectedProfileType === 'fleet_owner' || selectedProfileType === 'individual_owner') && (
          <div className="md:col-span-2">
            <label className={labelClass} htmlFor="zone-3">
              Secteur/Zone <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={formData.zone}
              onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
              className={inputClass}
              id="zone-3"
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
          <label className={labelClass} htmlFor="governorate-id-3">
            Gouvernorat <span className="text-red-500">*</span>
          </label>
          <select
            required
            value={formData.governorate_id}
            onChange={(e) => setFormData({ ...formData, governorate_id: e.target.value })}
            className={inputClass}
            id="governorate-id-3"
          >
            <option value="">-- Choisissez --</option>
            {governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        {selectedProfileType === 'individual_owner' && (
          <div className="md:col-span-2">
            {renderLocationWifiFields({
              idPrefix: 'owner',
              lat: ownerLatitude,
              setLat: setOwnerLatitude,
              lng: ownerLongitude,
              setLng: setOwnerLongitude,
              ssid: ownerWifiSsid,
              setSsid: setOwnerWifiSsid,
              pw: ownerWifiPassword,
              setPw: setOwnerWifiPassword,
            })}
          </div>
        )}
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
        <label
          className="flex items-start cursor-pointer gap-3"
          aria-label="J'ajouterai mes documents plus tard"
        >
          <input
            type="checkbox"
            checked={addDocumentLater}
            onChange={(e) => {
              setAddDocumentLater(e.target.checked);
              if (e.target.checked) setDocumentFile(null);
            }}
            className="h-5 w-5 text-brand-primary focus:ring-brand-primary border-gray-300 rounded mt-0.5 flex-shrink-0"
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
        {/* CGU trigger lives OUTSIDE the acceptance label: opening the terms must never toggle
            terms_accepted. The label wraps only the checkbox + "J'accepte" text. */}
        <div className="flex items-start gap-3">
          <input
            id="signup-terms-advertiser"
            type="checkbox"
            checked={formData.terms_accepted}
            onChange={(e) => setFormData({ ...formData, terms_accepted: e.target.checked })}
            className="h-5 w-5 text-brand-primary focus:ring-brand-primary border-gray-300 rounded mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-gray-700">
            <label htmlFor="signup-terms-advertiser" className="cursor-pointer">
              J&apos;accepte
            </label>{' '}
            <button
              type="button"
              onClick={() => setCguOpen(true)}
              className="text-gray-900 font-medium underline underline-offset-2"
            >
              les conditions générales d&apos;utilisation
            </button>
          </span>
        </div>
        <label className="flex items-start cursor-pointer gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 text-brand-primary focus:ring-brand-primary border-gray-300 rounded mt-0.5 flex-shrink-0"
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
            className="py-3.5 rounded-xl font-semibold text-sm text-brand-deep transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: '#76E6AB' }}
          >
            Ajouter
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext()}
            className="py-3.5 rounded-xl font-semibold text-sm text-brand-deep transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
              className="flex-1 py-3.5 rounded-xl font-semibold text-sm text-brand-deep transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
              className="flex-1 py-3.5 rounded-xl font-semibold text-sm text-brand-deep transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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

      {cguOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Conditions générales d'utilisation"
        >
          <div className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Conditions générales d&apos;utilisation
                {isOwner ? ' — Screenhosts' : ' — Screencasters'}
              </h3>
              <button
                type="button"
                onClick={() => setCguOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <iframe
              src={isOwner ? cguScreenhostsUrl : cguScreencastersUrl}
              title="Conditions générales d'utilisation"
              className="h-full w-full flex-1"
            />
            <div className="flex justify-end border-t border-gray-200 px-6 py-3">
              <button
                type="button"
                onClick={() => setCguOpen(false)}
                className="rounded-lg bg-brand-primary px-5 py-2 text-sm font-semibold text-brand-deep transition-colors hover:bg-brand-primary/90"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
