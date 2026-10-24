// Shapes of the WhatsApp summary responses (see apps/api-node/openapi.json). Fake data in tests.
export interface WhatsAppSummary {
  id: string;
  version: number;
  status: 'needs_review' | 'approved';
  warningSigns: string;
  followUp: string;
  textGu: string;
  textEn: string;
  phraseTableVersion: string;
  templateName: string;
  /** the fixed Gujarati phrases have not been reviewed by a Gujarati speaker (always true in this run) */
  needsGujaratiReview: boolean;
  textHash: string | null;
  approvedAt: string | null;
  /** the visit was amended after this summary was made */
  stale: boolean;
}

export interface WhatsAppMessage {
  id: string;
  summaryVersion: number;
  status: 'sent' | 'failed' | 'delivered' | 'read';
  provider: 'mock' | 'meta';
  template: string;
  recipientLast4: string;
  errorMessage: string | null;
  sentAt: string;
  deliveredAt: string | null;
}

export interface WhatsAppState {
  signedVersion: number | null;
  safetyNotRun: boolean;
  whatsappConsent: boolean;
  provider: 'mock' | 'meta';
  summary: WhatsAppSummary | null;
  messages: WhatsAppMessage[];
}
