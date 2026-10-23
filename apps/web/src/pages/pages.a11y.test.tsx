// axe on EVERY Phase 2B page, in English and in Gujarati (jsdom: colour contrast and page-landmark rules are off here
// because jsdom has no layout; contrast is enforced by tokens.contrast.test.ts and the browser run in `npm run e2e`).
import { fireEvent, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupApp,
  fakeNotices,
  fakePatient,
  IDS,
  noConsent,
  renderApp,
  renderSignedOut,
  type Handler,
} from '../test-utils/harness';

import { fakeMedicine, fakeSummary } from '../test-utils/medicineFixtures';

afterEach(cleanupApp);

const session = {
  id: IDS.session,
  tokenId: null,
  patientId: IDS.patient,
  doctorId: IDS.user('doctor'),
  clinicId: IDS.clinic,
  startedAt: '2026-10-15T09:30:00.000Z',
  endedAt: null,
  languageMix: null,
  status: 'created',
};
const row = {
  seq: 2,
  ts: '2026-10-15T10:00:00.000Z',
  action: 'LOGIN_SUCCEEDED',
  resourceType: 'user',
  actorRole: 'staff',
  actorUserId: IDS.user('staff'),
  resourceId: IDS.user('staff'),
};
const consentRoutes: Record<string, Handler> = {
  'GET /sessions/:id': () => ({ data: session }),
  'GET /sessions/:id/consent': () => ({
    data: {
      ...noConsent(),
      events: [
        {
          seq: 1,
          scope: 'audio',
          granted: true,
          noticeVersion: '0.1',
          noticeLanguage: 'en',
          source: 'staff',
          recordedByRole: 'staff',
          ts: '2026-10-15T10:00:00.000Z',
        },
      ],
    },
  }),
  'GET /consent/notice': () => ({ data: fakeNotices() }),
  'GET /patients/:id': () => ({ data: fakePatient() }),
};

interface Case {
  name: string;
  show: (language: 'en' | 'gu') => Promise<void>;
}

const CASES: Case[] = [
  { name: 'login', show: async (l) => void (await renderSignedOut('/login', {}, l)) },
  {
    name: 'doctor dashboard',
    show: async (language) => {
      await renderApp({
        role: 'doctor',
        path: '/doctor',
        language,
        routes: {
          'GET /sessions': () => ({
            data: {
              items: [
                {
                  ...session,
                  patientName: 'Fake Patient',
                  consent: {
                    audio: false,
                    aiProcessing: false,
                    whatsapp: false,
                    recordingAllowed: false,
                  },
                },
              ],
              nextBefore: null,
            },
          }),
        },
      });
      await screen.findByRole('table', { name: /.+/ });
    },
  },
  {
    name: 'patients with a match',
    show: async (language) => {
      await renderApp({
        role: 'staff',
        path: '/patients',
        language,
        routes: {
          'POST /patients/lookup': () => ({ data: { found: true, patient: fakePatient() } }),
        },
      });
      await screen.findByRole('heading', { level: 1 });
      fireEvent.change(screen.getAllByRole('textbox')[0] as HTMLElement, {
        target: { value: '0000000001' },
      });
      await screen.findByRole('article');
    },
  },
  {
    name: 'patients register dialog',
    show: async (language) => {
      await renderApp({
        role: 'staff',
        path: '/patients',
        language,
        routes: { 'POST /patients/lookup': () => ({ data: { found: false } }) },
      });
      await screen.findByRole('heading', { level: 1 });
      fireEvent.change(screen.getAllByRole('textbox')[0] as HTMLElement, {
        target: { value: '0000000555' },
      });
      const banner = await screen.findByRole('status', { name: '' }).catch(() => null);
      void banner;
      const register = await screen.findByRole('button', {
        name: /Register patient|દર્દીની નોંધણી/,
      });
      fireEvent.click(register);
      await screen.findByRole('dialog');
    },
  },
  {
    name: 'consent',
    show: async (language) => {
      await renderApp({
        role: 'staff',
        path: `/consult/${IDS.session}/consent`,
        language,
        routes: consentRoutes,
      });
      await screen.findByRole('table', { name: /.+/ });
    },
  },
  {
    name: 'consent withdraw dialog',
    show: async (language) => {
      const routes = { ...consentRoutes };
      routes['GET /sessions/:id/consent'] = () => ({
        data: {
          ...noConsent(),
          scopes: {
            ...noConsent().scopes,
            audio: {
              granted: true,
              since: '2026-10-15T10:00:00.000Z',
              noticeVersion: '0.1',
              noticeLanguage: 'en',
              source: 'staff',
            },
          },
          events: [],
        },
      });
      await renderApp({
        role: 'doctor',
        path: `/consult/${IDS.session}/consent`,
        language,
        routes,
      });
      await screen.findByRole('table', { name: /.+/ });
      const withdraw = screen
        .getAllByRole('button')
        .find(
          (b) => !(b as HTMLButtonElement).disabled && /Withdraw|પાછી/.test(b.textContent ?? ''),
        );
      fireEvent.click(withdraw as HTMLElement);
      await screen.findByRole('dialog');
    },
  },
  {
    name: 'audit log (admin)',
    show: async (language) => {
      await renderApp({
        role: 'admin',
        path: '/admin/audit',
        language,
        routes: {
          'GET /audit': () => ({ data: { items: [row], nextBeforeSeq: 1 } }),
          'GET /audit/verify': () => ({ data: { ok: true } }),
        },
      });
      await screen.findByRole('table', { name: /.+/ });
    },
  },
  {
    name: 'audit log (researcher)',
    show: async (language) => {
      await renderApp({
        role: 'researcher',
        path: '/admin/audit',
        language,
        routes: {
          'GET /audit': () => ({
            data: {
              items: [
                {
                  seq: 2,
                  ts: row.ts,
                  action: row.action,
                  resourceType: 'user',
                  actorRole: 'staff',
                },
              ],
              nextBeforeSeq: null,
            },
          }),
        },
      });
      await screen.findByRole('table', { name: /.+/ });
    },
  },
  {
    name: 'consultation (recording ready)',
    show: async (language) => {
      await renderApp({
        role: 'doctor',
        path: `/consult/${IDS.session}`,
        language,
        routes: {
          'GET /sessions/:id/consent': () => ({
            data: {
              ...noConsent(),
              scopes: Object.fromEntries(
                ['audio', 'ai_processing', 'whatsapp'].map((k) => [
                  k,
                  {
                    granted: k !== 'whatsapp',
                    since: '2026-10-17T10:00:00.000Z',
                    noticeVersion: '0.1',
                    noticeLanguage: 'en',
                    source: 'staff',
                  },
                ]),
              ),
              recordingAllowed: true,
            },
          }),
        },
      });
      await screen.findByRole('button', { name: /Start recording|રેકોર્ડિંગ/ });
    },
  },
  {
    name: 'consultation prescription tab (rows, free-text form, template)',
    show: async (language) => {
      const rxRow = {
        id: '5eed0000-0000-4000-8000-0000000004a1',
        position: 0,
        medicineId: fakeMedicine().id,
        name: 'Drug-A (FAKE)',
        source: 'master',
        strength: '500 mg',
        doseForm: 'Tablet',
        dose: null,
        frequency: 'BD',
        duration: '5 days',
        note: null,
        fromTemplateId: null,
        masterSource: 'test fixture',
        masterSourcePage: 27,
        masterSourcePagePrinted: 26,
        masterReviewStatus: 'not_reviewed',
        incomplete: false,
      };
      await renderApp({
        role: 'doctor',
        path: `/consult/${IDS.session}`,
        language,
        routes: {
          'GET /sessions/:id/consent': () => ({ data: noConsent() }),
          'GET /templates': () => ({
            data: { items: [fakeSummary()], total: 1, limit: 100, offset: 0 },
          }),
          'GET /sessions/:id/prescription': () => ({
            data: {
              rows: [
                rxRow,
                {
                  ...rxRow,
                  id: '5eed0000-0000-4000-8000-0000000004a2',
                  medicineId: null,
                  name: 'Hand-typed (FAKE)',
                  source: 'free_text',
                  masterSource: null,
                  masterReviewStatus: null,
                  frequency: null,
                  duration: null,
                  incomplete: true,
                },
              ],
              locked: false,
            },
          }),
        },
      });
      fireEvent.click(await screen.findByRole('tab', { name: /Prescription|પ્રિસ્ક્રિપ્શન/ }));
      await screen.findByText('Hand-typed (FAKE)');
      fireEvent.click(
        screen.getByRole('button', {
          name: /Medicine not in the master list|દવા માસ્ટર યાદીમાં નથી/,
        }),
      );
    },
  },
  {
    name: 'sign page (blockers and safety acknowledgement)',
    show: async (language) => {
      await renderApp({
        role: 'doctor',
        path: `/consult/${IDS.session}/sign`,
        language,
        routes: {
          'GET /sessions/:id/sign-preview': () => ({
            data: {
              facts: [
                {
                  id: 'f1',
                  type: 'symptom',
                  value: 'toy final words',
                  negated: false,
                  uncertain: false,
                  status: 'confirmed',
                  source: 'extracted',
                  edited: true,
                  originalValue: 'toy engine words',
                  originalNegated: false,
                  originalUncertain: false,
                  evidenceQuote: 'toy quote',
                  conceptConfirmed: false,
                },
              ],
              workingCondition: {
                kind: 'pathway',
                pathwayId: 'toy_condition_a',
                version: 1,
                text: null,
                engineRank: 1,
              },
              engineCandidates: [{ pathwayId: 'toy_condition_a', version: 1, rank: 1 }],
              medicines: [
                {
                  id: 'm1',
                  name: 'Drug-A (FAKE)',
                  source: 'master',
                  strength: '500 mg',
                  doseForm: 'Tablet',
                  dose: null,
                  frequency: 'BD',
                  duration: '3 days',
                  note: null,
                  incomplete: false,
                  templateOriginal: {
                    templateName: 'Toy template',
                    dose: null,
                    frequency: 'BD',
                    duration: '7 days',
                    instructions: null,
                  },
                },
              ],
            },
          }),
          'GET /sessions/:id/sign-readiness': () => ({
            data: {
              signed: false,
              blockers: [
                { code: 'unconfirmed_facts', count: 2 },
                { code: 'no_working_condition', count: 1 },
              ],
              medicineCount: 1,
              safety: { configured: false, blocked: 0, message: 'x' },
              currentVersion: null,
            },
          }),
        },
      });
      await screen.findByRole('button', { name: /Sign visit|મુલાકાત પર સહી કરો/ });
    },
  },
  {
    name: 'visit record (signed, two versions)',
    show: async (language) => {
      await renderApp({
        role: 'doctor',
        path: `/consult/${IDS.session}/record`,
        language,
        routes: {
          'GET /sessions/:id/visit': () => ({
            data: {
              version: 2,
              kind: 'amendment',
              contentHash: 'b'.repeat(64),
              safetyConfigured: false,
              safetyNotRunAcknowledged: true,
              reason: 'wrong duration typed',
              signedBy: IDS.user('doctor'),
              signedAt: '2026-10-22T11:30:00.000Z',
              content: {
                schema: 1,
                sessionId: IDS.session,
                signedAt: '2026-10-22T11:30:00.000Z',
                facts: [
                  {
                    id: 'f1',
                    type: 'symptom',
                    value: 'toy final words',
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
                  },
                ],
                workingCondition: { kind: 'not_listed', text: 'toy note' },
                medicines: [
                  {
                    position: 0,
                    medicineId: fakeMedicine().id,
                    name: 'Drug-A (FAKE)',
                    source: 'master',
                    strength: '500 mg',
                    doseForm: 'Tablet',
                    dose: null,
                    frequency: 'BD',
                    duration: '5 days',
                    note: null,
                    masterSource: 'test fixture',
                    masterSourcePage: 27,
                  },
                ],
                consent: { audio: true, aiProcessing: true },
                aiContentIncluded: true,
                amendedFrom: 1,
              },
            },
          }),
          'GET /sessions/:id/visit/versions': () => ({
            data: {
              versions: [
                {
                  version: 1,
                  kind: 'signed',
                  contentHash: 'a'.repeat(64),
                  safetyConfigured: false,
                  safetyNotRunAcknowledged: true,
                  reason: null,
                  signedBy: IDS.user('doctor'),
                  signedAt: '2026-10-22T10:00:00.000Z',
                },
                {
                  version: 2,
                  kind: 'amendment',
                  contentHash: 'b'.repeat(64),
                  safetyConfigured: false,
                  safetyNotRunAcknowledged: true,
                  reason: 'wrong duration typed',
                  signedBy: IDS.user('doctor'),
                  signedAt: '2026-10-22T11:30:00.000Z',
                },
              ],
            },
          }),
        },
      });
      await screen.findByRole('region', { name: /Version history|આવૃત્તિનો ઇતિહાસ/ });
    },
  },
  {
    name: 'amendment screen',
    show: async (language) => {
      await renderApp({
        role: 'doctor',
        path: `/consult/${IDS.session}/amend`,
        language,
        routes: {
          'GET /sessions/:id/visit': () => ({
            data: {
              version: 2,
              kind: 'amendment',
              contentHash: 'b'.repeat(64),
              safetyConfigured: false,
              safetyNotRunAcknowledged: true,
              reason: 'wrong duration typed',
              signedBy: IDS.user('doctor'),
              signedAt: '2026-10-22T11:30:00.000Z',
              content: {
                schema: 1,
                sessionId: IDS.session,
                signedAt: '2026-10-22T11:30:00.000Z',
                facts: [
                  {
                    id: 'f1',
                    type: 'symptom',
                    value: 'toy final words',
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
                  },
                ],
                workingCondition: { kind: 'not_listed', text: 'toy note' },
                medicines: [
                  {
                    position: 0,
                    medicineId: fakeMedicine().id,
                    name: 'Drug-A (FAKE)',
                    source: 'master',
                    strength: '500 mg',
                    doseForm: 'Tablet',
                    dose: null,
                    frequency: 'BD',
                    duration: '5 days',
                    note: null,
                    masterSource: 'test fixture',
                    masterSourcePage: 27,
                  },
                ],
                consent: { audio: true, aiProcessing: true },
                aiContentIncluded: true,
                amendedFrom: 1,
              },
            },
          }),
          'GET /sessions/:id/sign-readiness': () => ({
            data: {
              signed: true,
              blockers: [{ code: 'session_not_draft', count: 1 }],
              medicineCount: 1,
              safety: { configured: false, blocked: 0, message: 'x' },
              currentVersion: 2,
            },
          }),
        },
      });
      await screen.findByRole('region', { name: /Version being replaced|જે આવૃત્તિ બદલાય છે/ });
    },
  },
  {
    name: 'visit record FHIR tab (valid and invalid bundle)',
    show: async (language) => {
      await renderApp({
        role: 'doctor',
        path: `/consult/${IDS.session}/record`,
        language,
        routes: {
          'GET /sessions/:id/visit': () => ({
            data: {
              version: 2,
              kind: 'amendment',
              contentHash: 'b'.repeat(64),
              safetyConfigured: false,
              safetyNotRunAcknowledged: true,
              reason: 'r',
              signedBy: IDS.user('doctor'),
              signedAt: '2026-10-22T11:30:00.000Z',
              content: {
                schema: 1,
                sessionId: IDS.session,
                signedAt: '2026-10-22T11:30:00.000Z',
                facts: [],
                workingCondition: null,
                medicines: [],
                consent: { audio: true, aiProcessing: true },
                aiContentIncluded: false,
                amendedFrom: 1,
              },
            },
          }),
          'GET /sessions/:id/visit/versions': () => ({ data: { versions: [] } }),
          'GET /sessions/:id/fhir': () => ({
            data: {
              currentVersion: 2,
              versions: [2],
              version: 2,
              bundles: [
                {
                  kind: 'op_consult',
                  version: 2,
                  status: 'valid',
                  errorCount: 0,
                  warningCount: 1,
                  infoCount: 0,
                  issues: [
                    {
                      severity: 'warning',
                      path: 'Bundle.entry[1].resource.identifier[0]',
                      message: 'No code provided',
                    },
                  ],
                  validatorVersion: '7.0.3',
                  igVersion: '6.5.0',
                  notValidatedReason: null,
                  validatedAt: '2026-10-23T10:00:00.000Z',
                  createdAt: '2026-10-23T10:00:00.000Z',
                  bundle: { resourceType: 'Bundle', type: 'document', entry: [] },
                  exportable: true,
                },
                {
                  kind: 'prescription',
                  version: 2,
                  status: 'invalid',
                  errorCount: 1,
                  warningCount: 1,
                  infoCount: 0,
                  issues: [
                    {
                      severity: 'warning',
                      path: 'Bundle.entry[1].resource.identifier[0]',
                      message: 'No code provided',
                    },
                    { severity: 'error', path: 'Bundle.entry[0]', message: 'a validator error' },
                  ],
                  validatorVersion: '7.0.3',
                  igVersion: '6.5.0',
                  notValidatedReason: null,
                  validatedAt: '2026-10-23T10:00:00.000Z',
                  createdAt: '2026-10-23T10:00:00.000Z',
                  bundle: { resourceType: 'Bundle' },
                  exportable: false,
                },
              ],
            },
          }),
        },
      });
      fireEvent.click(await screen.findByRole('tab', { name: 'FHIR' }));
      await screen.findByRole('region', { name: /Prescription record|પ્રિસ્ક્રિપ્શન રેકોર્ડ/ });
    },
  },
  {
    name: 'FHIR status (admin)',
    show: async (language) => {
      await renderApp({
        role: 'admin',
        path: `/admin/fhir/${IDS.session}`,
        language,
        routes: {
          'GET /sessions/:id/fhir': () => ({
            data: {
              currentVersion: 2,
              versions: [2],
              version: 2,
              bundles: [
                {
                  kind: 'op_consult',
                  version: 2,
                  status: 'invalid',
                  errorCount: 1,
                  warningCount: 1,
                  infoCount: 0,
                  issues: [
                    {
                      severity: 'warning',
                      path: 'Bundle.entry[1].resource.identifier[0]',
                      message: 'No code provided',
                    },
                    { severity: 'error', path: 'Bundle.entry[0]', message: 'a validator error' },
                  ],
                  validatorVersion: '7.0.3',
                  igVersion: '6.5.0',
                  notValidatedReason: null,
                  validatedAt: '2026-10-23T10:00:00.000Z',
                  createdAt: '2026-10-23T10:00:00.000Z',
                  bundle: null,
                  exportable: false,
                },
              ],
            },
          }),
        },
      });
      await screen.findByRole('region', { name: /Consultation record|પરામર્શ રેકોર્ડ/ });
    },
  },
  {
    name: 'medicine master',
    show: async (language) => {
      await renderApp({
        role: 'admin',
        path: '/admin/medicines',
        language,
        routes: {
          'GET /medicines': () => ({
            data: { items: [fakeMedicine()], total: 1, limit: 25, offset: 0 },
          }),
          'GET /medicines/categories': () => ({
            data: { categories: [{ name: 'Section One', count: 1 }] },
          }),
        },
      });
      await screen.findByRole('table', { name: /.+/ });
    },
  },
  {
    name: 'templates list',
    show: async (language) => {
      await renderApp({
        role: 'doctor',
        path: '/admin/templates',
        language,
        routes: {
          'GET /templates': () => ({
            data: { items: [fakeSummary()], total: 1, limit: 25, offset: 0 },
          }),
        },
      });
      await screen.findByRole('table', { name: /.+/ });
    },
  },
  {
    name: 'consult screen with the pathway panels (toy)',
    show: async (language) => {
      const granted = {
        granted: true,
        since: '2026-10-17T10:00:00.000Z',
        noticeVersion: '0.1',
        noticeLanguage: 'en',
        source: 'staff',
      };
      const base = noConsent();
      const loc = (en: string) => ({ en, gu: `[TOY-GU] ${en}`, hi: `[TOY-HI] ${en}` });
      await renderApp({
        role: 'doctor',
        path: `/consult/${IDS.session}`,
        language,
        routes: {
          'GET /sessions/:id/consent': () => ({
            data: {
              ...base,
              scopes: { ...base.scopes, audio: granted, ai_processing: granted },
              recordingAllowed: true,
            },
          }),
          'GET /sessions/:id/facts': () => ({
            data: {
              facts: [
                {
                  id: 'f1',
                  type: 'symptom',
                  value: 'toy symptom one',
                  negated: false,
                  uncertain: false,
                  speaker: null,
                  source: 'manual',
                  sourceSegmentSeq: null,
                  spanStart: null,
                  spanEnd: null,
                  evidenceQuote: null,
                  matchType: null,
                  status: 'heard',
                  edited: false,
                  originalValue: null,
                  pipeline: 'manual',
                  model: null,
                  conceptId: null,
                  conceptStatus: 'none',
                  conceptConfirmedAt: null,
                  snomedId: null,
                  confirmedAt: null,
                },
              ],
              heardCount: 1,
              confirmedCount: 0,
              rejectedCount: 0,
              staleCount: 0,
            },
          }),
          'GET /sessions/:id/concept-suggestions': () => ({
            data: {
              listLoaded: true,
              byFact: {
                f1: [
                  { conceptId: 'a', label: 'toy symptom one', reviewStatus: 'unreviewed' },
                  { conceptId: 'b', label: 'toy symptom two', reviewStatus: 'unreviewed' },
                ],
              },
              conceptLabels: {},
            },
          }),
          'GET /sessions/:id/pathway-record': () => ({
            data: { selected: null, acknowledgedRedFlags: [], notActive: true },
          }),
          'GET /sessions/:id/questions/next': () => ({
            data: {
              outcome: 'RED_FLAG',
              eventId: 'e1',
              eventStatus: 'suggested',
              nodeId: 'toy_condition_b/q3',
              pathwayId: 'toy_condition_b',
              pathwayVersion: 1,
              pathwayTitle: loc('Toy condition B').en,
              pathwayStatus: 'test',
              notActive: true,
              slot: 'toy_redflag_1',
              ask: null,
              reasonText: 'Toy reason',
              redFlags: ['toy_condition_b/q3'],
              questionsUsed: 1,
              questionCap: 8,
              slotConflicts: [],
            },
          }),
          'GET /sessions/:id/candidates': () => ({
            data: {
              outcome: 'RED_FLAG',
              notice: 'x',
              notActive: true,
              selected: null,
              candidates: [
                {
                  rank: 1,
                  pathwayId: 'toy_condition_a',
                  version: 1,
                  title: 'Toy condition A',
                  status: 'test',
                  score: 0.5,
                  evidenceFor: [
                    { ruleId: 'r1', slot: 'toy_symptom_1', nodeId: 'q1', factId: null },
                  ],
                  evidenceAgainst: [],
                  source: { doc: 'TOY - not a real source', page: 0 },
                },
              ],
            },
          }),
        },
      });
      await screen.findByTestId('red-flag-banner');
      await screen.findByText(
        /Suggested concept: toy symptom one|સૂચવેલ કન્સેપ્ટ: toy symptom one/,
      );
      await screen.findByText('Toy condition A', { exact: false });
    },
  },
  {
    name: 'pathways viewer (toy)',
    show: async (language) => {
      const loc = (en: string) => ({ en, gu: `[TOY-GU] ${en}`, hi: `[TOY-HI] ${en}` });
      const summary = {
        id: 'toy_condition_a',
        title: loc('Toy condition A'),
        latestVersion: 1,
        status: 'test',
        signedOff: false,
        notActive: true,
        nodeCount: 2,
        versions: [
          { version: 1, status: 'test', reviewedBy: null, reviewedOn: null, signedOff: false },
        ],
      };
      const node = {
        id: 'q1',
        type: 'question',
        slot: 'toy_symptom_1',
        answer: 'boolean',
        choices: null,
        ask: loc('Toy question'),
        reason: loc('Toy reason'),
        label: null,
        infoWeight: 5,
        redFlagIf: null,
        sourceQuote: 'A fake sentence.',
        page: 1,
        reviewedBy: null,
        conceptId: null,
        refer: null,
        edges: [{ op: 'eq', value: true, to: 't1' }],
      }; // fmt: skip
      await renderApp({
        role: 'admin',
        path: '/admin/pathways',
        language,
        routes: {
          'GET /pathways': () => ({ data: { pathways: [summary], testPathwaysAllowed: true } }),
          'GET /pathways/:id': () => ({
            data: {
              ...summary,
              version: 1,
              source: { doc: 'TOY - not a real source', page: 0 },
              reviewedBy: null,
              reviewedOn: null,
              start: 'q1',
              nodes: [node],
              rules: [{ id: 'r1', slot: 'toy_symptom_1', op: 'eq', value: true, weight: 3 }],
            },
          }),
        },
      });
      await screen.findByText('A fake sentence.');
    },
  },
  {
    name: 'template builder',
    show: async (language) => {
      await renderApp({ role: 'doctor', path: '/admin/templates/new', language });
      fireEvent.click(await screen.findByRole('button', { name: /Add medicine|દવા ઉમેરો/ }));
      await screen.findAllByRole('combobox');
    },
  },
  {
    name: 'settings',
    show: async (language) => {
      await renderApp({
        role: 'doctor',
        path: '/settings',
        language,
        routes: {
          'GET /health': () => ({ data: {} }),
          'GET /ready': () => ({ data: {} }),
          'GET /config/public': () => ({ data: { simulatedDataOnly: true } }),
        },
      });
      await screen.findAllByRole('table', { name: /.+/ });
    },
  },
  {
    name: '403 page',
    show: async (language) => {
      await renderApp({ role: 'staff', path: '/doctor', language });
      await screen.findByRole('heading', { level: 2 });
    },
  },
  {
    name: '404 page',
    show: async (language) => {
      await renderApp({ role: 'staff', path: '/nope', language });
      await screen.findByRole('heading', { level: 2 });
    },
  },
  {
    name: '500 page',
    show: async (language) => void (await renderSignedOut('/500', {}, language)),
  },
];

describe.each(CASES)('axe: $name', ({ show }) => {
  for (const language of ['en', 'gu'] as const) {
    it(`has no violations in ${language}`, async () => {
      await show(language);
      const results = await axe.run(document.body, {
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
      const summary = results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      );
      expect(summary).toEqual([]);
    }, 30_000);
  }
});
