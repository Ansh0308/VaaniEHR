// FHIR R4 document bundles for a SIGNED visit (Phase 9A, ADR-D40, FR-F8-01..03). Pure functions: a signed visit snapshot
// (VisitRepository) plus the people and encounter facts the snapshot does not hold go in, a Bundle comes out. No database,
// no clock, no randomness: the same input always gives the same bundle byte for byte.
//
// Rules this file follows (docs/FHIR_MAPPING.md lists every element; docs/FHIR_GAPS.md lists what the IG requires and we lack):
//  - NO invented codes or identifiers. The only codes written are the ones the IG itself fixes (Composition type and section
//    codes, which are SNOMED CT codes the profile prescribes), standard HL7 terminology the IG's own examples use (v2-0203
//    MR, v3-ActCode AMB, condition / allergy verification status, observation category), and nothing else. A medicine,
//    a symptom, a working condition is TEXT ONLY (CodeableConcept.text), which the IG allows.
//  - Dates are Asia/Kolkata with a +05:30 offset (the IG examples use the same).
//  - Ids are deterministic UUID v5 values written as urn:uuid references (IG 6.0.0 uses urn:uuid bundle references).
import { createHash } from 'node:crypto';
import type { SignedContent, SignedFact, SignedMedicine } from '../visits/repository.js';

export const IG_BASE = 'https://nrces.in/ndhm/fhir/r4/StructureDefinition';
export const IG_VERSION = '6.5.0';
/** Our own namespaces. They name WHO issued an identifier; they are not clinical codes. `.invalid` marks them as non-resolvable. */
export const NS = {
  bundle: 'https://vaaniehr.invalid/fhir/id/bundle',
  composition: 'https://vaaniehr.invalid/fhir/id/composition',
  patient: 'https://vaaniehr.invalid/fhir/id/patient',
  practitioner: 'https://vaaniehr.invalid/fhir/id/practitioner',
  encounter: 'https://vaaniehr.invalid/fhir/id/encounter',
  /** our own tag system for record-level flags; a tag, because the validator rejects an extension it cannot resolve */
  recordFlags: 'https://vaaniehr.invalid/fhir/CodeSystem/record-flags',
} as const;
const UUID_NAMESPACE = '6f1c0a52-3c63-4d6e-9d55-5a0c5b9b2f10';

export type Json = Record<string, unknown>;

/** RFC 4122 version 5 UUID from a namespace UUID and a name. */
export function uuid5(name: string, namespace: string = UUID_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** An ISO instant as an Asia/Kolkata dateTime with the +05:30 offset (no fractional seconds). */
export function kolkata(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) throw new Error(`not a date: ${iso}`);
  const d = new Date(t + 330 * 60_000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+05:30`;
}

export interface FhirPatient {
  id: string;
  name: string | null;
  /** free text from the clinic system */
  gender: string | null;
  /** YYYY-MM-DD */
  birthDate: string | null;
  /** exactly 10 digits (India) */
  phone: string | null;
}
export interface FhirPractitioner {
  id: string;
  name: string | null;
}
export interface FhirEncounterTimes {
  startedAt: string;
  endedAt: string | null;
}
export interface FhirBuildInput {
  sessionId: string;
  /** version of the signed visit this bundle describes */
  version: number;
  kind: 'signed' | 'amendment';
  signedAt: string;
  content: SignedContent;
  safetyConfigured: boolean;
  safetyNotRunAcknowledged: boolean;
  patient: FhirPatient;
  practitioner: FhirPractitioner;
  encounter: FhirEncounterTimes;
}

const SNOMED = 'http://snomed.info/sct';
// the section codes below are FIXED by the IG profile OPConsultRecord (StructureDefinition-OPConsultRecord)
const SECTION = {
  chiefComplaint: {
    code: '422843007',
    display: 'Chief complaint section',
    title: 'Chief complaints',
  },
  physicalExam: {
    code: '425044008',
    display: 'Physical exam section',
    title: 'Physical examination',
  },
  allergy: { code: '722446000', display: 'Allergy record', title: 'Allergies' },
  history: { code: '371529009', display: 'History and physical report', title: 'Medical history' },
  medication: { code: '721912009', display: 'Medication summary document', title: 'Medications' },
  finding: { code: '404684003', display: 'Clinical finding', title: 'Clinical findings' },
  consultation: {
    code: '371530004',
    display: 'Clinical consultation report',
    title: 'Consultation summary',
  },
} as const;

const ref = (id: string): Json => ({ reference: `urn:uuid:${id}` });
const profile = (name: string): Json => ({ profile: [`${IG_BASE}/${name}`] });
const clean = (o: Json): Json =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

const esc = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** a minimal generated narrative (the IG examples carry one; without it every resource draws a dom-6 warning) */
const narr = (text: string): Json => ({
  status: 'generated',
  div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${esc(text)}</p></div>`,
});

function genderOf(g: string | null): 'male' | 'female' | 'other' | 'unknown' {
  const v = (g ?? '').trim().toLowerCase();
  return v === 'male' || v === 'female' || v === 'other' ? v : 'unknown';
}

/** Deterministic id of one resource of one visit (stable across versions for the same source row). */
const rid = (sessionId: string, kind: string, key: string | number): string =>
  uuid5(`${sessionId}|${kind}|${key}`);

export interface BuiltResources {
  patient: Json;
  practitioner: Json;
  encounter: Json;
  patientId: string;
  practitionerId: string;
  encounterId: string;
  conditions: Json[];
  observations: Json[];
  allergies: Json[];
  statements: Json[];
  workingCondition: Json | null;
  requests: Json[];
  sections: Record<string, string[]>;
}

const FACT_LABEL: Record<string, string> = {
  duration: 'Duration',
  severity: 'Severity',
  vital: 'Vital sign',
  red_flag_mention: 'Red-flag mention',
};

function medicationText(m: SignedMedicine): string {
  return [m.name, m.strength, m.doseForm].filter(Boolean).join(' ');
}
function dosageText(m: SignedMedicine): string {
  return [m.dose, m.frequency, m.duration, m.note].filter(Boolean).join(', ');
}

export function buildResources(input: FhirBuildInput): BuiltResources {
  const { sessionId, content } = input;
  const authored = kolkata(input.signedAt);
  const patientId = rid(sessionId, 'Patient', input.patient.id);
  const practitionerId = rid(sessionId, 'Practitioner', input.practitioner.id);
  const encounterId = rid(sessionId, 'Encounter', sessionId);

  const patient: Json = clean({
    resourceType: 'Patient',
    id: patientId,
    meta: profile('Patient'),
    text: narr(`Patient ${input.patient.name ?? input.patient.id}`),
    identifier: [
      {
        // v2-0203 MR is the code the IG's own Patient example uses for the record number
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
              code: 'MR',
              display: 'Medical record number',
            },
          ],
        },
        system: NS.patient,
        value: input.patient.id,
      },
    ],
    name: input.patient.name ? [{ text: input.patient.name }] : undefined,
    telecom: input.patient.phone
      ? [{ system: 'phone', value: `+91${input.patient.phone}`, use: 'home' }]
      : undefined,
    gender: genderOf(input.patient.gender),
    birthDate: input.patient.birthDate ?? undefined,
  });

  const practitioner: Json = clean({
    resourceType: 'Practitioner',
    id: practitionerId,
    meta: profile('Practitioner'),
    text: narr(`Practitioner ${input.practitioner.name ?? input.practitioner.id}`),
    identifier: [
      {
        // the IG wants a type. We hold NO registry id (no HPR id, no licence number), so the type is text only and says so
        type: { text: 'VaaniEHR user id (not an HPR id or a licence number)' },
        system: NS.practitioner,
        value: input.practitioner.id,
      },
    ],
    name: input.practitioner.name ? [{ text: input.practitioner.name }] : undefined,
  });

  const encounter: Json = clean({
    resourceType: 'Encounter',
    id: encounterId,
    meta: profile('Encounter'),
    text: narr('Ambulatory consultation'),
    identifier: [{ system: NS.encounter, value: sessionId }],
    status: 'finished',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'AMB',
      display: 'ambulatory',
    },
    subject: ref(patientId),
    period: clean({
      start: kolkata(input.encounter.startedAt),
      end: input.encounter.endedAt ? kolkata(input.encounter.endedAt) : kolkata(input.signedAt),
    }),
  });

  const sections: Record<string, string[]> = {};
  const add = (key: keyof typeof SECTION, id: string) => {
    (sections[key] ??= []).push(id);
  };
  const conditions: Json[] = [];
  const observations: Json[] = [];
  const allergies: Json[] = [];
  const statements: Json[] = [];

  const verification = (f: SignedFact, system: string): Json | undefined => {
    // a NEGATED fact ("not present") is a refuted statement; an UNCERTAIN one is unconfirmed. Both are standard HL7 codes.
    if (f.negated) return { coding: [{ system, code: 'refuted', display: 'Refuted' }] };
    if (f.uncertain) return { coding: [{ system, code: 'unconfirmed', display: 'Unconfirmed' }] };
    return undefined;
  };

  for (const f of content.facts) {
    if (f.type === 'symptom' || f.type === 'past_condition') {
      const id = rid(sessionId, 'Condition', f.id);
      const ver = verification(f, 'http://terminology.hl7.org/CodeSystem/condition-ver-status');
      conditions.push(
        clean({
          resourceType: 'Condition',
          id,
          meta: profile('Condition'),
          text: narr(
            `${f.type === 'symptom' ? 'Symptom' : 'Past condition'}: ${f.value}${f.negated ? ' (not present)' : ''}${f.uncertain ? ' (uncertain)' : ''}`,
          ),
          clinicalStatus: f.negated
            ? undefined
            : {
                coding: [
                  {
                    system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
                    code: 'active',
                    display: 'Active',
                  },
                ],
              },
          verificationStatus: ver,
          code: { text: f.value },
          subject: ref(patientId),
          recordedDate: authored,
        }),
      );
      add(f.type === 'symptom' ? 'chiefComplaint' : 'history', id);
    } else if (f.type === 'allergy') {
      const id = rid(sessionId, 'AllergyIntolerance', f.id);
      const ver = verification(
        f,
        'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
      );
      allergies.push(
        clean({
          resourceType: 'AllergyIntolerance',
          id,
          meta: profile('AllergyIntolerance'),
          text: narr(
            `Allergy: ${f.value}${f.negated ? ' (not present)' : ''}${f.uncertain ? ' (uncertain)' : ''}`,
          ),
          clinicalStatus: f.negated
            ? undefined
            : {
                coding: [
                  {
                    system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
                    code: 'active',
                    display: 'Active',
                  },
                ],
              },
          verificationStatus: ver,
          code: { text: f.value },
          patient: ref(patientId),
          recordedDate: authored,
          recorder: ref(practitionerId),
        }),
      );
      add('allergy', id);
    } else if (f.type === 'current_medicine') {
      const id = rid(sessionId, 'MedicationStatement', f.id);
      statements.push(
        clean({
          resourceType: 'MedicationStatement',
          id,
          meta: profile('MedicationStatement'),
          text: narr(`Current medicine: ${f.value}${f.negated ? ' (not taken)' : ''}`),
          // we do not know whether the patient takes it: 'unknown'; a negated mention is 'not-taken'
          status: f.negated ? 'not-taken' : 'unknown',
          medicationCodeableConcept: { text: f.value },
          subject: ref(patientId),
        }),
      );
      add('medication', id);
    } else {
      // duration, severity, vital, red_flag_mention: an Observation with a text-only code and a string value
      const id = rid(sessionId, 'Observation', f.id);
      observations.push(
        clean({
          resourceType: 'Observation',
          id,
          meta: profile('Observation'),
          text: narr(`${FACT_LABEL[f.type] ?? f.type}: ${f.value}`),
          status: 'final',
          category:
            f.type === 'vital'
              ? [
                  {
                    coding: [
                      {
                        system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                        code: 'vital-signs',
                        display: 'Vital Signs',
                      },
                    ],
                  },
                ]
              : undefined,
          code: { text: FACT_LABEL[f.type] ?? f.type },
          subject: ref(patientId),
          effectiveDateTime: authored,
          performer: [ref(practitionerId)],
          valueString: f.value,
          note:
            f.negated || f.uncertain
              ? [
                  {
                    text: [
                      f.negated ? 'Recorded as not present.' : null,
                      f.uncertain ? 'Recorded as uncertain.' : null,
                    ]
                      .filter(Boolean)
                      .join(' '),
                  },
                ]
              : undefined,
        }),
      );
      add(f.type === 'vital' ? 'physicalExam' : 'finding', id);
    }
  }

  // the working condition: text only, provisional (the doctor's own choice; nothing here is a diagnosis code)
  let workingCondition: Json | null = null;
  const wc = content.workingCondition;
  if (wc) {
    const id = rid(sessionId, 'Condition', 'working');
    workingCondition = clean({
      resourceType: 'Condition',
      id,
      meta: profile('Condition'),
      text: narr('Working condition chosen by the doctor'),
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
            display: 'Active',
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'provisional',
            display: 'Provisional',
          },
        ],
      },
      code: {
        text:
          wc.kind === 'not_listed'
            ? `Working condition (doctor's note): ${wc.text}`
            : `Working condition (pathway ${wc.pathwayId}, version ${wc.version})`,
      },
      subject: ref(patientId),
      recordedDate: authored,
    });
    add('history', id);
  }

  const requests: Json[] = content.medicines.map((m) => {
    const id = rid(sessionId, 'MedicationRequest', m.position);
    add('medication', id);
    const notes = [
      m.source === 'free_text'
        ? { text: 'Not in master list: this medicine was typed by the doctor and has no source.' }
        : m.masterSource
          ? {
              text: `Medicine master source: ${m.masterSource}${m.masterSourcePage === null ? '' : `, page ${m.masterSourcePage - 1}`}.`,
            }
          : undefined,
    ].filter(Boolean);
    return clean({
      resourceType: 'MedicationRequest',
      id,
      meta: profile('MedicationRequest'),
      text: narr(`Prescribed: ${medicationText(m)}; ${dosageText(m)}`),
      status: 'active',
      intent: 'order',
      medicationCodeableConcept: { text: medicationText(m) },
      subject: ref(patientId),
      authoredOn: authored,
      requester: ref(practitionerId),
      note: notes.length > 0 ? notes : undefined,
      dosageInstruction: [{ text: dosageText(m) }],
    });
  });

  return {
    patient,
    practitioner,
    encounter,
    patientId,
    practitionerId,
    encounterId,
    conditions,
    observations,
    allergies,
    statements,
    workingCondition,
    requests,
    sections,
  };
}

function narrative(input: FhirBuildInput, title: string): Json {
  const flag = input.safetyNotRunAcknowledged
    ? '<p>Safety checks were not run when this version was signed (the doctor acknowledged this).</p>'
    : input.safetyConfigured
      ? '<p>Safety checks ran when this version was signed.</p>'
      : '';
  const amended =
    input.kind === 'amendment'
      ? `<p>Amendment: version ${input.version} replaces version ${input.version - 1}.</p>`
      : '';
  return {
    status: 'generated',
    div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${title}</p>${flag}${amended}</div>`,
  };
}

function composition(
  input: FhirBuildInput,
  r: BuiltResources,
  kind: 'op' | 'rx',
  sections: Json[],
): Json {
  const isOp = kind === 'op';
  const compId = rid(input.sessionId, `Composition-${kind}`, input.version);
  return clean({
    resourceType: 'Composition',
    id: compId,
    // the safety flag is carried as a meta tag of OUR OWN system plus the narrative: it is not a clinical field
    meta: {
      ...profile(isOp ? 'OPConsultRecord' : 'PrescriptionRecord'),
      tag: input.safetyNotRunAcknowledged
        ? [
            {
              system: NS.recordFlags,
              code: 'safety-checks-not-run',
              display: 'Safety checks were not run',
            },
          ]
        : undefined,
    },
    text: narrative(input, isOp ? 'Consultation record' : 'Prescription record'),
    identifier: {
      system: NS.composition,
      value: uuid5(`${input.sessionId}|composition|${kind}|${input.version}`),
    },
    status: 'final',
    type: {
      coding: [
        isOp
          ? { system: SNOMED, code: '371530004', display: 'Clinical consultation report' }
          : { system: SNOMED, code: '440545006', display: 'Prescription record' },
      ],
      text: isOp ? 'Clinical consultation report' : 'Prescription record',
    },
    subject: ref(r.patientId),
    encounter: isOp ? ref(r.encounterId) : undefined,
    date: kolkata(input.signedAt),
    author: [ref(r.practitionerId)],
    // signing (password re-entered) is the doctor's legal attestation of the document
    attester: [{ mode: 'legal', time: kolkata(input.signedAt), party: ref(r.practitionerId) }],
    title: isOp ? 'Consultation Report' : 'Prescription',
    // an amendment REPLACES the previous version's composition (same visit, new bundle version)
    relatesTo:
      input.version > 1
        ? [
            {
              code: 'replaces',
              targetIdentifier: {
                system: NS.composition,
                value: uuid5(`${input.sessionId}|composition|${kind}|${input.version - 1}`),
              },
            },
          ]
        : undefined,
    section: sections,
  });
}

function bundle(input: FhirBuildInput, kind: 'op' | 'rx', comp: Json, resources: Json[]): Json {
  const stamp = kolkata(input.signedAt);
  const all = [comp, ...resources];
  return {
    resourceType: 'Bundle',
    id: uuid5(`${input.sessionId}|bundle|${kind}|${input.version}`),
    meta: { versionId: String(input.version), lastUpdated: stamp, ...profile('DocumentBundle') },
    // one identifier per visit and document kind: every version of the same visit carries it
    identifier: { system: NS.bundle, value: uuid5(`${input.sessionId}|bundle|${kind}`) },
    type: 'document',
    timestamp: stamp,
    entry: all.map((resource) => ({ fullUrl: `urn:uuid:${String(resource['id'])}`, resource })),
  };
}

const sectionJson = (key: keyof typeof SECTION, ids: string[]): Json => ({
  title: SECTION[key].title,
  code: {
    coding: [{ system: SNOMED, code: SECTION[key].code, display: SECTION[key].display }],
    text: SECTION[key].display,
  },
  entry: ids.map((id) => ref(id)),
});

/** The OPConsultRecord document bundle: facts, working condition and medicines of one signed version. */
export function buildOpConsultBundle(input: FhirBuildInput): Json {
  const r = buildResources(input);
  const order: Array<keyof typeof SECTION> = [
    'chiefComplaint',
    'physicalExam',
    'allergy',
    'history',
    'medication',
    'finding',
  ];
  const sections: Json[] = order
    .filter((k) => (r.sections[k]?.length ?? 0) > 0)
    .map((k) => sectionJson(k, r.sections[k] as string[]));
  if (sections.length === 0) {
    // the profile needs at least one section; a text-only one says plainly that nothing was recorded
    sections.push({
      title: SECTION.consultation.title,
      code: {
        coding: [
          {
            system: SNOMED,
            code: SECTION.consultation.code,
            display: SECTION.consultation.display,
          },
        ],
        text: SECTION.consultation.display,
      },
      text: {
        status: 'generated',
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>No facts, working condition or medicines were recorded in this visit.</p></div>',
      },
    });
  }
  const comp = composition(input, r, 'op', sections);
  const resources = [
    r.practitioner,
    r.patient,
    r.encounter,
    ...r.conditions,
    ...(r.workingCondition ? [r.workingCondition] : []),
    ...r.observations,
    ...r.allergies,
    ...r.statements,
    ...r.requests,
  ];
  return bundle(input, 'op', comp, resources);
}

/** The PrescriptionRecord document bundle (only the medicine rows), or null when the visit has none. */
export function buildPrescriptionBundle(input: FhirBuildInput): Json | null {
  if (input.content.medicines.length === 0) return null;
  const r = buildResources(input);
  const ids = r.requests.map((q) => String(q['id']));
  const comp = composition(input, r, 'rx', [
    {
      title: 'Prescription',
      code: {
        coding: [{ system: SNOMED, code: '440545006', display: 'Prescription record' }],
        text: 'Prescription record',
      },
      entry: ids.map((id) => ({ ...ref(id), type: 'MedicationRequest' })),
    },
  ]);
  return bundle(input, 'rx', comp, [r.practitioner, r.patient, ...r.requests]);
}
