export interface StatementLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/** Relevé complet (écran + PDF) */
export interface OwnerStatementDetail {
  id: string;
  reference: string;
  title: string;
  issueDate: string;
  lineItems: StatementLineItem[];
  subtotalHT: number;
  totalTTC: number;
}

export interface StatementRecipientDisplay {
  contactName: string;
  companyName: string;
  addressLine1: string;
  cityPostal: string;
  email: string;
}
