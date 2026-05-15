import { Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface GettingStartedSectionProps {
  hasRegistrationDocument: boolean;
  canRechargeAccount: boolean;
  canLaunchCampaign: boolean;
}

export default function GettingStartedSection({
  hasRegistrationDocument,
  canRechargeAccount,
  canLaunchCampaign,
}: GettingStartedSectionProps) {
  const navigate = useNavigate();

  return (
    <div className="mb-10 rounded-2xl border border-gray-200 bg-[#F8FAFC] p-5 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">Pour bien commencer</h2>
      <p className="text-sm text-gray-600 mt-1 mb-4">
        Suivez ces étapes pour configurer votre compte
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 flex items-start gap-4">
          {hasRegistrationDocument ? (
            <div className="w-10 h-10 rounded-full bg-[#60BA76] flex items-center justify-center flex-shrink-0">
              <Check className="h-5 w-5 text-white" strokeWidth={3} />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-[#EFF5F2] text-[#171717] flex items-center justify-center text-sm font-semibold flex-shrink-0">
              1
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-semibold text-gray-900">Complétez votre profil</h3>
            <p className="text-sm text-gray-600 mt-1">Uploadez votre registre de commerce</p>
            <button
              type="button"
              onClick={() => navigate('/profile?tab=entreprise&sub=documents')}
              disabled={hasRegistrationDocument}
              className={`mt-4 inline-flex items-center justify-center px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
                hasRegistrationDocument
                  ? 'bg-[#F2F4F7] text-[#98A2B3] cursor-not-allowed'
                  : 'bg-white border border-[#D0D5DD] text-[#344054] hover:bg-gray-50'
              }`}
            >
              {hasRegistrationDocument ? 'OK' : 'Upload'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 flex items-start gap-4">
          <div className="w-8 h-8 rounded-full bg-[#EFF5F2] text-[#171717] flex items-center justify-center text-sm font-semibold">
            2
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-semibold text-gray-900">Rechargez votre solde</h3>
            <p className="text-sm text-gray-600 mt-1">Ajoutez vos fonds pour vos campagnes</p>
            <button
              type="button"
              onClick={() => navigate('/my-recharges')}
              disabled={!canRechargeAccount}
              className={`mt-4 inline-flex items-center justify-center px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
                canRechargeAccount
                  ? 'bg-white border border-[#D0D5DD] text-[#344054] hover:bg-gray-50'
                  : 'bg-[#F2F4F7] text-[#98A2B3] cursor-not-allowed'
              }`}
            >
              Recharger
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 flex items-start gap-4">
          <div className="w-8 h-8 rounded-full bg-[#EFF5F2] text-[#171717] flex items-center justify-center text-sm font-semibold">
            3
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-semibold text-gray-900">Lancez une campagne</h3>
            <p className="text-sm text-gray-600 mt-1">Creez votre premiere campagne</p>
            <button
              type="button"
              onClick={() => navigate('/new-campaign')}
              disabled={!canLaunchCampaign}
              className={`mt-4 inline-flex items-center justify-center px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
                canLaunchCampaign
                  ? 'bg-white border border-[#D0D5DD] text-[#344054] hover:bg-gray-50'
                  : 'bg-[#F2F4F7] text-[#98A2B3] cursor-not-allowed'
              }`}
            >
              Commencer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
