import jsPDF from 'jspdf';

import logoFullSrc from '../../../assets/logo.png';
import { supabase } from '../../../lib/supabase';

interface InvoiceData {
  id: string;
  numero: string;
  montant: number;
  date_emission: string | Date;
  date_echeance?: string | Date;
  description?: string;
  campaign_name?: string;
  client_name?: string;
  statut: string;
}

interface BusinessProfileData {
  business_name: string;
  contact_name: string;
  contact_phone: string;
  street_address: string;
  city: string;
  postal_code: string;
  tax_number?: string;
  email?: string;
}

const TOODOOH_INFO = {
  name: 'TOODOOH',
  address: '123 Avenue de la République',
  city: '1001 Tunis, Tunisie',
  tva: 'TVA: TN123456789',
  email: 'contact@toodooh.com',
};

const TVA_RATE = 0.19;

function loadImageAsBase64(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

function formatAmount(n: number): string {
  return (
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      n,
    ) + ' TND'
  );
}

function formatDateLong(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export async function generateInvoicePDF(invoice: InvoiceData, userId: string): Promise<void> {
  const { data: businessProfile } = await supabase
    .from('business_profiles')
    .select(
      'business_name, contact_name, contact_phone, street_address, city, postal_code, tax_number',
    )
    .eq('user_id', userId)
    .single();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userEmail = user?.email || '';

  const client: BusinessProfileData = {
    business_name: businessProfile?.business_name || '',
    contact_name: businessProfile?.contact_name || '',
    contact_phone: businessProfile?.contact_phone || '',
    street_address: businessProfile?.street_address || '',
    city: businessProfile?.city || '',
    postal_code: businessProfile?.postal_code || '',
    tax_number: businessProfile?.tax_number || '',
    email: userEmail,
  };

  let campaigns: { name: string; budget: number }[] = [];
  const { data: invoiceCampaigns } = await supabase
    .from('campaigns')
    .select('name, budget')
    .eq('user_id', userId)
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (invoiceCampaigns && invoiceCampaigns.length > 0) {
    campaigns = invoiceCampaigns.map((c) => ({
      name: c.name || 'Campagne',
      budget: parseFloat(c.budget) || 0,
    }));
  }

  if (campaigns.length === 0) {
    campaigns = [
      {
        name: invoice.campaign_name || invoice.description || 'Facture mensuelle',
        budget: invoice.montant,
      },
    ];
  }

  let logoBase64: string | null = null;
  try {
    logoBase64 = await loadImageAsBase64(logoFullSrc);
  } catch {
    /* fallback: no image */
  }

  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const m = 25;
  let y = m;

  // ── Header: Title left, Logo right ──
  doc.setFontSize(28);
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.text('Facture', m, y + 8);

  if (logoBase64) {
    const logoW = 45;
    const logoH = 14;
    doc.addImage(logoBase64, 'PNG', pw - m - logoW, y - 4, logoW, logoH);
  }

  y += 16;
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.numero, m, y);
  y += 5;
  const emissionDate = invoice.date_emission ? formatDateLong(invoice.date_emission) : 'N/A';
  doc.text(`Émise le ${emissionDate}`, m, y);

  y += 20;

  // ── Émetteur / Client ──
  const colLeft = m;
  const colRight = pw / 2 + 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('Émetteur', colLeft, y);
  doc.text('Client', colRight, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);

  const emetteurLines = [
    TOODOOH_INFO.name,
    TOODOOH_INFO.address,
    TOODOOH_INFO.city,
    TOODOOH_INFO.tva,
    TOODOOH_INFO.email,
  ];

  const clientLines: string[] = [];
  if (client.contact_name) clientLines.push(client.contact_name);
  if (client.business_name) clientLines.push(client.business_name);
  if (client.street_address) clientLines.push(client.street_address);
  if (client.postal_code || client.city)
    clientLines.push(`${client.postal_code} ${client.city}`.trim() + ', Tunisie');
  if (client.email) clientLines.push(client.email);

  const maxLines = Math.max(emetteurLines.length, clientLines.length);
  for (let i = 0; i < maxLines; i++) {
    if (i < emetteurLines.length) doc.text(emetteurLines[i], colLeft, y);
    if (i < clientLines.length) doc.text(clientLines[i], colRight, y);
    y += 6;
  }

  y += 12;

  // ── Table ──
  const colDesc = m;
  const colQty = pw / 2 + 5;
  const colUnit = pw / 2 + 40;
  const colTotal = pw - m;
  const rowH = 14;

  // Header row
  doc.setFillColor(245, 245, 245);
  doc.rect(m, y - 4, pw - 2 * m, 10, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('Description', colDesc + 3, y + 3);
  doc.text('Quantité', colQty, y + 3);
  doc.text('Prix unitaire', colUnit, y + 3);
  doc.text('Total', colTotal, y + 3, { align: 'right' });

  y += 10;
  doc.setDrawColor(220, 220, 220);
  doc.line(m, y, pw - m, y);

  // Body rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);

  let sousTotalHT = 0;

  campaigns.forEach((c) => {
    y += rowH;
    doc.text(c.name, colDesc + 3, y - 3);
    doc.text('1', colQty + 8, y - 3);
    doc.text(formatAmount(c.budget), colUnit, y - 3);
    doc.text(formatAmount(c.budget), colTotal, y - 3, { align: 'right' });
    sousTotalHT += c.budget;

    doc.setDrawColor(240, 240, 240);
    doc.line(m, y + 2, pw - m, y + 2);
  });

  y += 24;

  // ── Totals ──
  const labelX = pw / 2 + 10;
  const valueX = pw - m;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text('Sous-total HT', labelX, y);
  doc.text(formatAmount(sousTotalHT), valueX, y, { align: 'right' });

  y += 7;
  const tvaAmount = sousTotalHT * TVA_RATE;
  doc.text('TVA (19%)', labelX, y);
  doc.text(formatAmount(tvaAmount), valueX, y, { align: 'right' });

  y += 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(30, 30, 30);
  doc.text('Total TTC', labelX, y);
  doc.text(formatAmount(sousTotalHT + tvaAmount), valueX, y, { align: 'right' });

  // ── Footer ──
  const footerY = doc.internal.pageSize.getHeight() - 20;
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.setFont('helvetica', 'normal');
  doc.text(
    "Merci pour votre confiance. Pour toute question, contactez-nous à l'adresse contact@too-dooh.com",
    pw / 2,
    footerY,
    { align: 'center' },
  );

  doc.save(`Facture_${invoice.numero}.pdf`);
}
