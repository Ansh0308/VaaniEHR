// Shapes of the medicine-master responses (see apps/api-node/openapi.json). Fake data in tests; real rows come from a cited source.

export type ReviewStatus = 'reviewed' | 'not_reviewed';

export interface Brand {
  id: string;
  brandName: string;
  manufacturer: string | null;
  source: string;
}

export interface Medicine {
  id: string;
  genericName: string;
  strength: string | null;
  doseForm: string | null;
  route: string | null;
  therapeuticCategory: string | null;
  nlemYear: number | null;
  snomedCode: string | null;
  atcCode: string | null;
  source: string;
  sourcePage: number | null;
  /** PDF page minus one: the number printed on the page. */
  sourcePagePrinted: number | null;
  nlemRef: string | null;
  healthcareLevels: string | null;
  sourceNotes: string | null;
  alsoListedIn: string[];
  reviewStatus: ReviewStatus;
  reviewedOn: string | null;
  reviewedBy: string | null;
  retired: boolean;
  brands: Brand[];
  /** Only on search results: which name matched the query. */
  matchedOn?: 'generic' | 'brand';
}

export interface MedicineList {
  items: Medicine[];
  total: number;
  limit: number;
  offset: number;
}

export interface MedicineCategory {
  name: string;
  count: number;
}

export type MedicineSort = 'name' | 'strength' | 'form' | 'category' | 'page' | 'reviewed';

/** The body of POST /medicines and (every field optional, at least one) PATCH /medicines/:id. */
export interface MedicineInput {
  genericName: string;
  source: string;
  strength: string | null;
  doseForm: string | null;
  route: string | null;
  therapeuticCategory: string | null;
  nlemYear: number | null;
  sourcePage: number | null;
  sourceNotes: string | null;
}

/** "PDF p. 27, printed 26": the NLEM PDF's page and the number printed on it (one lower). */
export function pageLabel(
  sourcePage: number | null,
  sourcePagePrinted: number | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (sourcePage === null) return null;
  return sourcePagePrinted === null
    ? t('medicines:page.pdfOnly', { pdf: sourcePage })
    : t('medicines:page.both', { pdf: sourcePage, printed: sourcePagePrinted });
}
