import React from 'react';

import connexionImg from '../../../assets/connexion.png';
import logoFull from '../../../assets/logo.png';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle: string;
  wide?: boolean;
  noContainer?: boolean;
  /** Image décorative entre le logo et le titre. Par défaut connexion.png */
  decorativeImage?: string;
}

export default function AuthLayout({
  children,
  title,
  subtitle,
  wide = false,
  noContainer = false,
  decorativeImage,
}: AuthLayoutProps) {
  const decoSrc = decorativeImage ?? connexionImg;
  return (
    <div className="min-h-screen bg-white flex flex-col justify-center py-12 px-4">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <img src={logoFull} alt="Toodooh" className="h-14 w-auto object-contain" />
        </div>

        {/* Icône décorative */}
        <div className="flex justify-center mb-6">
          <img src={decoSrc} alt="" className="w-24 h-24 object-contain" />
        </div>

        {/* Titre + sous-titre */}
        <h2 className="text-center text-2xl font-bold text-gray-900">{title}</h2>
        <p className="mt-2 text-center text-sm text-gray-500">{subtitle}</p>
      </div>

      <div className={`mt-8 sm:mx-auto sm:w-full ${wide ? 'sm:max-w-6xl' : 'sm:max-w-md'}`}>
        {noContainer ? (
          <div className="px-2 sm:px-0">{children}</div>
        ) : wide ? (
          <div className="px-4 sm:px-6 lg:px-8">{children}</div>
        ) : (
          <div className="bg-white py-8 px-4 sm:px-10">{children}</div>
        )}
      </div>
    </div>
  );
}
