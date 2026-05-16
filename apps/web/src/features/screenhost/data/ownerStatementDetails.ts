import type { OwnerStatementDetail } from '@/features/screenhost/types/ownerStatement';

/** Détail par relevé — à remplacer par API */
const DETAILS: OwnerStatementDetail[] = [
  {
    id: '1',
    reference: 'REL-2026-001',
    title: 'F Janvier 2026',
    issueDate: '2026-01-31',
    lineItems: [
      { description: 'Campagne 1', quantity: 1, unitPrice: 200, total: 200 },
      { description: 'Campagne 2', quantity: 1, unitPrice: 200, total: 200 },
      { description: 'Campagne 3', quantity: 1, unitPrice: 200, total: 200 },
    ],
    subtotalHT: 600,
    totalTTC: 600,
  },
  {
    id: '2',
    reference: 'REL-2025-002',
    title: 'Facture Décembre 2025',
    issueDate: '2025-10-01',
    lineItems: [
      { description: 'Campagne 1', quantity: 1, unitPrice: 600, total: 600 },
      { description: 'Campagne 2', quantity: 1, unitPrice: 600, total: 600 },
      { description: 'Campagne 3', quantity: 1, unitPrice: 600, total: 600 },
    ],
    subtotalHT: 1800,
    totalTTC: 1800,
  },
  {
    id: '3',
    reference: 'REL-2025-001',
    title: 'Facture Novembre 2025',
    issueDate: '2025-10-01',
    lineItems: [
      { description: 'Campagne 1', quantity: 2, unitPrice: 300, total: 600 },
      { description: 'Campagne 2', quantity: 2, unitPrice: 300, total: 600 },
      { description: 'Campagne 3', quantity: 2, unitPrice: 300, total: 600 },
    ],
    subtotalHT: 1800,
    totalTTC: 1800,
  },
];

export function getOwnerStatementDetail(id: string): OwnerStatementDetail | undefined {
  return DETAILS.find((d) => d.id === id);
}

export function listOwnerStatementSummaries() {
  return DETAILS.map((d) => ({
    id: d.id,
    reference: d.reference,
    title: d.title,
    amount: d.totalTTC,
    date: d.issueDate,
  }));
}

export function getAllOwnerStatementDetails(): OwnerStatementDetail[] {
  return [...DETAILS];
}
