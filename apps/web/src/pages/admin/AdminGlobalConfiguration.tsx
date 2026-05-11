import React, { useCallback, useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import {
  globalConfigurationService,
  type GlobalConfigurationRow,
  type GlobalConfigurationValueType,
  validateValueForKey,
} from '../../services/global-configuration.service';
import { toast } from 'react-hot-toast';
import { Loader2, Save } from 'lucide-react';

function inputTypeForRow(row: GlobalConfigurationRow): 'number' | 'text' {
  return row.value_type === 'integer' || row.value_type === 'numeric' ? 'number' : 'text';
}

function stepForRow(row: GlobalConfigurationRow): string | undefined {
  if (row.value_type === 'integer') return '1';
  if (row.value_type === 'numeric') return '0.01';
  return undefined;
}

export default function AdminGlobalConfiguration() {
  const [rows, setRows] = useState<GlobalConfigurationRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await globalConfigurationService.list();
      setRows(data);
      const next: Record<string, string> = {};
      data.forEach((r) => {
        next[r.key] = r.value_text;
      });
      setDraft(next);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const row of rows) {
        const nextVal = (draft[row.key] ?? '').trim();
        const prevVal = row.value_text.trim();
        if (nextVal === prevVal) continue;

        const v = validateValueForKey(row.key, nextVal, row.value_type as GlobalConfigurationValueType);
        if (!v.ok) {
          toast.error(`${row.key}: ${v.message}`);
          setSaving(false);
          return;
        }

        await globalConfigurationService.updateValue(row.key, v.valueText);
      }
      toast.success('Configuration enregistrée');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout
      title="Configuration globale"
      subtitle="Paramètres métier DOOH (CPM, durées vidéo, capacité horaire)"
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-[#00B3A6]" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#00B3A6] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Clé</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Valeur</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Description</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-gray-800 align-top">{row.key}</td>
                    <td className="px-4 py-3 align-top">
                      <input
                        type={inputTypeForRow(row)}
                        step={stepForRow(row)}
                        value={draft[row.key] ?? ''}
                        onChange={(e) => handleChange(row.key, e.target.value)}
                        className="w-full max-w-[200px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00B3A6] focus:border-transparent"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-600 align-top">{row.value_type}</td>
                    <td className="px-4 py-3 text-gray-600 align-top max-w-md">{row.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
