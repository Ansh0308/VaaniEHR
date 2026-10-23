// Fully fake signed visits for the FHIR golden examples (Phase 9A, ADR-D40). Every name, id, phone number, medicine and
// symptom here is made up. Nothing is clinical. `npm run fhir:golden -w @vaaniehr/api-node` writes the bundles to
// apps/api-node/fixtures/fhir/golden/ (committed: data/ is private and git-ignored, so fixtures live here).
import {
  buildOpConsultBundle,
  buildPrescriptionBundle,
  type FhirBuildInput,
  type Json,
} from '../../src/fhir/builder.js';
import type { SignedContent, SignedFact, SignedMedicine } from '../../src/visits/repository.js';

const fact = (n: number, over: Partial<SignedFact>): SignedFact => ({
  id: `00000000-0000-4000-8000-00000000f0${String(n).padStart(2, '0')}`,
  type: 'symptom',
  value: 'toy fact',
  negated: false,
  uncertain: false,
  speaker: null,
  source: 'manual',
  sourceSegmentSeq: null,
  evidenceQuote: null,
  edited: false,
  originalValue: null,
  conceptId: null,
  conceptStatus: 'none',
  ...over,
});
const medicine = (position: number, over: Partial<SignedMedicine>): SignedMedicine => ({
  position,
  medicineId: null,
  name: 'Drug-A (FAKE)',
  source: 'master',
  strength: '500 mg',
  doseForm: 'Tablet',
  dose: '1 tablet',
  frequency: 'BD',
  duration: '5 days',
  note: null,
  masterSource: 'fake list',
  masterSourcePage: 27,
  ...over,
});
const content = (sessionId: string, over: Partial<SignedContent>): SignedContent => ({
  schema: 1,
  sessionId,
  patientRef: '00000000-0000-4000-8000-0000000000a1',
  doctorId: '00000000-0000-4000-8000-0000000000d1',
  signedAt: '2026-10-22T04:30:00.000Z',
  facts: [],
  workingCondition: null,
  medicines: [],
  consent: { audio: true, aiProcessing: true },
  aiContentIncluded: false,
  amendedFrom: null,
  ...over,
});

const PATIENT = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Fake Patient One',
  gender: 'female',
  birthDate: '1990-05-17',
  phone: '0000000001',
};
const PRACTITIONER = { id: '00000000-0000-4000-8000-0000000000d1', name: 'Dr Fake Doctor' };

const base = (
  sessionId: string,
  c: SignedContent,
  over: Partial<FhirBuildInput> = {},
): FhirBuildInput => ({
  sessionId,
  version: 1,
  kind: 'signed',
  signedAt: '2026-10-22T04:30:00.000Z',
  content: c,
  safetyConfigured: false,
  safetyNotRunAcknowledged: true,
  patient: PATIENT,
  practitioner: PRACTITIONER,
  encounter: { startedAt: '2026-10-22T04:00:00.000Z', endedAt: '2026-10-22T04:25:00.000Z' },
  ...over,
});

const S1 = '00000000-0000-4000-8000-0000000005e1';
const S2 = '00000000-0000-4000-8000-0000000005e2';
const S3 = '00000000-0000-4000-8000-0000000005e3';

const visit1 = content(S1, {
  facts: [
    fact(1, { value: 'toy symptom one' }),
    fact(2, { value: 'toy symptom two', negated: true }),
    fact(3, { type: 'duration', value: '2 days toy' }),
    fact(4, { type: 'vital', value: 'toy reading 120/80' }),
    fact(5, { type: 'allergy', value: 'Drug-B (FAKE)' }),
  ],
  workingCondition: { kind: 'not_listed', text: 'toy working note' },
  medicines: [
    medicine(0, { medicineId: '00000000-0000-4000-8000-0000000000b1' }),
    medicine(1, {
      name: 'Hand-typed (FAKE)',
      source: 'free_text',
      strength: null,
      doseForm: null,
      dose: null,
      frequency: 'OD',
      duration: '3 days',
      masterSource: null,
      masterSourcePage: null,
    }),
  ],
});
const visit2 = content(S2, {
  facts: [
    fact(1, { value: 'toy symptom one' }),
    fact(2, { type: 'past_condition', value: 'toy past condition' }),
  ],
  workingCondition: { kind: 'pathway', pathwayId: 'toy_condition_a', version: 1 },
  medicines: [medicine(0, { duration: '3 days' })],
  amendedFrom: 1,
});
const visit3 = content(S3, {
  facts: [
    fact(1, { value: 'toy symptom one', uncertain: true }),
    fact(2, { type: 'current_medicine', value: 'Drug-C (FAKE)', negated: true }),
  ],
});

export const GOLDEN_INPUTS: Record<string, FhirBuildInput> = {
  'visit1-signed': base(S1, visit1),
  'visit2-amended': base(S2, visit2, {
    version: 2,
    kind: 'amendment',
    signedAt: '2026-10-22T06:10:00.000Z',
  }),
  'visit3-no-medicines': base(S3, visit3, {
    safetyConfigured: true,
    safetyNotRunAcknowledged: false,
  }),
};

export interface GoldenFile {
  name: string;
  bundle: Json;
}

/** The good bundles: an OPConsultRecord for each visit and a PrescriptionRecord where there are medicines. */
export function goldenBundles(): GoldenFile[] {
  const out: GoldenFile[] = [];
  for (const [key, input] of Object.entries(GOLDEN_INPUTS)) {
    out.push({ name: `good-${key}-opconsult`, bundle: buildOpConsultBundle(input) });
    const rx = buildPrescriptionBundle(input);
    if (rx) out.push({ name: `good-${key}-prescription`, bundle: rx });
  }
  return out;
}

const clone = (j: Json): Json => JSON.parse(JSON.stringify(j)) as Json;
const entries = (b: Json) => b['entry'] as Array<{ resource: Json }>;

/** Deliberately broken bundles: each breaks one profile rule the validator must report. */
export function brokenBundles(): GoldenFile[] {
  const good = buildOpConsultBundle(GOLDEN_INPUTS['visit1-signed'] as FhirBuildInput);
  // 1) the Composition has no subject (Composition.subject is required by the OPConsultRecord profile)
  const noSubject = clone(good);
  delete (entries(noSubject)[0] as { resource: Json }).resource['subject'];
  // 2) the Composition type carries a code other than the one the profile fixes
  const wrongCode = clone(good);
  const comp = (entries(wrongCode)[0] as { resource: Json }).resource;
  (((comp['type'] as Json)['coding'] as Json[])[0] as Json)['code'] = '000000';
  // 3) a MedicationRequest without requester and with an invalid status
  const badRequest = clone(good);
  const req = entries(badRequest).find(
    (e) => e.resource['resourceType'] === 'MedicationRequest',
  ) as { resource: Json };
  delete req.resource['requester'];
  req.resource['status'] = 'not-a-status';
  return [
    { name: 'broken-no-composition-subject', bundle: noSubject },
    { name: 'broken-wrong-type-code', bundle: wrongCode },
    { name: 'broken-medicationrequest', bundle: badRequest },
  ];
}
