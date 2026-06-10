import { MapPin } from 'lucide-react';

import type { AgentClient } from '@/features/agent/services/agent-clients.service';
import {
  type ReferenceLookup,
  clientDetailRows,
  clientDisplayName,
  profileTypeLabel,
  screenhostDetailRows,
  statusLabel,
} from '@/features/agent/utils/client-display';

interface AgentClientCardProps {
  client: AgentClient;
  governorates: ReferenceLookup;
  sectors: ReferenceLookup;
}

// Badge palettes mirror admin UserManagement so the same status/type reads identically across
// the two back-offices.
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

const TYPE_BADGE: Record<string, string> = {
  individual_owner: 'bg-blue-100 text-blue-800',
  fleet_owner: 'bg-purple-100 text-purple-800',
  advertiser: 'bg-orange-100 text-orange-800',
  agency: 'bg-cyan-100 text-cyan-800',
};

const badge = (classes: string, text: string) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}
  >
    {text}
  </span>
);

/**
 * P2 — one referred client. Renders every field the API returns (rows built by the pure
 * view-model in utils/client-display); screenhost owners additionally get their location blocks.
 * Read-only: no actions, no documents (absent from the payload by API design).
 */
export default function AgentClientCard({ client, governorates, sectors }: AgentClientCardProps) {
  return (
    <li className="px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900">{clientDisplayName(client)}</h3>
        {badge(
          TYPE_BADGE[client.profile_type ?? ''] ?? 'bg-gray-100 text-gray-700',
          profileTypeLabel(client.profile_type),
        )}
        {badge(
          STATUS_BADGE[client.status] ?? 'bg-gray-100 text-gray-700',
          statusLabel(client.status),
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
        {clientDetailRows(client, governorates, sectors).map(({ label, value }) => (
          <div key={label}>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>

      {client.screenhosts.length > 0 && (
        <div className="mt-4 space-y-3">
          {client.screenhosts.map((location) => (
            <div key={location.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <MapPin className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-900">{location.name}</span>
                {badge(
                  location.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700',
                  location.is_active ? 'Actif' : 'Inactif',
                )}
              </div>
              <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                {screenhostDetailRows(location, governorates).map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-xs text-gray-500">{label}</dt>
                    <dd className="text-sm text-gray-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
