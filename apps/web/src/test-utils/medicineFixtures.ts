// Fake medicines and templates for tests (not shipped). Every name is made up ("Drug-A"); no NLEM row is used here.
import { IDS } from './harness';

export const MED = (n: number) => `5eed0000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
export const TPL = (n: number) => `5eed0000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;

export const fakeMedicine = (over: Record<string, unknown> = {}) => ({
  id: MED(1),
  genericName: 'Drug-A (FAKE)',
  strength: '500 mg',
  doseForm: 'Tablet',
  route: null,
  therapeuticCategory: 'Section One > Group A',
  nlemYear: 2022,
  snomedCode: null,
  atcCode: null,
  source: 'test fixture',
  sourcePage: 27,
  sourcePagePrinted: 26,
  nlemRef: null,
  healthcareLevels: null,
  sourceNotes: null,
  alsoListedIn: [],
  reviewStatus: 'not_reviewed',
  reviewedOn: null,
  reviewedBy: null,
  retired: false,
  brands: [],
  ...over,
});

export const brief = (m: ReturnType<typeof fakeMedicine>) => ({
  id: m.id,
  genericName: m.genericName,
  strength: m.strength,
  doseForm: m.doseForm,
  route: m.route,
  source: m.source,
  sourcePage: m.sourcePage,
  sourcePagePrinted: m.sourcePagePrinted,
  reviewStatus: m.reviewStatus,
  retired: m.retired,
});

export const fakeSummary = (over: Record<string, unknown> = {}) => ({
  id: TPL(1),
  name: 'Demo clinic-wide template (FAKE)',
  visibility: 'clinic',
  ownerId: IDS.user('doctor'),
  ownerName: 'Fake doctor',
  ownedByMe: false,
  itemCount: 2,
  retired: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  canEdit: false,
  ...over,
});

export const fakeItem = (
  position: number,
  medicine: ReturnType<typeof fakeMedicine>,
  over: Record<string, unknown> = {},
) => ({
  id: `5eed0000-0000-4000-8000-0000000004${String(position).padStart(2, '0')}`,
  position,
  medicine: brief(medicine),
  dose: '1 tablet',
  frequency: 'BD',
  duration: '5 days',
  instructions: null,
  medicineRetired: medicine.retired,
  ...over,
});

export const fakeDetail = (
  items: ReturnType<typeof fakeItem>[],
  over: Record<string, unknown> = {},
) => ({ ...fakeSummary({ itemCount: items.length }), items, ...over });
