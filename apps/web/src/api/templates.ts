// Shapes of the prescription-template responses (see apps/api-node/openapi.json).

/**
 * The controlled dose-frequency codes. A test in apps/api-node (static-rules.test.ts) fails if this list and
 * FREQUENCY_CODES in apps/api-node/src/templates/frequency.ts ever differ. Whether the list is complete is a question
 * for the clinician reviewer (docs/OPEN_CLINICAL_ITEMS.md).
 */
export const FREQUENCY_CODES = ['OD', 'BD', 'TDS', 'QID', 'SOS'] as const;
export type FrequencyCode = (typeof FREQUENCY_CODES)[number];

export type Visibility = 'personal' | 'clinic';
export type ScopeFilter = 'all' | 'mine' | 'clinic';

export interface MedicineBrief {
  id: string;
  genericName: string;
  strength: string | null;
  doseForm: string | null;
  route: string | null;
  source: string;
  sourcePage: number | null;
  sourcePagePrinted: number | null;
  reviewStatus: 'reviewed' | 'not_reviewed';
  retired: boolean;
}

export interface TemplateSummary {
  id: string;
  name: string;
  visibility: Visibility;
  ownerId: string;
  ownerName: string | null;
  ownedByMe: boolean;
  itemCount: number;
  retired: boolean;
  updatedAt: string;
  canEdit: boolean;
}

export interface TemplateItem {
  id: string;
  position: number;
  medicine: MedicineBrief;
  dose: string | null;
  frequency: FrequencyCode | null;
  duration: string | null;
  instructions: string | null;
  medicineRetired: boolean;
}

export interface TemplateDetail extends TemplateSummary {
  items: TemplateItem[];
}

export interface TemplateList {
  items: TemplateSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface LoadedItem {
  position: number;
  medicine: MedicineBrief;
  dose: string | null;
  frequency: FrequencyCode | null;
  duration: string | null;
  instructions: string | null;
  problem: 'MEDICINE_RETIRED' | null;
}

export interface LoadedTemplate {
  template: { id: string; name: string; visibility: Visibility };
  items: LoadedItem[];
  warnings: Array<{ position: number; code: 'MEDICINE_RETIRED'; medicineId: string }>;
  hasRetiredMedicine: boolean;
}

/** One line of the template body sent to POST /templates and PUT /templates/:id. */
export interface ItemInput {
  medicineId: string;
  dose: string | null;
  frequency: FrequencyCode | null;
  duration: string | null;
  instructions: string | null;
}

export interface TemplateInput {
  name: string;
  visibility: Visibility;
  items: ItemInput[];
}
