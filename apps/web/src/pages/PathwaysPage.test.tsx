// PG-14 Guideline pathways viewer: read only, the draft banner, text in three languages, the source trail, versions.
// FAKE toy content only.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupApp, renderApp, type Handler } from '../test-utils/harness';

afterEach(cleanupApp);

const loc = (text: string) => ({ en: text, gu: `[TOY-GU] ${text}`, hi: `[TOY-HI] ${text}` });
const node = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  type: 'question',
  slot: 'toy_symptom_1',
  answer: 'boolean',
  choices: null,
  ask: loc('Is toy symptom 1 present?'),
  reason: loc('Toy reason'),
  label: null,
  infoWeight: 5,
  redFlagIf: null,
  sourceQuote: null,
  page: null,
  reviewedBy: null,
  conceptId: 'toy_c_toy_symptom_1',
  refer: null,
  edges: [{ op: 'eq', value: true, to: 't1' }],
  ...over,
});
const terminal = {
  ...node({
    id: 't1',
    type: 'terminal',
    slot: null,
    answer: null,
    ask: null,
    reason: null,
    infoWeight: null,
    conceptId: null,
    edges: [],
  }),
  label: loc('Toy end'),
  refer: false,
};
const versions = [
  {
    version: 2,
    status: 'active',
    reviewedBy: 'Dr Fake Reviewer',
    reviewedOn: '2026-10-01',
    signedOff: true,
  },
  {
    version: 1,
    status: 'active',
    reviewedBy: 'Dr Fake Reviewer',
    reviewedOn: '2026-09-01',
    signedOff: true,
  },
];
const summary = (over: Record<string, unknown> = {}) => ({
  id: 'toy_condition_a',
  title: loc('Toy condition A'),
  latestVersion: 1,
  status: 'test',
  signedOff: false,
  notActive: true,
  nodeCount: 2,
  versions: [{ version: 1, status: 'test', reviewedBy: null, reviewedOn: null, signedOff: false }],
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  ...summary(),
  version: 1,
  source: { doc: 'TOY - not a real source', page: 0 },
  reviewedBy: null,
  reviewedOn: null,
  start: 'q1',
  nodes: [node(), terminal],
  rules: [{ id: 'r1', slot: 'toy_symptom_1', op: 'eq', value: true, weight: 3 }],
  ...over,
});
const open = (
  role: 'doctor' | 'admin' | 'staff' = 'doctor',
  routes: Record<string, Handler> = {},
  language: 'en' | 'gu' = 'en',
) =>
  renderApp({
    role,
    path: '/admin/pathways',
    language,
    routes: {
      'GET /pathways': () => ({ data: { pathways: [summary()], testPathwaysAllowed: true } }),
      'GET /pathways/:id': () => ({ data: detail() }),
      ...routes,
    },
  });

describe('access', () => {
  it('doctors and admins open it; staff are sent to the forbidden page', async () => {
    for (const role of ['doctor', 'admin'] as const) {
      await open(role);
      expect(
        await screen.findByRole('heading', { name: 'Guideline pathways', level: 1 }),
      ).toBeTruthy();
      cleanupApp();
    }
    await open('staff');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Guideline pathways' })).toBeNull(),
    );
  });
});

describe('a test or draft pathway', () => {
  it('shows the plain "Draft - not clinically reviewed" banner, the unsigned state and the fake-pathway note', async () => {
    await open();
    expect(await screen.findByText('Draft - not clinically reviewed')).toBeTruthy();
    expect(screen.getByText(/fake test pathway/)).toBeTruthy();
    expect(screen.getAllByText('Not signed off by a clinician').length).toBeGreaterThan(0);
  });
  it('is read only: no text box, no save button, a hint that a new version is a command-line step', async () => {
    await open();
    await screen.findByText('Draft - not clinically reviewed');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /save|edit|delete|publish/i })).toBeNull();
    expect(screen.getByText(/new version made with the command line/)).toBeTruthy();
  });
  it('shows every node with its text in English, Gujarati and Hindi, with the right lang attributes', async () => {
    await open();
    const card = (await screen.findByText('q1')).closest('li') as HTMLElement;
    for (const [lang, text] of [
      ['en', 'Is toy symptom 1 present?'],
      ['gu', '[TOY-GU] Is toy symptom 1 present?'],
      ['hi', '[TOY-HI] Is toy symptom 1 present?'],
    ] as const) {
      expect(within(card).getByText(text).getAttribute('lang')).toBe(lang);
    }
    expect(within(card).getByText('If eq true, go to t1')).toBeTruthy();
    expect(within(card).getByText(/concept toy_c_toy_symptom_1/)).toBeTruthy();
    expect(within(card).getByText('No source sentence recorded yet')).toBeTruthy();
    expect(screen.getByText('No referral flag')).toBeTruthy();
  });
  it('lists the scoring rules and has no confidence figure', async () => {
    await open();
    expect(await screen.findByText('r1: toy_symptom_1 eq true (weight 3)')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/confidence/i);
  });
});

describe('an active, signed-off pathway with versions', () => {
  const active = detail({
    status: 'active',
    notActive: false,
    signedOff: true,
    version: 2,
    latestVersion: 2,
    reviewedBy: 'Dr Fake Reviewer',
    reviewedOn: '2026-10-01',
    versions,
    nodes: [
      node({
        sourceQuote: 'A fake sentence copied from a fake source.',
        page: 12,
        reviewedBy: 'Dr Fake Reviewer',
      }),
      terminal,
    ],
  });
  it('has no draft banner, shows the sign-off, the source sentence and page', async () => {
    await open('doctor', {
      'GET /pathways': () => ({
        data: { pathways: [summary({ ...active, nodeCount: 2 })], testPathwaysAllowed: false },
      }),
      'GET /pathways/:id': () => ({ data: active }),
    });
    expect(await screen.findByText('A fake sentence copied from a fake source.')).toBeTruthy();
    expect(screen.queryByText('Draft - not clinically reviewed')).toBeNull();
    expect(
      screen.getAllByText('Reviewed by Dr Fake Reviewer on 2026-10-01').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Page 12/)).toBeTruthy();
  });
  it('shows the version history and opens an older version through the API', async () => {
    const app = await open('admin', {
      'GET /pathways': () => ({
        data: { pathways: [summary({ ...active })], testPathwaysAllowed: false },
      }),
      'GET /pathways/:id': (req) => ({
        data: req.query.get('version') === '1' ? { ...active, version: 1 } : active,
      }),
    });
    const history = await screen.findByRole('region', { name: 'Version history' });
    expect(within(history).getByText('Version 2')).toBeTruthy();
    expect(within(history).getByText('Version 1')).toBeTruthy();
    fireEvent.click(within(history).getByRole('button', { name: 'Show version 1' }));
    await waitFor(() =>
      expect(
        app.callsTo('GET', '/pathways/toy_condition_a').some((c) => c.query.version === '1'),
      ).toBe(true),
    );
  });
});

describe('states and language', () => {
  it('says plainly that nothing is loaded', async () => {
    await open('doctor', {
      'GET /pathways': () => ({ data: { pathways: [], testPathwaysAllowed: false } }),
    });
    expect(await screen.findByText('No pathways are loaded')).toBeTruthy();
  });
  it('shows an error with a retry button when the list cannot be read', async () => {
    await open('doctor', {
      'GET /pathways': () => ({ status: 500, error: { code: 'INTERNAL', message: 'x' } }),
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeTruthy();
  });
  it('works in Gujarati, with the needs-review mark', async () => {
    await open('doctor', {}, 'gu');
    expect(
      await screen.findByRole('heading', { name: 'માર્ગદર્શિકા માર્ગો', level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText(/ડ્રાફ્ટ - ક્લિનિકલી સમીક્ષા થઈ નથી/)).toBeTruthy();
    expect(document.querySelector('p[lang="en"]')).toBeTruthy();
  });
});
