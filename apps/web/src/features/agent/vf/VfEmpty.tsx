import { VfIcon, type VfIconKey } from './VfIcon';

/** AGENT-VF — the prototype's empty state: a soft icon tile above one sentence. */
export function VfEmpty({ icon, text }: { icon: VfIconKey; text: string }) {
  return (
    <div className="empty">
      <div className="ei">
        <VfIcon k={icon} size={24} />
      </div>
      {text}
    </div>
  );
}
