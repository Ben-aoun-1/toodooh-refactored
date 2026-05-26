import {
  User,
  Building2,
  MapPin,
  Lock,
  CheckCircle,
  Save,
  ArrowLeft,
  Upload,
  FileText,
  X,
} from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

import { useBusinessProfile } from '@/features/auth/hooks/useBusinessProfile';
import { useGovernorates } from '@/features/auth/hooks/useGovernorates';
import { useOwnerProfileMutations } from '@/features/auth/hooks/useOwnerProfileMutations';
import { useSectors } from '@/features/auth/hooks/useSectors';
import { useAuthStore } from '@/features/auth/stores/auth.store';
import OwnerNavigation from '@/features/screenhost/components/OwnerNavigation';
import { getErrorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'MyAccount' });

const steps = [
  { id: 1, title: 'Profil', icon: User },
  { id: 2, title: 'Entreprise', icon: Building2 },
  { id: 3, title: 'Adresse', icon: MapPin },
  { id: 4, title: 'Validation', icon: CheckCircle },
];

export default function MyAccount() {
  const navigate = useNavigate();
  const { user, profileType, needsApproval, validationStatus, refreshUserStatus } = useAuthStore();
  const isDisabled = needsApproval && validationStatus === 'pending';
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [documentFile, setDocumentFile] = useState<File | null>(null);

  const { profile, loading } = useBusinessProfile(user?.id);
  const { data: sectors = [] } = useSectors();
  const { data: governorates = [] } = useGovernorates();
  const profileMutations = useOwnerProfileMutations(user?.id);

  // Données du formulaire
  const [formData, setFormData] = useState({
    // Informations personnelles
    firstName: '',
    lastName: '',
    email: '',
    phone: '',

    // Informations entreprise
    businessName: '',
    taxNumber: '',
    businessSectorId: '',
    businessType: 'local' as 'local' | 'national' | 'agency' | 'event_organizer',

    // Adresse
    streetAddress: '',
    city: '',
    postalCode: '',
    governorateId: '',

    // Documents
    registrationDocUrl: '',
    formule: '', // Formule choisie par le propriétaire
    termsAccepted: true,
  });

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  // Pré-remplit le formulaire avec le profil chargé.
  useEffect(() => {
    if (!profile) return;
    setFormData({
      firstName: profile.contact_name?.split(' ')[0] || '',
      lastName: profile.contact_name?.split(' ').slice(1).join(' ') || '',
      email: user?.email || '',
      phone: profile.contact_phone || '',
      businessName: profile.business_name || '',
      taxNumber: profile.tax_number || '',
      businessSectorId: profile.business_sector_id || '',
      businessType:
        (profile.business_type as 'local' | 'national' | 'agency' | 'event_organizer') || 'local',
      streetAddress: profile.street_address || '',
      city: profile.city || '',
      postalCode: profile.postal_code || '',
      governorateId: profile.governorate_id || '',
      registrationDocUrl: profile.registration_doc_url || '',
      formule: profile.formule || '',
      termsAccepted: true,
    });
  }, [profile, user]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const nextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleUploadDocument = async () => {
    if (!documentFile || !user) {
      toast.error('Veuillez sélectionner un fichier');
      return;
    }

    try {
      await profileMutations.uploadDocument.mutateAsync({
        file: documentFile,
        isIndividualOwner: profileType === 'individual_owner',
      });
      setDocumentFile(null);
      toast.success('✅ Document uploadé avec succès !');
    } catch (error) {
      toast.error(`❌ Erreur lors de l'upload: ${getErrorMessage(error) || 'Erreur inconnue'}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Phase-1f F6 — no-old password change removed from MyAccount: the backend correctly requires the
    // current password (re-auth, D4) — a no-old change has no endpoint. The proper path is the
    // OwnerSettings → Confidentialité change form (with current password).

    setSaving(true);

    try {
      // Mettre à jour le profil
      const updateData = {
        business_name: formData.businessName,
        tax_number: formData.taxNumber,
        business_sector_id: formData.businessSectorId,
        business_type: formData.businessType,
        contact_name: `${formData.firstName} ${formData.lastName}`,
        contact_phone: formData.phone,
        street_address: formData.streetAddress,
        city: formData.city,
        postal_code: formData.postalCode,
        governorate_id: formData.governorateId,
        registration_doc_url: formData.registrationDocUrl,
      };

      await profileMutations.updateBusinessProfile.mutateAsync(updateData);

      // Phase-1f F6 — password change moved to OwnerSettings (the with-old change has the current
      // password, the only path the backend supports). MyAccount no longer touches the password.

      toast.success('Profil mis à jour avec succès');

      // Rafraîchir le statut de session (la mutation invalide déjà le profil).
      await refreshUserStatus();

      // Demander confirmation avant de quitter
      const shouldLeave = window.confirm(
        'Profil mis à jour avec succès ! Voulez-vous retourner au tableau de bord ?',
      );
      if (shouldLeave) {
        navigate('/owner-dashboard');
      }
    } catch (error) {
      log.error({ error }, '❌ Erreur lors de la mise à jour');
      log.error(
        {
          message: error instanceof Error ? error.message : 'Erreur inconnue',
          stack: error instanceof Error ? error.stack : undefined,
        },
        "Détails de l'erreur",
      );
      toast.error(
        `Erreur lors de la mise à jour du profil: ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const isFieldDisabled = (field: string) => {
    // Champs non modifiables selon le profil
    const disabledFields = {
      individual_owner: ['businessType', 'taxNumber', 'registrationDocUrl'],
      fleet_owner: ['businessType', 'taxNumber', 'registrationDocUrl'],
    };

    return disabledFields[profileType as keyof typeof disabledFields]?.includes(field) || false;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-brand-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement du profil...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen">
        <OwnerNavigation isDisabled={isDisabled} />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => navigate('/owner-dashboard')}
                    className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                      <User className="h-6 w-6 text-brand-primary mr-2" />
                      Mon Compte
                    </h1>
                    <p className="text-sm text-gray-600 mt-1">
                      Gérez vos informations personnelles et professionnelles
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {/* Progress Steps */}
              <div className="mb-8">
                <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                  <div className="flex items-center justify-between">
                    {steps.map((step, index) => (
                      <div key={step.id} className="flex items-center">
                        <div
                          className={`flex items-center justify-center w-10 h-10 rounded-full ${
                            currentStep >= step.id
                              ? 'bg-brand-primary text-brand-deep'
                              : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          <step.icon className="h-5 w-5" />
                        </div>
                        {index < steps.length - 1 && (
                          <div
                            className={`w-16 h-1 mx-2 ${
                              currentStep > step.id ? 'bg-brand-primary' : 'bg-gray-200'
                            }`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between mt-2">
                    {steps.map((step) => (
                      <span
                        key={step.id}
                        className={`text-xs ${
                          currentStep >= step.id ? 'text-brand-primary' : 'text-gray-500'
                        }`}
                      >
                        {step.title}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Step 1: Profil */}
                {currentStep === 1 && (
                  <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                    <h3 className="text-xl font-bold text-gray-900 mb-6">
                      Informations Personnelles
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 mb-2"
                          htmlFor="first-name"
                        >
                          Prénom
                        </label>
                        <input
                          type="text"
                          value={formData.firstName}
                          onChange={(e) => handleInputChange('firstName', e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                          placeholder="Votre prénom"
                          required
                          id="first-name"
                        />
                      </div>
                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 mb-2"
                          htmlFor="last-name"
                        >
                          Nom
                        </label>
                        <input
                          type="text"
                          value={formData.lastName}
                          onChange={(e) => handleInputChange('lastName', e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                          placeholder="Votre nom"
                          required
                          id="last-name"
                        />
                      </div>
                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 mb-2"
                          htmlFor="email"
                        >
                          Email
                        </label>
                        <input
                          type="email"
                          value={formData.email}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-500 cursor-not-allowed"
                          disabled
                          id="email"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          L'email ne peut pas être modifié
                        </p>
                      </div>
                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 mb-2"
                          htmlFor="phone"
                        >
                          Téléphone
                        </label>
                        <input
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => handleInputChange('phone', e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                          placeholder="+216 XX XXX XXX"
                          required
                          id="phone"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Entreprise */}
                {currentStep === 2 && (
                  <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                    <h3 className="text-xl font-bold text-gray-900 mb-6">
                      Informations Entreprise
                    </h3>
                    <div className="space-y-6">
                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 mb-2"
                          htmlFor="business-name"
                        >
                          Nom de l'entreprise
                        </label>
                        <input
                          type="text"
                          value={formData.businessName}
                          onChange={(e) => handleInputChange('businessName', e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                          placeholder="Nom de votre entreprise"
                          required
                          id="business-name"
                        />
                      </div>

                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 mb-2"
                          htmlFor="business-type"
                        >
                          Type d'entreprise
                        </label>
                        <select
                          value={formData.businessType}
                          onChange={(e) => handleInputChange('businessType', e.target.value)}
                          disabled={isFieldDisabled('businessType')}
                          className={`w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary ${
                            isFieldDisabled('businessType')
                              ? 'bg-gray-50 text-gray-500 cursor-not-allowed'
                              : 'bg-white'
                          }`}
                          id="business-type"
                        >
                          <option value="local">Local</option>
                          <option value="national">National</option>
                          <option value="agency">Agence</option>
                          <option value="event_organizer">Organisateur d'événements</option>
                        </select>
                        {isFieldDisabled('businessType') && (
                          <p className="text-xs text-gray-500 mt-1">
                            Ce champ ne peut pas être modifié
                          </p>
                        )}
                      </div>

                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 mb-2"
                          htmlFor="business-sector-id"
                        >
                          Secteur d'activité
                        </label>
                        <select
                          value={formData.businessSectorId}
                          onChange={(e) => handleInputChange('businessSectorId', e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                          required
                          id="business-sector-id"
                        >
                          <option value="">Sélectionner un secteur</option>
                          {sectors.map((sector) => (
                            <option key={sector.id} value={sector.id}>
                              {sector.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 mb-2"
                          htmlFor="tax-number"
                        >
                          Numéro fiscal
                        </label>
                        <input
                          type="text"
                          value={formData.taxNumber}
                          onChange={(e) => handleInputChange('taxNumber', e.target.value)}
                          disabled={isFieldDisabled('taxNumber')}
                          className={`w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary ${
                            isFieldDisabled('taxNumber')
                              ? 'bg-gray-50 text-gray-500 cursor-not-allowed'
                              : 'bg-white'
                          }`}
                          placeholder="Numéro fiscal de l'entreprise"
                          id="tax-number"
                        />
                        {isFieldDisabled('taxNumber') && (
                          <p className="text-xs text-gray-500 mt-1">
                            Ce champ ne peut pas être modifié
                          </p>
                        )}
                      </div>

                      {/* Affichage de la formule pour les propriétaires */}
                      {(profileType === 'individual_owner' || profileType === 'fleet_owner') &&
                        formData.formule && (
                          <div>
                            <span className="block text-sm font-medium text-gray-700 mb-2">
                              Formule choisie
                            </span>
                            <div className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-900">
                              <div className="flex items-center">
                                <span className="text-2xl mr-3">
                                  {formData.formule === 'loyer' && '💰'}
                                  {formData.formule === 'abonnement' && '📺'}
                                  {formData.formule === 'revenue_share' && '🤝'}
                                </span>
                                <span className="font-medium">
                                  {formData.formule === 'loyer' && 'Formule Loyer'}
                                  {formData.formule === 'abonnement' && 'Formule Abonnement'}
                                  {formData.formule === 'revenue_share' && 'Formule Revenue share'}
                                </span>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              Cette formule a été sélectionnée lors de votre inscription
                            </p>
                          </div>
                        )}
                    </div>
                  </div>
                )}

                {/* Step 3: Adresse */}
                {currentStep === 3 && (
                  <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                    <h3 className="text-xl font-bold text-gray-900 mb-6">Adresse</h3>
                    <div className="space-y-6">
                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 mb-2"
                          htmlFor="street-address"
                        >
                          Adresse
                        </label>
                        <input
                          type="text"
                          value={formData.streetAddress}
                          onChange={(e) => handleInputChange('streetAddress', e.target.value)}
                          className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                          placeholder="Adresse complète"
                          required
                          id="street-address"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-2"
                            htmlFor="city"
                          >
                            Ville
                          </label>
                          <input
                            type="text"
                            value={formData.city}
                            onChange={(e) => handleInputChange('city', e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                            placeholder="Ville"
                            required
                            id="city"
                          />
                        </div>

                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-2"
                            htmlFor="postal-code"
                          >
                            Code postal
                          </label>
                          <input
                            type="text"
                            value={formData.postalCode}
                            onChange={(e) => handleInputChange('postalCode', e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                            placeholder="XXXX"
                            required
                            id="postal-code"
                          />
                        </div>

                        <div>
                          <label
                            className="block text-sm font-medium text-gray-700 mb-2"
                            htmlFor="governorate-id"
                          >
                            Gouvernorat
                          </label>
                          <select
                            value={formData.governorateId}
                            onChange={(e) => handleInputChange('governorateId', e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                            required
                            id="governorate-id"
                          >
                            <option value="">Sélectionner un gouvernorat</option>
                            {governorates.map((governorate) => (
                              <option key={governorate.id} value={governorate.id}>
                                {governorate.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 4: Validation */}
                {currentStep === 4 && (
                  <div className="space-y-6">
                    {/* Documents légaux */}
                    <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                      <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
                        <FileText className="h-6 w-6 text-brand-primary mr-2" />
                        Documents légaux
                      </h3>

                      {profileType === 'individual_owner' ? (
                        <div>
                          <p className="text-sm text-gray-600 mb-4">
                            Votre document CIN (Carte d'Identité Nationale)
                          </p>

                          {profile?.cin_doc_url ? (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <FileText className="h-8 w-8 text-green-600" />
                                  <div>
                                    <p className="font-medium text-green-900">
                                      Document CIN enregistré
                                    </p>
                                    <p className="text-sm text-green-700">
                                      Votre document a été uploadé avec succès
                                    </p>
                                  </div>
                                </div>
                                <a
                                  href={profile.cin_doc_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                                >
                                  Voir le document
                                </a>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                              <p className="text-sm text-orange-800 mb-4">
                                📄 Aucun document CIN enregistré. Uploadez votre CIN pour compléter
                                votre profil.
                              </p>

                              <div className="space-y-3">
                                <div className="flex items-center space-x-3">
                                  <label className="flex-1">
                                    <div className="flex items-center justify-center px-4 py-3 border-2 border-dashed border-brand-primary rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                      <Upload className="h-5 w-5 text-brand-primary mr-2" />
                                      <span className="text-sm font-medium text-gray-700">
                                        {documentFile
                                          ? documentFile.name
                                          : 'Sélectionner un fichier CIN'}
                                      </span>
                                    </div>
                                    <input
                                      type="file"
                                      accept=".pdf,.jpg,.jpeg,.png"
                                      onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                          if (e.target.files[0].size > 5 * 1024 * 1024) {
                                            toast.error('Fichier trop volumineux (max 5 MB)');
                                            return;
                                          }
                                          setDocumentFile(e.target.files[0]);
                                        }
                                      }}
                                      className="hidden"
                                    />
                                  </label>

                                  {documentFile && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={handleUploadDocument}
                                        disabled={profileMutations.uploadDocument.isPending}
                                        className="px-4 py-3 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                                      >
                                        {profileMutations.uploadDocument.isPending
                                          ? 'Upload...'
                                          : 'Uploader'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDocumentFile(null)}
                                        className="p-3 text-gray-400 hover:text-gray-600 transition-colors"
                                      >
                                        <X className="h-5 w-5" />
                                      </button>
                                    </>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500">
                                  Formats acceptés : PDF, JPG, PNG (max 5 MB)
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm text-gray-600 mb-4">
                            Votre Registre National des Entreprises (RNE)
                          </p>

                          {profile?.registration_doc_url ? (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <FileText className="h-8 w-8 text-green-600" />
                                  <div>
                                    <p className="font-medium text-green-900">
                                      Registre de commerce enregistré
                                    </p>
                                    <p className="text-sm text-green-700">
                                      Votre document a été uploadé avec succès
                                    </p>
                                  </div>
                                </div>
                                <a
                                  href={profile.registration_doc_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                                >
                                  Voir le document
                                </a>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                              <p className="text-sm text-orange-800 mb-4">
                                📄 Aucun registre de commerce enregistré. Uploadez votre RNE pour
                                compléter votre profil.
                              </p>

                              <div className="space-y-3">
                                <div className="flex items-center space-x-3">
                                  <label className="flex-1">
                                    <div className="flex items-center justify-center px-4 py-3 border-2 border-dashed border-brand-primary rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                      <Upload className="h-5 w-5 text-brand-primary mr-2" />
                                      <span className="text-sm font-medium text-gray-700">
                                        {documentFile
                                          ? documentFile.name
                                          : 'Sélectionner un fichier RNE'}
                                      </span>
                                    </div>
                                    <input
                                      type="file"
                                      accept=".pdf,.jpg,.jpeg,.png"
                                      onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                          if (e.target.files[0].size > 5 * 1024 * 1024) {
                                            toast.error('Fichier trop volumineux (max 5 MB)');
                                            return;
                                          }
                                          setDocumentFile(e.target.files[0]);
                                        }
                                      }}
                                      className="hidden"
                                    />
                                  </label>

                                  {documentFile && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={handleUploadDocument}
                                        disabled={profileMutations.uploadDocument.isPending}
                                        className="px-4 py-3 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                                      >
                                        {profileMutations.uploadDocument.isPending
                                          ? 'Upload...'
                                          : 'Uploader'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDocumentFile(null)}
                                        className="p-3 text-gray-400 hover:text-gray-600 transition-colors"
                                      >
                                        <X className="h-5 w-5" />
                                      </button>
                                    </>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500">
                                  Formats acceptés : PDF, JPG, PNG (max 5 MB)
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Phase-1f F6 — password change moved to Paramètres → Confidentialité (the
                        with-old change is the only path the backend supports). */}
                    <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
                      <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
                        <Lock className="h-6 w-6 text-brand-primary mr-2" />
                        Sécurité
                      </h3>
                      <p className="text-sm text-gray-600">
                        Modifiez votre mot de passe dans Paramètres → Confidentialité et sécurité.
                      </p>
                    </div>
                  </div>
                )}

                {/* Navigation Buttons */}
                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={prevStep}
                    disabled={currentStep === 1}
                    className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Précédent
                  </button>

                  {currentStep < 4 ? (
                    <button
                      type="button"
                      onClick={nextStep}
                      className="px-6 py-3 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 transition-colors"
                    >
                      Suivant
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={saving}
                      className="px-6 py-3 bg-brand-primary text-brand-deep rounded-lg hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                    >
                      <Save className="h-5 w-5" />
                      <span>{saving ? 'Sauvegarde...' : 'Sauvegarder'}</span>
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
