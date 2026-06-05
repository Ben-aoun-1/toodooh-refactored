import AgentLayout from '@/features/agent/components/AgentLayout';
import { useAuthStore } from '@/features/auth/stores/auth.store';

// Slice-2 E — the screenhost-agent workspace. This commit ships the routed, branded shell; the
// establishment create form + own-establishments list are added in the next commit.
export default function AgentWorkspace() {
  const contactName = useAuthStore((s) => s.contactName);

  return (
    <AgentLayout
      title={`Bonjour, ${contactName ?? 'Agent'}`}
      subtitle="Enregistrez les établissements de votre réseau"
    >
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Établissements</h2>
        <p className="text-sm text-gray-500 mt-1">
          Espace de création et de suivi des établissements que vous enregistrez.
        </p>
      </section>
    </AgentLayout>
  );
}
