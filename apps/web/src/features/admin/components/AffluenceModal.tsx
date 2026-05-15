import { X, Edit, Save, Calendar } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import { isErrorWithCode } from '../../../lib/errors';
import { logger } from '../../../lib/logger';
import { supabase } from '../../../lib/supabase';
import type { AdminLocation } from '../services/admin-screens.service';

const log = logger.child({ module: 'AffluenceModal' });

type LocationAffluenceRow = {
  location_id: string;
  day_of_week: number;
  hour: number;
  estimated_impressions: number;
};

interface AffluenceModalProps {
  location: AdminLocation;
  onClose: () => void;
}

const DAYS = [
  { id: 1, label: 'Lundi' },
  { id: 2, label: 'Mardi' },
  { id: 3, label: 'Mercredi' },
  { id: 4, label: 'Jeudi' },
  { id: 5, label: 'Vendredi' },
  { id: 6, label: 'Samedi' },
  { id: 7, label: 'Dimanche' },
];

function buildDefaultRows(locationId: string): LocationAffluenceRow[] {
  const rows: LocationAffluenceRow[] = [];
  for (let day = 1; day <= 7; day += 1) {
    for (let hour = 0; hour <= 23; hour += 1) {
      rows.push({
        location_id: locationId,
        day_of_week: day,
        hour,
        estimated_impressions: 0,
      });
    }
  }
  return rows;
}

export default function AffluenceModal({ location, onClose }: AffluenceModalProps) {
  const [rows, setRows] = useState<LocationAffluenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadRows = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('location_affluence_schedule')
          .select('location_id, day_of_week, hour, estimated_impressions')
          .eq('location_id', location.id)
          .order('day_of_week', { ascending: true })
          .order('hour', { ascending: true });

        if (error) throw error;

        const defaults = buildDefaultRows(location.id);
        const incoming = data || [];
        const map = new Map<string, LocationAffluenceRow>();

        defaults.forEach((r) => {
          map.set(`${r.day_of_week}:${r.hour}`, r);
        });
        // TODO(phase-1): typed source [supabase] — see #15
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        incoming.forEach((r: any) => {
          map.set(`${r.day_of_week}:${r.hour}`, {
            location_id: location.id,
            day_of_week: Number(r.day_of_week),
            hour: Number(r.hour),
            estimated_impressions: Number(r.estimated_impressions) || 0,
          });
        });

        setRows(
          Array.from(map.values()).sort((a, b) => {
            if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
            return a.hour - b.hour;
          }),
        );
      } catch (_error) {
        toast.error("Erreur lors du chargement de l'affluence");
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, [location.id]);

  const totalWeekImpressions = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.estimated_impressions) || 0), 0),
    [rows],
  );

  const valueByCell = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((row) => {
      m.set(`${row.day_of_week}:${row.hour}`, Number(row.estimated_impressions) || 0);
    });
    return m;
  }, [rows]);

  const updateRowValue = (dayOfWeek: number, hour: number, value: number) => {
    setRows((prev) =>
      prev.map((row) =>
        row.day_of_week === dayOfWeek && row.hour === hour
          ? { ...row, estimated_impressions: Math.max(0, Number(value) || 0) }
          : row,
      ),
    );
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const payload = rows.map((row) => ({
        location_id: location.id,
        day_of_week: row.day_of_week,
        hour: row.hour,
        estimated_impressions: Math.max(0, Number(row.estimated_impressions) || 0),
      }));

      if (payload.length > 0) {
        const { error: upsertError } = await supabase
          .from('location_affluence_schedule')
          .upsert(payload, { onConflict: 'location_id,day_of_week,hour' });
        if (upsertError) throw upsertError;
      }

      toast.success('Affluence de la localité enregistrée');
      setEditing(false);
    } catch (error) {
      const _err = isErrorWithCode(error) ? error : null;
      log.error({ error }, 'Erreur enregistrement affluence localité');
      const details = [_err?.message, _err?.details, _err?.hint].filter(Boolean).join(' | ');
      toast.error(
        details ? `Erreur enregistrement: ${details}` : "Erreur lors de l'enregistrement",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 p-5">
          <div>
            <h2 className="text-xl font-semibold text-[#171717]">
              Affluence localité - {location.name}
            </h2>
            <p className="text-sm text-[#5C5C5C]">{location.address || 'Adresse non renseignée'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-[#00B3A6]" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-gray-700">
                  Somme hebdo `estimated_impressions`:{' '}
                  <span className="font-semibold">{totalWeekImpressions}</span>
                </div>
                {!editing ? (
                  <button
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#00B3A6] px-4 py-2 text-sm font-medium text-white hover:bg-[#008C82]"
                  >
                    <Edit className="h-4 w-4" />
                    Modifier
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditing(false)}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      {saving ? 'Enregistrement...' : 'Enregistrer'}
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        hour
                      </th>
                      {DAYS.map((day) => (
                        <th
                          key={day.id}
                          className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500"
                        >
                          {day.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {Array.from({ length: 24 }, (_, hour) => (
                      <tr key={`hour-${hour}`} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-700">{hour}:00</td>
                        {DAYS.map((day) => (
                          <td key={`${day.id}-${hour}`} className="px-3 py-2 text-sm text-gray-700">
                            <input
                              type="number"
                              min={0}
                              value={valueByCell.get(`${day.id}:${hour}`) ?? 0}
                              disabled={!editing}
                              onChange={(e) => updateRowValue(day.id, hour, Number(e.target.value))}
                              className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-center focus:border-[#00B3A6] focus:outline-none focus:ring-2 focus:ring-[#00B3A6]/20 disabled:bg-gray-50"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Calendar className="h-4 w-4" />
                Grille complète 7 x 24 (jours en colonnes, heures en lignes).
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
