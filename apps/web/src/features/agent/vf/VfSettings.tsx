import { useSearchParams } from 'react-router-dom';

import { useAgentAccount, useAgentProfile } from '@/features/agent/hooks/useAgentAccount';
import {
  SETTINGS_SIDE,
  SETTINGS_TABS,
  settingsEntryOf,
  settingsTabOfEntry,
} from '@/features/agent/lib/agent-shell';

import { VfIcon } from './VfIcon';
import {
  VfCgePanel,
  VfLegalPanel,
  VfNotifPanel,
  VfPasswordPanel,
  VfProfilePanel,
  VfRibPanel,
} from './VfSettingsPanels';

/**
 * AGENT-VF (spec VF « Paramètres ») — the four tabs on top, the left panel with the entries of
 * the tab (« Mes coordonnées bancaires » and the CGE each have theirs), the form on the right.
 * Deep-linkable (`?tab=`), so each step of « Finalisez votre compte » opens its entry.
 */
export function VfSettings() {
  const [params, setParams] = useSearchParams();
  const entry = settingsEntryOf(params.get('tab'));
  const tab = settingsTabOfEntry(entry);
  const side = SETTINGS_SIDE[tab];
  const account = useAgentAccount();
  const profile = useAgentProfile();
  const p = profile.data;
  const a = account.data;
  // The forms restart from the saved values whenever these change.
  const version = p ? JSON.stringify(p) : '';

  return (
    <div className="card">
      <div className="stabs">
        {SETTINGS_TABS.map((t) => (
          <button
            type="button"
            key={t.key}
            className={tab === t.key ? 'on' : undefined}
            onClick={() => setParams({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sset">
        <div className="sside">
          <div className="t">{side.title}</div>
          {side.entries.map((e) => (
            <button
              type="button"
              key={e.key}
              className={entry === e.key ? 'on' : undefined}
              onClick={() => setParams({ tab: e.key })}
            >
              <VfIcon k={e.icon} size={16} />
              {e.label}
            </button>
          ))}
        </div>
        <div className="sform">
          {p && a && (
            <>
              {entry === 'profil' && <VfProfilePanel key={version} profile={p} />}
              {entry === 'legal' && <VfLegalPanel key={version} profile={p} />}
              {entry === 'rib' && <VfRibPanel rib={a.rib} />}
              {entry === 'notifications' && (
                <VfNotifPanel
                  key={version}
                  profile={p}
                  noun={a.role === 'screenhost_agent' ? 'Screenhosts' : 'Screencasters'}
                />
              )}
              {entry === 'securite' && <VfPasswordPanel />}
              {entry === 'cge' && <VfCgePanel profile={p} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
