import { BarChart3 } from 'lucide-react';

export default function AdvertiserPerformancePlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#E4F9EB] text-[#132B1B]">
        <BarChart3 className="h-10 w-10" strokeWidth={1.5} />
      </div>
      <h1 className="text-2xl font-semibold text-[#132B1B] mb-3 tracking-[-0.012em]">
        Mes performances
      </h1>
      <p className="max-w-md text-sm text-[#5C5C5C] leading-6">
        Cette page sera bientôt disponible. Vous pourrez y suivre vos campagnes, vos impressions et
        l&apos;affluence de vos écrans.
      </p>
    </div>
  );
}
