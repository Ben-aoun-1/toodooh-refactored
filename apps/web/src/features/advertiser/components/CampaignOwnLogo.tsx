import { useProfileLogo } from '@/features/advertiser/hooks/useProfileLogo';

/**
 * The Screencaster's logo at the top of one of his campaign cards — the same white frame, in the
 * same spot, as the advertiser's logo on the Agent's campaign cards (VfCampCard's frame). Renders
 * NOTHING while no logo is set: the card stays exactly as it was.
 */
export default function CampaignOwnLogo() {
  const { data: logo } = useProfileLogo();
  if (!logo?.url) return null;
  return (
    <div className="mb-4 grid h-[132px] place-items-center overflow-hidden rounded-[18px] border border-gray-200 bg-white">
      <img
        src={logo.url}
        alt="Logo de l’annonceur"
        className="max-h-16 max-w-[78%] object-contain"
      />
    </div>
  );
}
