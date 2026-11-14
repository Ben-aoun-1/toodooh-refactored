import { describe, expect, it } from 'vitest';

import type { AgentCampaign, ShAgentCampaign } from '../services/agent-portfolio.service';

import { vfCampCard, vfCategoryKey, vfDate, vfVenueSubline } from './agent-vf';

const sc: AgentCampaign = {
  id: 'c1',
  name: 'Campagne Délice',
  type: 'standard',
  status: 'active',
  start_date: '2026-11-11',
  end_date: '2026-11-15',
  affiliate_id: 'a',
  affiliate_name: 'Mariem',
  impressions: 11808,
  revenue_tnd: 0,
  forecast_tnd: 2.48,
  to_earn_tnd: 2.48,
};
const sh: ShAgentCampaign = {
  id: 'c2',
  name: 'Campagne Délice',
  type: 'standard',
  status: 'terminee',
  start_date: '2026-11-11',
  end_date: '2026-11-15',
  advertiser_name: 'Mariem',
  venues: [{ id: 'v', name: 'toodooh', impressions: 11808 }],
  venues_touched: 1,
  impressions: 11808,
  revenue_tnd: 2.1,
  forecast_tnd: 2.1,
  to_earn_tnd: 0,
};

describe('agent VF display rules', () => {
  it('maps a category to its pictogram, a shop by default', () => {
    expect(vfCategoryKey('Cafés')).toBe('cafe');
    expect(vfCategoryKey('Restaurants')).toBe('resto');
    expect(vfCategoryKey('Salle de sport')).toBe('sport');
    expect(vfCategoryKey('Espace de loisir')).toBe('loisir');
    expect(vfCategoryKey('Lounges / bars')).toBe('shop');
    expect(vfCategoryKey(null)).toBe('shop');
  });

  it('writes the owner, else the category, else the status under a venue name', () => {
    expect(vfVenueSubline({ owner_name: 'Amine', category: 'Cafés', status: 'en_cours' })).toBe(
      'Amine',
    );
    expect(vfVenueSubline({ category: 'Cafés', status: 'en_cours' })).toBe('Cafés');
    expect(vfVenueSubline({ category: null, status: 'en_attente_activation' })).toBe(
      'En attente d’activation',
    );
    expect(vfVenueSubline({ category: null, status: 'en_cours' })).toBe('Screenhost affilié');
  });

  it('writes dates as dd/mm/yyyy', () => {
    expect(vfDate('2026-11-11')).toBe('11/11/2026');
    expect(vfDate(null)).toBe('–');
  });

  it('shows what is still to earn while a campaign lives, the revenue once it is over', () => {
    expect(vfCampCard(sc)).toMatchObject({
      party: 'Mariem',
      dates: 'Du 11/11/2026 au 15/11/2026',
      moneyLabel: 'À gagner',
      moneyTnd: 2.48,
    });
    expect(vfCampCard(sh)).toMatchObject({
      dates: 'Du 11/11/2026 au 15/11/2026 · 1 Screenhost touché',
      moneyLabel: 'Revenu',
      moneyTnd: 2.1,
    });
  });
});
