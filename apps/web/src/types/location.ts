export interface Location {
  id: string;
  owner_id: string;
  name: string;
  address?: string;
  coordinates?: { x: number; y: number };
  created_at: string;
  updated_at: string;
}

/** Un créneau d'affluence : jour (1=Lundi … 7=Dimanche), heure (0-23), impressions estimées */
export interface LocationAffluenceSlot {
  location_id: string;
  day_of_week: number;
  hour: number;
  estimated_impressions: number;
}

/** Grille 7 jours × 24 heures pour une localité. day_of_week 1=Lundi, 7=Dimanche */
export type LocationAffluenceGrid = Record<number, Record<number, number>>;

export interface LocationWithScreens extends Location {
  screen_count?: number;
  screen_ids?: string[];
}

export interface LocationWithAffluence extends Location {
  affluence_schedule?: LocationAffluenceSlot[];
  /** Somme des estimated_impressions sur la grille (pour affichage rapide) */
  total_impressions_per_week?: number;
}
