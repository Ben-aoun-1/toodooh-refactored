import {
  Upload,
  CheckCircle,
  X,
  SkipForward,
  ArrowRight,
  ArrowLeft,
  User,
  Building2,
  FileText,
  Megaphone,
  BarChart3,
  Settings,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import React, { useEffect, useState, useRef } from 'react';
import { toast } from 'react-hot-toast';

import AnimatedLogo from '../components/AnimatedLogo';
import { supabase } from '../lib/supabase';
import { authService } from '../services/auth.service';
import { useAuthStore } from '../stores/auth.store';
import type { BusinessProfile } from '../types/auth';

interface OnboardingModalProps {
  onComplete: () => void;
  onClose: () => void;
}

interface OnboardingStep {
  id: number;
  title: string;
  subtitle: string;
  icon: React.ComponentType<any>;
  content: React.ReactNode;
}

export default function OnboardingModal({ onComplete, onClose: _onClose }: OnboardingModalProps) {
  const user = useAuthStore((state) => state.user);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false); // ✅ État séparé pour la soumission
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [regUrl, setRegUrl] = useState<string | null>(null);
  const [cinFile, setCinFile] = useState<File | null>(null);
  const [cinUrl, setCinUrl] = useState<string | null>(null);
  const [uploadingCin, setUploadingCin] = useState(false);
  const [addLater, setAddLater] = useState(false); // Checkbox "Ajouter plus tard"
  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const onCompleteRef = useRef(onComplete);
  const hasCheckedOnboardingRef = useRef(false);

  // Mettre à jour la ref quand onComplete change
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const totalSteps = 5;

  // Fonction pour fermer l'onboarding (X en haut à droite)
  const handleBypass = async () => {
    // ✅ Tous les documents sont maintenant facultatifs, on peut fermer et terminer l'onboarding
    try {
      await handleSubmit();
    } catch (error) {
      console.error('❌ Erreur lors de la finalisation:', error);
      toast.error('Erreur lors de la finalisation');
    }
  };

  // Fonction pour réessayer sans refresh
  const handleRetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authService.getBusinessProfile();
      setProfile(data);
      setRegUrl(data?.registration_doc_url || null);
    } catch (error) {
      console.error('Erreur lors du retry:', error);
      setError('Erreur lors du chargement du profil');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const fetchProfile = async () => {
      // Éviter les appels multiples
      if (loading || initialized || hasCheckedOnboardingRef.current || !user?.id) return;

      // Vérifier d'abord le localStorage pour éviter les requêtes inutiles
      const onboardingCompletedLocal = localStorage.getItem('onboardingCompleted') === 'true';
      if (onboardingCompletedLocal) {
        hasCheckedOnboardingRef.current = true;
        setInitialized(true);
        onCompleteRef.current();
        return;
      }

      try {
        setLoading(true);
        hasCheckedOnboardingRef.current = true;

        // Utiliser directement Supabase pour contourner les RLS
        const { data: existingProfile, error: supabaseError } = await supabase
          .from('business_profiles')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingProfile && !supabaseError) {
          // ⚠️ IMPORTANT: L'onboarding est terminé si onboarding_completed = true
          if (existingProfile.onboarding_completed === true) {
            localStorage.setItem('onboardingCompleted', 'true');
            onCompleteRef.current();
            return;
          }

          setProfile(existingProfile);
          setRegUrl(existingProfile.registration_doc_url || null);
          setCinUrl(existingProfile.cin_doc_url || null);
          setError(null);
        } else {
          console.warn('⚠️ Aucun business_profile trouvé, tentative de rattrapage...');
          await authService.createDefaultProfile(user.id, user.email || '');

          const { data: repairedProfile, error: repairedError } = await supabase
            .from('business_profiles')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (repairedError || !repairedProfile) {
            setProfile(null);
            setError('Aucun profil trouvé dans la base de données');
          } else {
            setProfile(repairedProfile);
            setRegUrl(repairedProfile.registration_doc_url || null);
            setCinUrl(repairedProfile.cin_doc_url || null);
            setError(null);
            toast.success('Profil récupéré automatiquement.');
          }
        }
      } catch (error) {
        console.error('Error in fetchProfile:', error);
        setProfile(null);
        setError('Erreur lors du chargement du profil');
        hasCheckedOnboardingRef.current = false; // Réessayer en cas d'erreur
      } finally {
        setLoading(false);
        setInitialized(true);
      }
    };

    // N'appeler fetchProfile que si on a un user et qu'on n'est pas déjà initialisé
    if (user?.id && !initialized) {
      fetchProfile();
    }
  }, [user?.id, initialized]); // Retirer onComplete des dépendances

  // Gestion de la touche Échap pour fermer l'onboarding
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBypass();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleCinFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setCinFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file || !user) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      // Le chemin ne doit PAS inclure le nom du bucket (il est déjà dans .from('registres'))
      const filePath = `${user.id}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('registres')
        .upload(filePath, file);

      if (uploadError) {
        console.error('❌ Erreur upload:', uploadError);
        throw uploadError;
      }


      // Créer une URL signée (valide pendant 7 jours = 604800 secondes)
      // Pour un bucket privé, on utilise createSignedUrl au lieu de getPublicUrl
      const { data: signedData, error: signedError } = await supabase.storage
        .from('registres')
        .createSignedUrl(filePath, 604800); // 7 jours

      if (signedError || !signedData) {
        console.error('❌ Erreur création URL signée:', signedError);
        throw signedError || new Error("Impossible de créer l'URL signée");
      }


      // Mettre à jour le profil avec l'URL signée du registre
      const { error: updateError } = await supabase
        .from('business_profiles')
        .update({ registration_doc_url: signedData.signedUrl })
        .eq('user_id', user.id);

      if (updateError) {
        console.error('❌ Erreur mise à jour profil:', updateError);
        throw updateError;
      }


      setRegUrl(signedData.signedUrl);
      toast.success('✅ Registre de commerce ajouté avec succès !');
    } catch (error: any) {
      console.error("❌ Erreur lors de l'upload du registre:", error);
      toast.error(`❌ Erreur lors de l'upload: ${error.message || 'Erreur inconnue'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleCinUpload = async () => {
    if (!cinFile || !user) return;
    setUploadingCin(true);
    try {
      const ext = cinFile.name.split('.').pop();
      const filePath = `cin_${user.id}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('registres')
        .upload(filePath, cinFile);

      if (uploadError) {
        console.error('❌ Erreur upload:', uploadError);
        throw uploadError;
      }


      // Créer une URL signée
      const { data: signedData, error: signedError } = await supabase.storage
        .from('registres')
        .createSignedUrl(filePath, 604800); // 7 jours

      if (signedError || !signedData) {
        console.error('❌ Erreur création URL signée:', signedError);
        throw signedError || new Error("Impossible de créer l'URL signée");
      }


      // Mettre à jour le profil avec l'URL signée du CIN
      const { error: updateError } = await supabase
        .from('business_profiles')
        .update({ cin_doc_url: signedData.signedUrl })
        .eq('user_id', user.id);

      if (updateError) {
        console.error('❌ Erreur mise à jour profil:', updateError);
        throw updateError;
      }


      setCinUrl(signedData.signedUrl);
      toast.success('✅ Document CIN ajouté avec succès !');
    } catch (error: any) {
      console.error("❌ Erreur lors de l'upload du CIN:", error);
      toast.error(`❌ Erreur lors de l'upload: ${error.message || 'Erreur inconnue'}`);
    } finally {
      setUploadingCin(false);
    }
  };

  const nextStep = () => {

    // ✅ Tous les documents sont maintenant facultatifs ou peuvent être ajoutés plus tard
    // Aucune validation nécessaire à l'étape 3

    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    } else {
      handleSubmit(); // Appeler handleSubmit au lieu de handleBypass
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const skipStep = () => {

    // ✅ Tous les documents sont maintenant facultatifs, toutes les étapes peuvent être passées

    nextStep();
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error('Utilisateur non connecté');
      return;
    }

    // ✅ Tous les documents sont maintenant facultatifs
    // Aucune validation nécessaire avant de terminer l'onboarding

    try {
      setSubmitting(true); // ✅ Utiliser submitting au lieu de loading

      // Mettre à jour onboarding_completed dans la base de données
      const { error: updateError } = await supabase
        .from('business_profiles')
        .update({
          onboarding_completed: true,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (updateError) {
        console.error('❌ Erreur lors de la mise à jour de onboarding_completed:', updateError);
        throw updateError;
      }


      // Marquer l'onboarding comme terminé dans le localStorage
      localStorage.setItem('onboardingCompleted', 'true');


      // ✅ Afficher le toast de succès
      toast.success(
        "✅ Inscription terminée avec succès ! Votre compte sera activé après validation par l'administrateur.",
      );

      // ✅ Attendre que le toast soit visible
      await new Promise((resolve) => setTimeout(resolve, 500));

      // ✅ Désactiver le submitting
      setSubmitting(false);

      // ✅ Attendre un peu avant de fermer pour que l'utilisateur voie le changement
      await new Promise((resolve) => setTimeout(resolve, 300));

      // ✅ Fermer le modal en dernier
      onComplete();
    } catch (error) {
      console.error('❌ Erreur lors de la soumission:', error);
      toast.error('❌ Erreur lors de la soumission. Veuillez réessayer.');
      setSubmitting(false); // ✅ Réinitialiser submitting en cas d'erreur
      // NE PAS marquer comme terminé en cas d'erreur
    }
  };

  // Définition des étapes de l'onboarding
  const steps: OnboardingStep[] = [
    {
      id: 1,
      title: 'Bienvenue sur Toodooh !',
      subtitle: 'Votre plateforme de publicité digitale',
      icon: Sparkles,
      content: (
        <div className="text-center space-y-6">
          <div className="w-32 h-20 mx-auto mb-6 flex items-center justify-center">
            <AnimatedLogo size={120} />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Bienvenue,{' '}
            {profile?.business_name ||
              profile?.contact_name ||
              user?.email?.split('@')[0] ||
              'Utilisateur'}{' '}
            ! 👋
          </h2>
          <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
            Nous sommes ravis de vous accueillir sur Toodooh, votre plateforme complète pour créer,
            gérer et optimiser vos campagnes publicitaires digitales.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="bg-[#00B3A6] bg-opacity-10 w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-3">
                <Megaphone className="h-6 w-6 text-[#00B3A6]" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Campagnes Publicitaires</h3>
              <p className="text-sm text-gray-600">
                Créez et gérez vos campagnes avec des outils puissants
              </p>
            </div>
            <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="bg-blue-500 bg-opacity-10 w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-3">
                <BarChart3 className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Analytics Avancées</h3>
              <p className="text-sm text-gray-600">Suivez vos performances en temps réel</p>
            </div>
            <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="bg-purple-500 bg-opacity-10 w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-3">
                <Settings className="h-6 w-6 text-purple-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Gestion Simplifiée</h3>
              <p className="text-sm text-gray-600">Interface intuitive et moderne</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 2,
      title: 'Votre Profil Entreprise',
      subtitle: 'Informations de base',
      icon: Building2,
      content: (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-[#00B3A6] to-[#008C82] p-6 rounded-xl text-white shadow-sm">
            <h3 className="text-xl font-bold mb-2">Profil Temporaire</h3>
            <p className="opacity-90">
              Votre profil a été créé avec des informations temporaires. Vous pourrez le compléter
              plus tard.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center mb-4">
                <div className="bg-[#00B3A6] bg-opacity-10 p-2 rounded-lg mr-3">
                  <User className="h-5 w-5 text-[#00B3A6]" />
                </div>
                <h4 className="font-semibold text-gray-900">Informations Personnelles</h4>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Nom & Prénom</p>
                  <p className="font-medium text-gray-900">
                    {profile?.contact_name || 'Non défini'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Raison sociale</p>
                  <p className="font-medium text-gray-900">
                    {profile?.business_name || 'Non définie'}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center mb-4">
                <div className="bg-blue-500 bg-opacity-10 p-2 rounded-lg mr-3">
                  <Building2 className="h-5 w-5 text-blue-600" />
                </div>
                <h4 className="font-semibold text-gray-900">Informations Entreprise</h4>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Raison sociale</p>
                  <p className="font-medium text-gray-900">
                    {profile?.business_name || 'Non définie'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Type de profil</p>
                  <p className="font-medium text-gray-900">
                    {profile?.profile_type === 'advertiser' ? 'Annonceur' : profile?.profile_type}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-[#00B3A6] bg-opacity-5 border border-[#00B3A6] border-opacity-30 rounded-xl p-4">
            <div className="flex items-start">
              <Star className="h-5 w-5 text-[#00B3A6] mr-3 mt-0.5" />
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">Prochaine étape</h4>
                <p className="text-sm text-gray-700">
                  Vous pourrez compléter votre profil et ajouter vos documents légaux depuis votre
                  tableau de bord.
                </p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 3,
      title: 'Documents Légaux',
      subtitle:
        profile?.profile_type === 'individual_owner'
          ? 'Document CIN (facultatif)'
          : profile?.profile_type === 'fleet_owner'
            ? 'Registre de commerce (facultatif)'
            : 'Registre de commerce (obligatoire)',
      icon: FileText,
      content: (
        <div className="space-y-6">
          <div className="text-center mb-8">
            <div
              className={`w-16 h-16 bg-gradient-to-br rounded-full flex items-center justify-center mx-auto mb-4 ${
                profile?.profile_type === 'individual_owner'
                  ? 'from-blue-100 to-blue-200'
                  : 'from-red-100 to-red-200'
              }`}
            >
              <FileText
                className={`h-8 w-8 ${
                  profile?.profile_type === 'individual_owner' ? 'text-blue-600' : 'text-red-600'
                }`}
              />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Documents Légaux</h3>
            <p className="text-gray-600 max-w-2xl mx-auto">
              {profile?.profile_type === 'individual_owner' ? (
                <>
                  <span className="text-blue-600 font-semibold">ℹ️ Document facultatif :</span> En
                  tant que propriétaire individuel, vous pouvez fournir votre document CIN
                  maintenant ou le cocher "Ajouter plus tard" pour l'ajouter depuis votre profil.
                </>
              ) : profile?.profile_type === 'fleet_owner' ? (
                <>
                  <span className="text-blue-600 font-semibold">ℹ️ Document facultatif :</span> En
                  tant que propriétaire de parc, vous pouvez fournir votre registre de commerce
                  maintenant ou cocher "Ajouter plus tard" pour l'ajouter depuis votre profil.
                </>
              ) : (
                <>
                  <span className="text-orange-600 font-semibold">⚠️ Document recommandé :</span> En
                  tant qu'annonceur, le registre de commerce est recommandé. Vous pouvez cocher
                  "Ajouter plus tard" pour l'ajouter depuis votre profil.
                </>
              )}
            </p>
          </div>

          {/* Checkbox "Ajouter plus tard" */}
          <div className="flex items-center justify-center mb-4">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={addLater}
                onChange={(e) => setAddLater(e.target.checked)}
                className="h-5 w-5 text-[#00B3A6] focus:ring-[#00B3A6] border-gray-300 rounded"
              />
              <span className="ml-3 text-sm font-medium text-gray-700">
                ✓ Ajouter plus tard depuis mon profil
              </span>
            </label>
          </div>

          {/* Afficher l'upload seulement si "Ajouter plus tard" n'est pas coché */}
          {!addLater && (
            <>
              {/* Pour les propriétaires individuels : upload CIN */}
              {profile?.profile_type === 'individual_owner' &&
                (cinUrl ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center">
                        <CheckCircle className="h-6 w-6 text-green-600 mr-3" />
                        <h4 className="font-semibold text-green-900">
                          Document CIN ajouté avec succès !
                        </h4>
                      </div>
                    </div>
                    <a
                      href={cinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-700 underline hover:text-green-800 inline-flex items-center"
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Voir le document CIN
                    </a>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
                      <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <h4 className="font-semibold text-gray-900 mb-2">
                        Ajouter votre document CIN
                      </h4>
                      <p className="text-gray-600 mb-4">Formats acceptés : PDF, JPG, JPEG, PNG</p>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={handleCinFileChange}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#00B3A6] file:text-white hover:file:bg-[#008C82] cursor-pointer"
                      />
                    </div>

                    {cinFile && (
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <FileText className="h-5 w-5 text-blue-600 mr-3" />
                            <div>
                              <p className="font-medium text-blue-900">{cinFile.name}</p>
                              <p className="text-sm text-blue-700">
                                {(cinFile.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={handleCinUpload}
                            disabled={uploadingCin}
                            className="px-4 py-2 bg-[#00B3A6] text-white rounded-lg font-semibold hover:bg-[#008C82] transition-all disabled:opacity-50 shadow-sm"
                          >
                            {uploadingCin ? 'Envoi...' : 'Uploader'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

              {/* Pour les propriétaires de parc et annonceurs : upload RNE */}
              {(profile?.profile_type === 'fleet_owner' ||
                profile?.profile_type === 'advertiser') &&
                (regUrl ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center">
                        <CheckCircle className="h-6 w-6 text-green-600 mr-3" />
                        <h4 className="font-semibold text-green-900">
                          Document ajouté avec succès !
                        </h4>
                      </div>
                      <button
                        onClick={async () => {
                          if (!user) return;

                          const confirmDelete = window.confirm(
                            '⚠️ Êtes-vous sûr de vouloir supprimer ce document ?\n\n' +
                              'Vous devrez uploader un nouveau registre de commerce pour terminer votre inscription.',
                          );

                          if (!confirmDelete) return;

                          try {

                            // Extraire le nom du fichier de l'URL
                            // L'URL est du type: https://.../storage/v1/object/public/registres/FILENAME.pdf
                            // Ou: https://.../storage/v1/object/registres/FILENAME.pdf
                            let fileName = '';

                            if (regUrl.includes('/registres/')) {
                              // Extraire tout ce qui est après '/registres/'
                              const parts = regUrl.split('/registres/');
                              if (parts.length > 1) {
                                fileName = parts[1];
                              }
                            } else {
                              // Fallback : prendre le dernier élément de l'URL
                              fileName = regUrl.split('/').pop() || '';
                            }


                            if (!fileName) {
                              console.error("❌ Impossible d'extraire le nom du fichier de l'URL");
                              throw new Error("Impossible d'extraire le nom du fichier");
                            }

                            // Supprimer le fichier du storage
                            const { error: deleteError, data: deleteData } = await supabase.storage
                              .from('registres')
                              .remove([fileName]);


                            if (deleteError) {
                              console.error(
                                '❌ Erreur lors de la suppression du fichier:',
                                deleteError,
                              );
                              console.error('   Code:', deleteError.message);
                              // On continue quand même pour supprimer l'URL de la DB
                            } else {
                            }

                            // IMPORTANT : Toujours mettre à jour le profil (supprimer l'URL)
                            // Même si le fichier n'existe pas dans le storage
                            const { error: updateError } = await supabase
                              .from('business_profiles')
                              .update({
                                registration_doc_url: null,
                                onboarding_completed: false, // Réinitialiser aussi l'onboarding
                              })
                              .eq('user_id', user.id);

                            if (updateError) {
                              console.error('❌ Erreur mise à jour profil:', updateError);
                              throw updateError;
                            }


                            setRegUrl(null);
                            setFile(null);
                            toast.success(
                              '✅ Document supprimé avec succès. Vous pouvez uploader un nouveau fichier.',
                            );
                          } catch (error: any) {
                            console.error('❌ Erreur lors de la suppression:', error);
                            toast.error(
                              `❌ Erreur lors de la suppression: ${error.message || 'Erreur inconnue'}`,
                            );
                          }
                        }}
                        className="flex items-center px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors border border-red-300"
                        title="Supprimer ce document"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Supprimer
                      </button>
                    </div>
                    <a
                      href={regUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-700 underline hover:text-green-800 inline-flex items-center"
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Voir le registre de commerce
                    </a>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
                      <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <h4 className="font-semibold text-gray-900 mb-2">
                        Ajouter votre registre de commerce
                      </h4>
                      <p className="text-gray-600 mb-4">Formats acceptés : PDF, JPG, JPEG, PNG</p>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={handleFileChange}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#00B3A6] file:text-white hover:file:bg-[#008C82] cursor-pointer"
                      />
                    </div>

                    {file && (
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <FileText className="h-5 w-5 text-blue-600 mr-3" />
                            <div>
                              <p className="font-medium text-blue-900">{file.name}</p>
                              <p className="text-sm text-blue-700">
                                {(file.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={handleUpload}
                            disabled={uploading}
                            className="px-4 py-2 bg-[#00B3A6] text-white rounded-lg font-semibold hover:bg-[#008C82] transition-all disabled:opacity-50 shadow-sm"
                          >
                            {uploading ? 'Envoi...' : 'Uploader'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </>
          )}

          {/* Message d'information selon le statut */}
          <div
            className={`border rounded-xl p-4 ${
              (profile?.profile_type === 'individual_owner' && cinUrl) ||
              ((profile?.profile_type === 'fleet_owner' ||
                profile?.profile_type === 'advertiser') &&
                regUrl) ||
              addLater
                ? 'bg-green-50 border-green-200'
                : 'bg-blue-50 border-blue-200'
            }`}
          >
            <div className="flex items-start">
              <Zap
                className={`h-5 w-5 mr-3 mt-0.5 ${
                  (profile?.profile_type === 'individual_owner' && cinUrl) ||
                  ((profile?.profile_type === 'fleet_owner' ||
                    profile?.profile_type === 'advertiser') &&
                    regUrl) ||
                  addLater
                    ? 'text-green-600'
                    : 'text-blue-600'
                }`}
              />
              <div>
                <h4
                  className={`font-semibold mb-1 ${
                    (profile?.profile_type === 'individual_owner' && cinUrl) ||
                    ((profile?.profile_type === 'fleet_owner' ||
                      profile?.profile_type === 'advertiser') &&
                      regUrl) ||
                    addLater
                      ? 'text-green-900'
                      : 'text-blue-900'
                  }`}
                >
                  {addLater
                    ? '✅ Vous ajouterez le document plus tard'
                    : (profile?.profile_type === 'individual_owner' && cinUrl) ||
                        ((profile?.profile_type === 'fleet_owner' ||
                          profile?.profile_type === 'advertiser') &&
                          regUrl)
                      ? '✅ Document ajouté'
                      : 'ℹ️ Document facultatif'}
                </h4>
                <p
                  className={`text-sm ${
                    (profile?.profile_type === 'individual_owner' && cinUrl) ||
                    ((profile?.profile_type === 'fleet_owner' ||
                      profile?.profile_type === 'advertiser') &&
                      regUrl) ||
                    addLater
                      ? 'text-green-700'
                      : 'text-blue-700'
                  }`}
                >
                  {addLater
                    ? "Vous pourrez ajouter votre document depuis votre profil après avoir terminé l'onboarding."
                    : profile?.profile_type === 'individual_owner' && cinUrl
                      ? 'Votre document CIN a été ajouté avec succès.'
                      : (profile?.profile_type === 'fleet_owner' ||
                            profile?.profile_type === 'advertiser') &&
                          regUrl
                        ? 'Votre registre de commerce a été ajouté avec succès.'
                        : 'Vous pouvez uploader votre document maintenant ou cocher "Ajouter plus tard" pour continuer.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 4,
      title: 'Découvrez la Plateforme',
      subtitle: 'Fonctionnalités principales',
      icon: Megaphone,
      content: (
        <div className="space-y-8">
          <div className="text-center mb-8">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Fonctionnalités Principales</h3>
            <p className="text-gray-600">Découvrez les outils puissants à votre disposition</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-[#00B3A6] bg-opacity-10 rounded-lg flex items-center justify-center mr-4">
                  <Megaphone className="h-6 w-6 text-[#00B3A6]" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">Nouvelle Campagne</h4>
                  <p className="text-sm text-gray-600">Créez votre première campagne</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-700">
                <li>• Interface intuitive de création</li>
                <li>• Templates prédéfinis</li>
                <li>• Personnalisation avancée</li>
              </ul>
            </div>

            <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-green-500 bg-opacity-10 rounded-lg flex items-center justify-center mr-4">
                  <BarChart3 className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">Mes Campagnes</h4>
                  <p className="text-sm text-gray-600">Gérez vos campagnes existantes</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-700">
                <li>• Vue d'ensemble de toutes vos campagnes</li>
                <li>• Modifier, suspendre, supprimer</li>
                <li>• Historique complet</li>
              </ul>
            </div>

            <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-purple-500 bg-opacity-10 rounded-lg flex items-center justify-center mr-4">
                  <User className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">Mon Profil</h4>
                  <p className="text-sm text-gray-600">Complétez vos informations</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-700">
                <li>• Informations entreprise</li>
                <li>• Documents légaux</li>
                <li>• Paramètres de compte</li>
              </ul>
            </div>

            <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-orange-500 bg-opacity-10 rounded-lg flex items-center justify-center mr-4">
                  <Settings className="h-6 w-6 text-orange-600" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">Recharges</h4>
                  <p className="text-sm text-gray-600">Gérez votre budget</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-700">
                <li>• Historique des recharges</li>
                <li>• Factures et reçus</li>
                <li>• Gestion du solde</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 5,
      title: "C'est parti !",
      subtitle: 'Vous êtes prêt à commencer',
      icon: Star,
      content: (
        <div className="text-center space-y-8">
          <div className="w-24 h-24 bg-gradient-to-br from-[#00B3A6] to-[#008C82] rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
            <Star className="h-12 w-12 text-white" />
          </div>

          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Félicitations ! 🎉</h2>
            <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
              Votre compte est maintenant configuré et vous êtes prêt à créer votre première
              campagne publicitaire sur Toodooh !
            </p>
          </div>

          <div className="bg-gradient-to-r from-[#00B3A6] to-[#008C82] p-8 rounded-xl shadow-sm">
            <h3 className="text-xl font-bold mb-6 text-white">Prochaines étapes recommandées :</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center bg-white bg-opacity-10 backdrop-blur-sm p-4 rounded-lg">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl font-bold text-[#00B3A6]">1</span>
                </div>
                <h4 className="font-semibold mb-2 text-white">Compléter votre profil</h4>
                <p className="text-sm opacity-90 text-white">Ajoutez vos informations complètes</p>
              </div>
              <div className="text-center bg-white bg-opacity-10 backdrop-blur-sm p-4 rounded-lg">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl font-bold text-[#00B3A6]">2</span>
                </div>
                <h4 className="font-semibold mb-2 text-white">Créer votre première campagne</h4>
                <p className="text-sm opacity-90 text-white">Lancez-vous avec un template</p>
              </div>
              <div className="text-center bg-white bg-opacity-10 backdrop-blur-sm p-4 rounded-lg">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-xl font-bold text-[#00B3A6]">3</span>
                </div>
                <h4 className="font-semibold mb-2 text-white">Explorer les analytics</h4>
                <p className="text-sm opacity-90 text-white">Suivez vos performances</p>
              </div>
            </div>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-xl p-6">
            <div className="flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600 mr-3" />
              <p className="text-green-800 font-medium">
                Votre compte est maintenant actif et prêt à l'emploi !
              </p>
            </div>
          </div>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 relative">
          <button
            onClick={() => {
              handleBypass();
            }}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors bg-white rounded-full p-2 shadow-lg hover:shadow-xl z-10"
            title="Passer l'onboarding"
          >
            <X size={24} />
          </button>
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#00B3A6] mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!profile && error) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl p-8 text-center max-w-md w-full relative">
          <button
            onClick={() => {
              handleBypass();
            }}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors bg-white rounded-full p-2 shadow-lg hover:shadow-xl"
            title="Passer l'onboarding"
          >
            <X size={24} />
          </button>

          <div className="mb-6">
            <X className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">Erreur de chargement</h3>
            <p className="text-gray-600 mb-6">{error}</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => {
                handleBypass();
              }}
              className="w-full px-6 py-3 bg-[#00B3A6] text-white rounded-lg font-semibold hover:bg-[#008C82] transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <SkipForward size={20} />
              Passer l'onboarding
            </button>
            <button
              onClick={handleRetry}
              className="w-full px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-all"
            >
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentStepData = steps[currentStep - 1];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full h-[90vh] flex flex-col">
        {/* Header avec progression */}
        <div className="bg-gradient-to-r from-[#00B3A6] to-[#008C82] p-6 text-white flex-shrink-0 rounded-t-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <div className="bg-white bg-opacity-20 p-2 rounded-lg mr-3">
                <currentStepData.icon className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{currentStepData.title}</h1>
                <p className="text-white text-opacity-90">{currentStepData.subtitle}</p>
              </div>
            </div>
            <button
              onClick={() => {
                handleBypass();
              }}
              className="text-white text-opacity-80 hover:text-opacity-100 transition-all p-2 hover:bg-white hover:bg-opacity-10 rounded-lg"
              title="Passer l'onboarding"
            >
              <X size={24} />
            </button>
          </div>

          {/* Barre de progression */}
          <div className="w-full bg-white bg-opacity-20 rounded-full h-2">
            <div
              className="bg-white h-2 rounded-full transition-all duration-300 shadow-sm"
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-sm mt-2 text-white text-opacity-90">
            <span>
              Étape {currentStep} sur {totalSteps}
            </span>
            <span>{Math.round((currentStep / totalSteps) * 100)}%</span>
          </div>
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto p-8">{currentStepData.content}</div>

        {/* Footer avec navigation */}
        <div className="border-t border-gray-200 p-6 bg-gray-50 flex-shrink-0 rounded-b-2xl">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                prevStep();
              }}
              disabled={currentStep === 1}
              className="flex items-center px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Précédent
            </button>

            <div className="flex items-center space-x-3">
              {/* Bouton "Passer" - Toujours visible à l'étape 3 car tout est facultatif ou peut être ajouté plus tard */}
              {currentStep < totalSteps && (
                <button
                  onClick={() => {
                    skipStep();
                  }}
                  className="px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-all"
                >
                  Passer
                </button>
              )}

              {/* Bouton "Suivant/Terminer" - Toujours actif car documents sont facultatifs ou "Ajouter plus tard" */}
              <button
                onClick={() => {
                  nextStep();
                }}
                disabled={submitting}
                className={`flex items-center px-8 py-3 rounded-lg font-semibold transition-all shadow-sm ${
                  submitting
                    ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                    : 'bg-[#00B3A6] text-white hover:bg-[#008C82]'
                }`}
              >
                {submitting ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5 mr-2"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    En cours...
                  </>
                ) : (
                  <>
                    {currentStep === totalSteps ? 'Terminer' : 'Suivant'}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
