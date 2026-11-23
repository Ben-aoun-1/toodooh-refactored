import type { ReactNode } from 'react';

import '@/features/network/styles/network.css';
import '@/features/network/styles/network-extra.css';

/**
 * RESEAU-1 — the root of the two network pages. The outer block cancels the advertiser shell's
 * content padding so the prototype's paper background runs edge to edge; everything inside `.rsx`
 * is styled by the ported stylesheet only.
 */
export default function NetworkShell({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 lg:-my-8">
      <div className="rsx">{children}</div>
    </div>
  );
}
