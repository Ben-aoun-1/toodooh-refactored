import React from 'react';
import { Monitor, MapPin, Crosshair, TrendingUp } from 'lucide-react';

const CARREFOUR_LOGO = 'https://back.carrefour.tn/media/logos/logo_car_25.png';

/**
 * Widgets identiques au bloc « Diffusez votre spot publicitaire sur une même enseigne » du Dashboard.
 */
function EnseigneWidgets() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm flex flex-col"
        >
          <div className="flex items-center gap-3 mb-3">
            <img
              src={CARREFOUR_LOGO}
              alt="Carrefour"
              className="w-10 h-10 rounded-lg object-contain flex-shrink-0 bg-white"
            />
            <span className="font-semibold text-gray-900">Carrefour</span>
          </div>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 mb-2">
            <span className="flex items-center gap-1.5">
              <Monitor className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
              32 écrans
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
              12 établissements
            </span>
          </div>
          <div className="mb-3">
            <span className="inline-flex px-2.5 py-1 rounded-full bg-gray-200 text-gray-700 text-xs font-medium">
              Sport
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500">
                <Crosshair className="h-3 w-3 flex-shrink-0 text-gray-500" />
                <span>CIBLE DOMINANTE</span>
              </div>
              <p className="text-xs font-medium text-gray-900 mt-0.5">18 - 35 ans</p>
            </div>
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500">
                <TrendingUp className="h-3 w-3 text-[#7e51f5] flex-shrink-0" />
                <span>IMPRESSIONS</span>
              </div>
              <p className="text-xs font-semibold text-gray-900 tabular-nums mt-0.5">145 000</p>
            </div>
          </div>
          <div className="flex pt-4 mt-auto border-t border-gray-200 -mx-5 px-5">
            <button
              type="button"
              className="w-full py-2.5 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              Diffuser sur ce parc
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Page Parcs TV — mêmes widgets que « Diffusez votre spot… » du Dashboard.
 */
export default function Parcs() {
  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Introduction */}
      <div className="bg-white rounded-xl p-6 sm:p-8 shadow-sm">
        <p className="text-base text-gray-900 leading-relaxed">
          Bienvenue dans les PARCS TV : ici, vous choisissez non pas un écran mais un réseau entier
          d'établissements appartenant à une même enseigne. Votre message accompagne les clients
          dans leurs lieux de fréquentation habituels, créant une exposition répétée et naturelle.
        </p>
      </div>

      {/* Nos enseignes partenaires — mêmes widgets que Dashboard « Diffusez votre spot… » */}
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-gray-50/50 min-h-[24px]">
          <h2 className="text-lg font-normal leading-6 text-gray-900">Nos enseignes partenaires</h2>
        </div>
        <div className="p-5">
          <EnseigneWidgets />
        </div>
      </div>

      {/* Conclusion */}
      <div className="bg-white rounded-xl p-6 sm:p-8 shadow-sm">
        <p className="text-base text-gray-900 leading-relaxed">
          Grâce à notre moteur intelligent, tous les écrans actifs du réseau sont automatiquement
          intégrés pour maximiser l'impact, garantir une cohérence de diffusion et renforcer
          durablement la mémorisation de votre marque auprès d'une audience fidèle et hautement
          qualifiée.
        </p>
      </div>
    </div>
  );
}
