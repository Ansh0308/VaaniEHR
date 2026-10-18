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
