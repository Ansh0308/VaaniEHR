// The FHIR builder (Phase 9A, ADR-D40): deterministic, no invented codes, Asia/Kolkata dates, negation and uncertainty mapped
// with standard HL7 codes, free-text medicines flagged, the safety flag carried outside the clinical fields, amendments linked.
// The committed golden bundles must equal what the builder produces now (no silent drift). Fully fake data.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildOpConsultBundle,
  buildPrescriptionBundle,
  kolkata,
  NS,
  uuid5,
  type Json,
} from '../../src/fhir/builder.js';
import { summariseOutcome } from '../../src/fhir/validator.js';
import { brokenBundles, GOLDEN_INPUTS, goldenBundles } from './goldenVisits.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'fhir', 'golden');
const input = (k: string) => GOLDEN_INPUTS[k] as NonNullable<(typeof GOLDEN_INPUTS)[string]>;
type Res = Json & { resourceType: string; id: string };
const resources = (b: Json): Res[] =>
  (b['entry'] as Array<{ resource: Res }>).map((e) => e.resource);
const find = (b: Json, type: string) => resources(b).filter((r) => r.resourceType === type);

/** every coding {system, code} found anywhere in a bundle */
function codings(
  node: unknown,
  out: Array<{ system: string; code: string }> = [],
): Array<{ system: string; code: string }> {
  if (Array.isArray(node)) node.forEach((n) => codings(n, out));
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (Array.isArray(o['coding'])) {
      for (const c of o['coding'] as Array<{ system: string; code: string }>)
        out.push({ system: c.system, code: c.code });
    }
    Object.values(o).forEach((v) => codings(v, out));
  }
  return out;
}

describe('ids and dates', () => {
  it('uuid5 matches the RFC 4122 test vector', () => {
    expect(uuid5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
  it('writes Asia/Kolkata dates with +05:30, across a midnight and a year end', () => {
    expect(kolkata('2026-10-22T04:30:00.000Z')).toBe('2026-10-22T10:00:00+05:30');
    expect(kolkata('2026-10-22T19:00:00Z')).toBe('2026-10-23T00:30:00+05:30');
    expect(kolkata('2026-12-31T20:00:00Z')).toBe('2027-01-01T01:30:00+05:30');
  });
  it('rejects a date it cannot read', () => {
    expect(() => kolkata('not a date')).toThrow();
  });
  it('is deterministic: the same visit gives the same bundle, byte for byte', () => {
    const a = JSON.stringify(buildOpConsultBundle(input('visit1-signed')));
    const b = JSON.stringify(buildOpConsultBundle(input('visit1-signed')));
    expect(a).toBe(b);
  });
  it('every dateTime in a bundle carries the +05:30 offset', () => {
    const text = JSON.stringify(buildOpConsultBundle(input('visit1-signed')));
    const stamps = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^"]*/g) ?? [];
    expect(stamps.length).toBeGreaterThan(5);
    expect(stamps.every((s) => s.endsWith('+05:30'))).toBe(true);
  });
});

describe('no invented codes or identifiers', () => {
  const ALLOWED = new Set([
    // fixed by the OPConsultRecord / PrescriptionRecord profiles
    'http://snomed.info/sct|371530004',
    'http://snomed.info/sct|440545006',
    'http://snomed.info/sct|422843007',
    'http://snomed.info/sct|425044008',
    'http://snomed.info/sct|722446000',
    'http://snomed.info/sct|371529009',
    'http://snomed.info/sct|721912009',
    'http://snomed.info/sct|404684003',
    // standard HL7 terminology that the IG examples themselves use
    'http://terminology.hl7.org/CodeSystem/v2-0203|MR',
    'http://terminology.hl7.org/CodeSystem/v3-ActCode|AMB',
    'http://terminology.hl7.org/CodeSystem/condition-clinical|active',
    'http://terminology.hl7.org/CodeSystem/condition-ver-status|refuted',
    'http://terminology.hl7.org/CodeSystem/condition-ver-status|unconfirmed',
    'http://terminology.hl7.org/CodeSystem/condition-ver-status|provisional',
    'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical|active',
    'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification|refuted',
    'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification|unconfirmed',
    'http://terminology.hl7.org/CodeSystem/observation-category|vital-signs',
  ]);
  const all = goldenBundles().map((g) => g.bundle);

  it('only the codes the IG fixes or standard HL7 terminology appear in any golden bundle', () => {
    for (const b of all) {
      for (const c of codings(b))
        expect(ALLOWED.has(`${c.system}|${c.code}`), `${c.system}|${c.code}`).toBe(true);
    }
  });
  it('no SNOMED, ICD, LOINC or ATC code for a symptom, medicine, vital or working condition: text only', () => {
    const b = buildOpConsultBundle(input('visit1-signed'));
    for (const type of ['Condition', 'Observation', 'AllergyIntolerance', 'MedicationRequest']) {
      for (const r of find(b, type)) {
        const code = (r['code'] ?? r['medicationCodeableConcept']) as {
          coding?: unknown;
          text?: string;
        };
        expect(code.coding).toBeUndefined();
        expect(typeof code.text).toBe('string');
      }
    }
  });
  it('no ABHA, HPR or registry identifier is made up: identifiers use our own .invalid namespaces', () => {
    const text = JSON.stringify(goldenBundles().map((g) => g.bundle));
    expect(text).not.toMatch(/healthid\.ndhm|abha|hpr\.ndhm|doctor\.ndhm|hip\.in/i);
    const b = buildOpConsultBundle(input('visit1-signed'));
    const doc = find(b, 'Practitioner')[0] as Res & {
      identifier: Array<{ system: string; type: { text: string; coding?: unknown } }>;
    };
    expect(doc.identifier[0]?.system).toBe(NS.practitioner);
    expect(doc.identifier[0]?.type.coding).toBeUndefined();
    expect(doc.identifier[0]?.type.text).toMatch(/not an HPR id/);
  });
});

describe('mapping choices', () => {
  const b = buildOpConsultBundle(input('visit1-signed'));
  it('uses the profiles of the IG and a document bundle', () => {
    expect((b['meta'] as Json)['profile']).toEqual([
      'https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle',
    ]);
    expect(b['type']).toBe('document');
    const comp = find(b, 'Composition')[0] as Res;
    expect((comp['meta'] as Json)['profile']).toEqual([
      'https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord',
    ]);
    expect(
      find(b, 'MedicationRequest').every((r) =>
        ((r['meta'] as Json)['profile'] as string[])[0]?.endsWith('/MedicationRequest'),
      ),
    ).toBe(true);
  });
  it('the signing doctor is the legal attester of the Composition, at the signing time', () => {
    const comp = find(b, 'Composition')[0] as Res & {
      attester: Array<{ mode: string; time: string; party: { reference: string } }>;
      author: Array<{ reference: string }>;
    };
    expect(comp.attester).toHaveLength(1);
    expect(comp.attester[0]).toMatchObject({ mode: 'legal', time: '2026-10-22T10:00:00+05:30' });
    expect(comp.attester[0]?.party).toEqual(comp.author[0]);
  });
  it('a negated symptom is a refuted Condition without an active clinical status; a plain one is active', () => {
    const conds = find(b, 'Condition') as Array<
      Res & {
        code: { text: string };
        verificationStatus?: { coding: Array<{ code: string }> };
        clinicalStatus?: unknown;
      }
    >;
    const negated = conds.find((c) => c.code.text === 'toy symptom two');
    expect(negated?.verificationStatus?.coding[0]?.code).toBe('refuted');
    expect(negated?.clinicalStatus).toBeUndefined();
    const plain = conds.find((c) => c.code.text === 'toy symptom one');
    expect(plain?.verificationStatus).toBeUndefined();
    expect(plain?.clinicalStatus).toBeDefined();
  });
  it('an uncertain symptom is unconfirmed; a negated current medicine is not-taken', () => {
    const b3 = buildOpConsultBundle(input('visit3-no-medicines'));
    const cond = find(b3, 'Condition')[0] as Res & {
      verificationStatus: { coding: Array<{ code: string }> };
    };
    expect(cond.verificationStatus.coding[0]?.code).toBe('unconfirmed');
    expect((find(b3, 'MedicationStatement')[0] as Res)['status']).toBe('not-taken');
  });
  it('the working condition is a text-only provisional Condition naming its source', () => {
    const wc = (find(b, 'Condition') as Array<Res & { code: { text: string } }>).find((c) =>
      c.code.text.startsWith('Working condition'),
    );
    expect(wc?.code.text).toBe("Working condition (doctor's note): toy working note");
    expect(
      ((wc?.['verificationStatus'] as Json)['coding'] as Array<{ code: string }>)[0]?.code,
    ).toBe('provisional');
    const pathway = (
      find(buildOpConsultBundle(input('visit2-amended')), 'Condition') as Array<
        Res & { code: { text: string } }
      >
    ).find((c) => c.code.text.startsWith('Working condition'));
    expect(pathway?.code.text).toBe('Working condition (pathway toy_condition_a, version 1)');
  });
  it('a medicine keeps its text, dosage and honest notes: master source, or "Not in master list"', () => {
    const reqs = find(b, 'MedicationRequest') as Array<
      Res & {
        medicationCodeableConcept: { text: string };
        dosageInstruction: Array<{ text: string }>;
        note?: Array<{ text: string }>;
      }
    >;
    expect(reqs[0]?.medicationCodeableConcept.text).toBe('Drug-A (FAKE) 500 mg Tablet');
    expect(reqs[0]?.dosageInstruction[0]?.text).toBe('1 tablet, BD, 5 days');
    expect(reqs[0]?.note?.[0]?.text).toBe('Medicine master source: fake list, page 26.');
    expect(reqs[1]?.note?.[0]?.text).toMatch(/^Not in master list/);
    expect(reqs[1]?.medicationCodeableConcept.text).toBe('Hand-typed (FAKE)');
  });
  it('a vital is an Observation in the physical exam section with a text code and a string value', () => {
    const vital = (
      find(b, 'Observation') as Array<Res & { code: { text: string }; valueString: string }>
    ).find((o) => o.code.text === 'Vital sign');
    expect(vital?.valueString).toBe('toy reading 120/80');
    const comp = find(b, 'Composition')[0] as Res & {
      section: Array<{
        code: { coding: Array<{ code: string }> };
        entry: Array<{ reference: string }>;
      }>;
    };
    const exam = comp.section.find((s) => s.code.coding[0]?.code === '425044008');
    expect(exam?.entry.map((e) => e.reference)).toContain(`urn:uuid:${vital?.id}`);
  });
  it('every reference in the document points at an entry of the same bundle', () => {
    const ids = new Set(resources(b).map((r) => `urn:uuid:${r.id}`));
    const refs = JSON.stringify(b).match(/"reference":"([^"]+)"/g) ?? [];
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(ids.has(r.slice(13, -1))).toBe(true);
    expect((b['entry'] as Array<{ fullUrl: string }>).every((e) => ids.has(e.fullUrl))).toBe(true);
  });
  it('the Composition carries the safety flag as a meta tag of our own system and in the narrative, not as a clinical element', () => {
    const comp = find(b, 'Composition')[0] as Res & {
      meta: { tag: Array<{ system: string; code: string }> };
      text: { div: string };
    };
    expect(comp.meta.tag).toEqual([
      {
        system: NS.recordFlags,
        code: 'safety-checks-not-run',
        display: 'Safety checks were not run',
      },
    ]);
    expect(comp['extension']).toBeUndefined();
    expect(comp.text.div).toContain('Safety checks were not run');
    const ok = buildOpConsultBundle(input('visit3-no-medicines'));
    const comp3 = find(ok, 'Composition')[0] as Res & {
      meta: { tag?: unknown };
      text: { div: string };
    };
    expect(comp3.meta.tag).toBeUndefined();
    expect(comp3.text.div).toContain('Safety checks ran');
  });
  it('every resource carries a narrative, with the text escaped', () => {
    const first = input('visit1-signed');
    const odd = buildOpConsultBundle({
      ...first,
      content: { ...first.content, facts: [{ ...first.content.facts[0]!, value: 'a < b & "c"' }] },
    });
    for (const r of resources(odd))
      expect((r['text'] as { div: string }).div).toContain(
        '<div xmlns="http://www.w3.org/1999/xhtml">',
      );
    expect(JSON.stringify(odd)).toContain('a &lt; b &amp; &quot;c&quot;');
  });
  it('an empty visit still gets a text-only section so the profile requirement holds', () => {
    const empty = buildOpConsultBundle({
      ...input('visit3-no-medicines'),
      content: { ...input('visit3-no-medicines').content, facts: [] },
    });
    const comp = find(empty, 'Composition')[0] as Res & {
      section: Array<{ text?: unknown; entry?: unknown }>;
    };
    expect(comp.section).toHaveLength(1);
    expect(comp.section[0]?.text).toBeDefined();
    expect(comp.section[0]?.entry).toBeUndefined();
  });
});

describe('amended visits and prescriptions', () => {
  it('an amendment is a new bundle version of the SAME visit: same bundle identifier, versionId 2, replaces version 1', () => {
    const v1 = buildOpConsultBundle({ ...input('visit2-amended'), version: 1, kind: 'signed' });
    const v2 = buildOpConsultBundle(input('visit2-amended'));
    expect((v2['identifier'] as Json)['value']).toBe((v1['identifier'] as Json)['value']);
    expect(v2['id']).not.toBe(v1['id']);
    expect((v2['meta'] as Json)['versionId']).toBe('2');
    const comp1 = find(v1, 'Composition')[0] as Res & {
      relatesTo?: unknown;
      identifier: { value: string };
    };
    const comp2 = find(v2, 'Composition')[0] as Res & {
      relatesTo: Array<{ code: string; targetIdentifier: { value: string } }>;
    };
    expect(comp1.relatesTo).toBeUndefined();
    expect(comp2.relatesTo[0]).toMatchObject({ code: 'replaces' });
    expect(comp2.relatesTo[0]?.targetIdentifier.value).toBe(comp1.identifier.value);
    expect(find(v2, 'Composition')[0]?.['narrative']).toBeUndefined();
  });
  it('the prescription bundle holds only the medicine rows, and is absent when there are none', () => {
    const rx = buildPrescriptionBundle(input('visit1-signed')) as Json;
    const comp = find(rx, 'Composition')[0] as Res & {
      section: Array<{ entry: Array<{ type: string }> }>;
    };
    expect(comp.section).toHaveLength(1);
    expect(comp.section[0]?.entry.every((e) => e.type === 'MedicationRequest')).toBe(true);
    expect(
      resources(rx)
        .map((r) => r.resourceType)
        .sort(),
    ).toEqual(['Composition', 'MedicationRequest', 'MedicationRequest', 'Patient', 'Practitioner']);
    expect(buildPrescriptionBundle(input('visit3-no-medicines'))).toBeNull();
  });
});

describe('golden files', () => {
  it('the committed golden and broken bundles equal what the builder produces now', () => {
    for (const f of [...goldenBundles(), ...brokenBundles()]) {
      const onDisk = JSON.parse(readFileSync(join(dir, `${f.name}.json`), 'utf8')) as Json;
      expect(onDisk, f.name).toEqual(f.bundle);
    }
  });
  it('the broken bundles really differ from a good one in the one rule they break', () => {
    const [noSubject, wrongCode, badRequest] = brokenBundles().map((x) => x.bundle);
    expect((find(noSubject as Json, 'Composition')[0] as Res)['subject']).toBeUndefined();
    expect(
      (
        ((find(wrongCode as Json, 'Composition')[0] as Res)['type'] as Json)['coding'] as Array<{
          code: string;
        }>
      )[0]?.code,
    ).toBe('000000');
    const req = find(badRequest as Json, 'MedicationRequest')[0] as Res;
    expect(req['requester']).toBeUndefined();
    expect(req['status']).toBe('not-a-status');
  });
});

describe('summarising a validator answer', () => {
  it('counts errors, warnings and information and keeps every issue; any error means invalid', () => {
    const outcome = {
      resourceType: 'OperationOutcome',
      issue: [
        { severity: 'error', expression: ['Bundle.entry[0]'], details: { text: 'bad' } },
        { severity: 'fatal', details: { text: 'worse' } },
        { severity: 'warning', location: ['x'], details: { text: 'hmm' } },
        { severity: 'information', details: { text: 'fyi' } },
      ],
    };
    const r = summariseOutcome(outcome, '7.0.3');
    expect(r).toMatchObject({
      status: 'invalid',
      errors: 2,
      warnings: 1,
      information: 1,
      validatorVersion: '7.0.3',
    });
    expect(r.issues).toHaveLength(4);
    expect(r.issues[0]).toEqual({ severity: 'error', path: 'Bundle.entry[0]', message: 'bad' });
  });
  it('warnings alone do not make a bundle invalid; an unknown severity counts as an error, never as fine', () => {
    expect(
      summariseOutcome(
        {
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'warning', details: { text: 'w' } }],
        },
        null,
      ).status,
    ).toBe('valid');
    expect(
      summariseOutcome(
        {
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'weird', details: { text: 'w' } }],
        },
        null,
      ).status,
    ).toBe('invalid');
  });
});
