import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import logoFull from '../../assets/logo.png';
import SignUpForm from '../../components/auth/SignUpForm';

import profilIcon from '../../assets/inscrit/profil.png';
import responsableIcon from '../../assets/inscrit/responsable.png';
import responsableIconS from '../../assets/inscrit/responsables.png';
import entrepriseIcon from '../../assets/inscrit/entreprise.png';
import entrepriseIconS from '../../assets/inscrit/entreprises.png';
import adresseIcon from '../../assets/inscrit/adresse.png';
import adresseIconS from '../../assets/inscrit/adresses.png';
import documentIcon from '../../assets/inscrit/document.png';
import documentIconS from '../../assets/inscrit/documents.png';

const stepsDefault = [
  { id: 1, title: 'Profil', icon: profilIcon, iconSelected: profilIcon },
  { id: 2, title: 'Responsable', icon: responsableIcon, iconSelected: responsableIconS },
  { id: 3, title: 'Entreprise', icon: entrepriseIcon, iconSelected: entrepriseIconS },
  { id: 4, title: 'Adresse', icon: adresseIcon, iconSelected: adresseIconS },
  { id: 5, title: 'Documents', icon: documentIcon, iconSelected: documentIconS },
];

const stepsOwner = [
  { id: 1, title: 'Profil', icon: profilIcon, iconSelected: profilIcon },
  { id: 2, title: 'Responsable', icon: responsableIcon, iconSelected: responsableIconS },
  { id: 3, title: 'Entreprise', icon: entrepriseIcon, iconSelected: entrepriseIconS },
  { id: 4, title: 'Etablissement', icon: adresseIcon, iconSelected: adresseIconS },
  { id: 5, title: 'Coordonnées bancaires', icon: documentIcon, iconSelected: documentIconS },
];

const stepsIndividualOwner = [
  { id: 1, title: 'Profil', icon: profilIcon, iconSelected: profilIcon },
  { id: 2, title: 'Responsable', icon: responsableIcon, iconSelected: responsableIconS },
  { id: 3, title: 'Etablissement', icon: entrepriseIcon, iconSelected: entrepriseIconS },
  { id: 4, title: 'Adresse', icon: adresseIcon, iconSelected: adresseIconS },
  { id: 5, title: 'Coordonnées bancaires', icon: documentIcon, iconSelected: documentIconS },
];

export default function SignUp() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [profileType, setProfileType] = useState<string | null>(null);
  const isIndividualOwner = profileType === 'individual_owner';
  const isFleetOwner = profileType === 'fleet_owner';
  const stepsMeta = isIndividualOwner
    ? stepsIndividualOwner
    : isFleetOwner
      ? stepsOwner
      : stepsDefault;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header bar */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-3">
          {/* Logo */}
          <img src={logoFull} alt="Toodooh" className="h-10 w-auto object-contain flex-shrink-0" />

          {/* Stepper */}
          <nav className="hidden md:flex items-center gap-1">
            {stepsMeta.map((step, idx) => {
              const stepIndex = step.id - 1;
              const isActive = currentStep === stepIndex;
              const isDone = currentStep > stepIndex;
              const imgSrc = isActive || isDone ? step.iconSelected : step.icon;
              return (
                <React.Fragment key={step.id}>
                  <div className="flex items-center gap-1.5">
                    <img src={imgSrc} alt="" className="w-8 h-8 object-contain" />
                    <span
                      className={`text-sm whitespace-nowrap ${
                        isActive
                          ? 'font-semibold text-gray-900'
                          : isDone
                            ? 'font-medium text-[#00B3A6]'
                            : 'text-gray-400'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                  {idx < stepsMeta.length - 1 && (
                    <ChevronRight className="w-4 h-4 text-gray-300 mx-1 flex-shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
          </nav>

          {/* Login link */}
          <div className="flex items-center gap-2 text-sm text-gray-500 flex-shrink-0">
            <span className="hidden sm:inline">Déjà inscrit ?</span>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="px-4 py-1.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              Se connecter
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex flex-col">
        <SignUpForm
          currentStep={currentStep}
          onStepChange={setCurrentStep}
          onProfileTypeChange={setProfileType}
        />
      </main>
    </div>
  );
}
