import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

import logoFullSrc from '@/assets/logo.png';
import {
  TOODOOH_STATEMENT_EMITTER,
  OWNER_STATEMENT_FOOTER,
} from '@/features/screenhost/constants/ownerStatement';
import type {
  OwnerStatementDetail,
  StatementRecipientDisplay,
} from '@/features/screenhost/types/ownerStatement';
import {
  RevenueData,
  ScreenRevenue,
  MonthlyComparison,
} from '@/features/wallet/services/revenue.service';

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

class ExportService {
  // Exporter en PDF
  async exportToPDF(
    data: RevenueData[] | ScreenRevenue[],
    type: 'revenue' | 'screens',
    period: string,
  ) {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // En-tête
    doc.setFontSize(20);
    doc.setTextColor(118, 230, 171);
    doc.text('Toodooh - Rapport de Revenus', pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.text(`Période: ${period}`, pageWidth / 2, 30, { align: 'center' });
    doc.text(`Généré le: ${new Date().toLocaleDateString('fr-FR')}`, pageWidth / 2, 37, {
      align: 'center',
    });

    // Tableau des données
    if (type === 'revenue') {
      const revenueData = data as RevenueData[];
      autoTable(doc, {
        head: [['Période', 'Écran', 'Emplacement', 'Revenus (TND)', 'Date']],
        body: revenueData.map((item) => [
          item.period,
          item.screen_name,
          item.location,
          item.amount.toLocaleString('fr-TN'),
          new Date(item.date).toLocaleDateString('fr-FR'),
        ]),
        startY: 50,
        styles: {
          head: {
            fillColor: [118, 230, 171],
            textColor: [32, 75, 67],
            fontSize: 10,
          },
          body: {
            fontSize: 9,
          },
        },
        headStyles: {
          halign: 'center',
        },
        bodyStyles: {
          halign: 'left',
        },
      });
    } else {
      const screenData = data as ScreenRevenue[];
      autoTable(doc, {
        head: [
          ['Écran', 'Emplacement', 'Revenu Total (TND)', 'Revenu Mensuel (TND)', 'Moyenne (TND)'],
        ],
        body: screenData.map((item) => [
          item.screen_name,
          item.location,
          item.total_revenue.toLocaleString('fr-TN'),
          item.monthly_revenue.toLocaleString('fr-TN'),
          item.average_revenue.toLocaleString('fr-TN'),
        ]),
        startY: 50,
        styles: {
          head: {
            fillColor: [118, 230, 171],
            textColor: [32, 75, 67],
            fontSize: 10,
          },
          body: {
            fontSize: 9,
          },
        },
        headStyles: {
          halign: 'center',
        },
        bodyStyles: {
          halign: 'left',
        },
      });
    }

    // Résumé
    // TODO(phase-1): typed source [jspdf] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = (doc as any).lastAutoTable.finalY + 20;
    doc.setFontSize(14);
    doc.setTextColor(118, 230, 171);
    doc.text('Résumé', 20, finalY);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    const totalRevenue = data.reduce(
      // TODO(phase-1): typed source [supabase] — see #15
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, item: any) => sum + (item.amount || item.total_revenue),
      0,
    );
    doc.text(`Revenus totaux: ${totalRevenue.toLocaleString('fr-TN')} TND`, 20, finalY + 10);
    doc.text(`Nombre d'éléments: ${data.length}`, 20, finalY + 17);

    // Sauvegarder le PDF
    const fileName = `toodooh_revenus_${type}_${period}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);

    return fileName;
  }

  // Exporter en Excel
  async exportToExcel(
    data: RevenueData[] | ScreenRevenue[] | MonthlyComparison[],
    type: 'revenue' | 'screens' | 'monthly',
    period: string,
  ) {
    // TODO(phase-1): typed source [supabase] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let worksheetData: any[] = [];
    let headers: string[] = [];

    if (type === 'revenue') {
      const revenueData = data as RevenueData[];
      headers = ['Période', 'Écran', 'Emplacement', 'Revenus (TND)', 'Date'];
      worksheetData = revenueData.map((item) => [
        item.period,
        item.screen_name,
        item.location,
        item.amount,
        new Date(item.date).toLocaleDateString('fr-FR'),
      ]);
    } else if (type === 'screens') {
      const screenData = data as ScreenRevenue[];
      headers = [
        'Écran',
        'Emplacement',
        'Revenu Total (TND)',
        'Revenu Mensuel (TND)',
        'Moyenne (TND)',
      ];
      worksheetData = screenData.map((item) => [
        item.screen_name,
        item.location,
        item.total_revenue,
        item.monthly_revenue,
        item.average_revenue,
      ]);
    } else {
      const monthlyData = data as MonthlyComparison[];
      headers = ['Mois', 'Revenus (TND)', "Nombre d'écrans", 'Croissance (%)'];
      worksheetData = monthlyData.map((item) => [
        item.month,
        item.revenue,
        item.screens,
        item.growth,
      ]);
    }

    // Créer le workbook
    const workbook = XLSX.utils.book_new();

    // Créer la feuille de données
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...worksheetData]);

    // Ajouter des styles et formatage
    worksheet['!cols'] = headers.map(() => ({ width: 15 }));

    // Ajouter la feuille au workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Revenus');

    // Créer une feuille de résumé
    const summaryData = [
      ['Résumé des Revenus'],
      [''],
      ['Période', period],
      ['Date de génération', new Date().toLocaleDateString('fr-FR')],
      ["Nombre total d'éléments", data.length],
      [
        'Revenus totaux',
        data.reduce(
          // TODO(phase-1): typed source [supabase] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sum: number, item: any) => sum + (item.amount || item.total_revenue || item.revenue),
          0,
        ),
      ],
      [''],
      ['Statistiques'],
      [
        'Revenu moyen',
        data.reduce(
          // TODO(phase-1): typed source [supabase] — see #15
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sum: number, item: any) => sum + (item.amount || item.total_revenue || item.revenue),
          0,
        ) / data.length,
      ],
      [
        'Revenu maximum',
        // TODO(phase-1): typed source [supabase] — see #15
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Math.max(...data.map((item: any) => item.amount || item.total_revenue || item.revenue)),
      ],
      [
        'Revenu minimum',
        // TODO(phase-1): typed source [supabase] — see #15
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Math.min(...data.map((item: any) => item.amount || item.total_revenue || item.revenue)),
      ],
    ];

    const summaryWorksheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Résumé');

    // Générer le fichier
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // Sauvegarder le fichier
    const fileName = `toodooh_revenus_${type}_${period}_${new Date().toISOString().split('T')[0]}.xlsx`;
    saveAs(blob, fileName);

    return fileName;
  }

  // Exporter toutes les données
  async exportAllData(
    revenueData: RevenueData[],
    screenData: ScreenRevenue[],
    monthlyData: MonthlyComparison[],
    period: string,
  ) {
    // Créer un workbook avec plusieurs feuilles
    const workbook = XLSX.utils.book_new();

    // Feuille 1: Revenus par période
    const revenueHeaders = ['Période', 'Écran', 'Emplacement', 'Revenus (TND)', 'Date'];
    const revenueWorksheetData = revenueData.map((item) => [
      item.period,
      item.screen_name,
      item.location,
      item.amount,
      new Date(item.date).toLocaleDateString('fr-FR'),
    ]);
    const revenueWorksheet = XLSX.utils.aoa_to_sheet([revenueHeaders, ...revenueWorksheetData]);
    XLSX.utils.book_append_sheet(workbook, revenueWorksheet, 'Revenus par Période');

    // Feuille 2: Revenus par écran
    const screenHeaders = [
      'Écran',
      'Emplacement',
      'Revenu Total (TND)',
      'Revenu Mensuel (TND)',
      'Moyenne (TND)',
    ];
    const screenWorksheetData = screenData.map((item) => [
      item.screen_name,
      item.location,
      item.total_revenue,
      item.monthly_revenue,
      item.average_revenue,
    ]);
    const screenWorksheet = XLSX.utils.aoa_to_sheet([screenHeaders, ...screenWorksheetData]);
    XLSX.utils.book_append_sheet(workbook, screenWorksheet, 'Revenus par Écran');

    // Feuille 3: Comparaison mensuelle
    const monthlyHeaders = ['Mois', 'Revenus (TND)', "Nombre d'écrans", 'Croissance (%)'];
    const monthlyWorksheetData = monthlyData.map((item) => [
      item.month,
      item.revenue,
      item.screens,
      item.growth,
    ]);
    const monthlyWorksheet = XLSX.utils.aoa_to_sheet([monthlyHeaders, ...monthlyWorksheetData]);
    XLSX.utils.book_append_sheet(workbook, monthlyWorksheet, 'Comparaison Mensuelle');

    // Feuille 4: Résumé
    const summaryData = [
      ['Résumé Complet des Revenus'],
      [''],
      ["Période d'analyse", period],
      ['Date de génération', new Date().toLocaleDateString('fr-FR')],
      [''],
      ['Statistiques Globales'],
      ["Nombre total d'écrans", screenData.length],
      ['Nombre de périodes analysées', revenueData.length],
      ['Revenus totaux', revenueData.reduce((sum, item) => sum + item.amount, 0)],
      [
        'Revenu moyen par écran',
        screenData.reduce((sum, item) => sum + item.total_revenue, 0) / screenData.length,
      ],
      [''],
      ['Performance par Écran'],
      [
        'Écran le plus performant',
        screenData.sort((a, b) => b.total_revenue - a.total_revenue)[0]?.screen_name || 'N/A',
      ],
      ['Revenu maximum', Math.max(...screenData.map((item) => item.total_revenue))],
      ['Revenu minimum', Math.min(...screenData.map((item) => item.total_revenue))],
    ];
    const summaryWorksheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Résumé');

    // Générer le fichier
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // Sauvegarder le fichier
    const fileName = `toodooh_revenus_complet_${period}_${new Date().toISOString().split('T')[0]}.xlsx`;
    saveAs(blob, fileName);

    return fileName;
  }

  /** PDF relevé de versement (même mise en forme que l’écran détail). */
  async exportOwnerStatementPdf(params: {
    detail: OwnerStatementDetail;
    recipient: StatementRecipientDisplay;
  }): Promise<string> {
    const { detail, recipient } = params;
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 18;
    const fmt = (n: number) =>
      new Intl.NumberFormat('fr-TN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);

    const issuedLong = new Date(detail.issueDate).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    let y = 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(0, 0, 0);
    doc.text('Relevé', margin, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    y += 7;
    doc.text(detail.reference, margin, y);
    y += 6;
    doc.text(`Émis le ${issuedLong}`, margin, y);

    let logoFullB64: string | null = null;
    try {
      logoFullB64 = await loadImageAsBase64(String(logoFullSrc));
    } catch {
      /* ignore */
    }

    const logoTopY = 9;
    const fullLogoW = 48;
    const fullLogoH = 12;
    if (logoFullB64) {
      doc.addImage(logoFullB64, 'PNG', pageW - margin - fullLogoW, logoTopY, fullLogoW, fullLogoH);
    }
    if (!logoFullB64) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('Toodooh', pageW - margin, 20, { align: 'right' });
    }

    y = 38;
    const colGap = 8;
    const colW = (pageW - 2 * margin - colGap) / 2;
    const rightX = margin + colW + colGap;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text('Émetteur', margin, y);

    doc.setFont('helvetica', 'bold');
    doc.text(recipient.contactName, rightX, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    let ly = y + 6;
    doc.setFont('helvetica', 'bold');
    doc.text(TOODOOH_STATEMENT_EMITTER.legalName, margin, ly);
    doc.setFont('helvetica', 'normal');
    ly += 5;
    doc.text(TOODOOH_STATEMENT_EMITTER.addressLine1, margin, ly);
    ly += 5;
    doc.text(TOODOOH_STATEMENT_EMITTER.cityPostal, margin, ly);
    ly += 5;
    doc.text(`TVA: ${TOODOOH_STATEMENT_EMITTER.tva}`, margin, ly);
    ly += 5;
    doc.text(TOODOOH_STATEMENT_EMITTER.email, margin, ly);
    const emitterBottom = ly;

    let ry = y + 6;
    doc.text(recipient.companyName, rightX, ry);
    ry += 5;
    doc.text(recipient.addressLine1, rightX, ry);
    ry += 5;
    doc.text(recipient.cityPostal, rightX, ry);
    ry += 5;
    doc.text(recipient.email, rightX, ry);
    const recipientBottom = ry;

    const tableStartY = Math.max(emitterBottom, recipientBottom) + 12;

    autoTable(doc, {
      startY: tableStartY,
      head: [['Description', 'Quantité', 'Prix unitaire', 'Total']],
      body: detail.lineItems.map((row) => [
        row.description,
        String(row.quantity),
        `${fmt(row.unitPrice)} TND`,
        `${fmt(row.total)} TND`,
      ]),
      margin: { left: margin, right: margin },
      headStyles: {
        fillColor: [245, 245, 245],
        textColor: [55, 55, 55],
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: { fontSize: 9, textColor: [40, 40, 40] },
      columnStyles: {
        0: { halign: 'left', cellWidth: 'auto' },
        1: { halign: 'center', cellWidth: 22 },
        2: { halign: 'right', cellWidth: 36 },
        3: { halign: 'right', cellWidth: 36 },
      },
      styles: { lineColor: [230, 230, 230], lineWidth: 0.1 },
    });

    // TODO(phase-1): typed source [jspdf] — see #15
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sumY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(`Sous-total HT : ${fmt(detail.subtotalHT)} TND`, pageW - margin, sumY, {
      align: 'right',
    });
    sumY += 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(pageW - margin - 72, sumY + 4, pageW - margin, sumY + 4);
    sumY += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Total TTC : ${fmt(detail.totalTTC)} TND`, pageW - margin, sumY, { align: 'right' });

    sumY += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    const footerLines = doc.splitTextToSize(OWNER_STATEMENT_FOOTER, pageW - 2 * margin);
    doc.text(footerLines, pageW / 2, sumY, { align: 'center' });

    const safeRef = detail.reference.replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `releve_${safeRef}.pdf`;
    doc.save(fileName);
    return fileName;
  }
}

export const exportService = new ExportService();
