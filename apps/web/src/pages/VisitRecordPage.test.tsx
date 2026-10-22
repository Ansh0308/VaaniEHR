// PG-10 visit record + amendment screen + previous visits (Phase 8 Run 2). Fake data only.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SignedVisit, VersionSummary } from '../api/prescription';
import { cleanupApp, IDS, noConsent, renderApp, type Handler } from '../test-utils/harness';
import { fakeMedicine } from '../test-utils/medicineFixtures';

afterEach(cleanupApp);

const summary = (over: Partial<VersionSummary> = {}): VersionSummary => ({
  version: 1,
  kind: 'signed',
  contentHash: 'a'.repeat(64),
  safetyConfigured: false,
  safetyNotRunAcknowledged: true,
  reason: null,
  signedBy: IDS.user('doctor'),
  signedAt: '2026-10-22T10:00:00.000Z',
  ...over,
});
const visit = (over: Partial<SignedVisit> = {}): SignedVisit => ({
  ...summary(),
  content: {
    schema: 1,
    sessionId: IDS.session,
    signedAt: '2026-10-22T10:00:00.000Z',
    facts: [
      {
        id: 'f1',
        type: 'symptom',
        value: 'toy final words',
        negated: false,
        uncertain: true,
        speaker: null,
        source: 'extracted',
        sourceSegmentSeq: 0,
        evidenceQuote: 'toy quote',
        edited: true,
        originalValue: 'toy engine words',
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
      {
        position: 1,
        medicineId: null,
        name: 'Hand-typed (FAKE)',
        source: 'free_text',
        strength: null,
        doseForm: null,
        dose: null,
        frequency: 'OD',
        duration: '1 day',
        note: null,
        masterSource: null,
        masterSourcePage: null,
      },
    ],
    consent: { audio: true, aiProcessing: true },
    aiContentIncluded: true,
    amendedFrom: null,
  },
  ...over,
});
const history = [
  summary(),
  summary({
    version: 2,
    kind: 'amendment',
    reason: 'wrong duration typed',
    contentHash: 'b'.repeat(64),
    safetyNotRunAcknowledged: true,
    signedAt: '2026-10-22T11:30:00.000Z',
  }),
];

const recordRoutes = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
  'GET /sessions/:id/visit': () => ({
    data: visit({
      version: 2,
      kind: 'amendment',
      reason: 'wrong duration typed',
      contentHash: 'b'.repeat(64),
    }),
  }),
  'GET /sessions/:id/visit/versions': () => ({ data: { versions: history } }),
  'GET /sessions/:id/visit/versions/:n': (req) => ({
    data: visit({ version: Number(req.params.n), contentHash: 'a'.repeat(64) }),
  }),
  ...over,
});
const openRecord = (
  routes = recordRoutes(),
  language: 'en' | 'gu' = 'en',
  path = `/consult/${IDS.session}/record`,
) => renderApp({ role: 'doctor', path, language, routes });

describe('Visit record page', () => {
  it('shows the safety-not-run flag prominently, the hash and the structured snapshot, read only', async () => {
    await openRecord();
    expect((await screen.findAllByText('Safety checks were not run')).length).toBeGreaterThan(0);
    expect(screen.getByText(/no safety checks had been made/)).toBeTruthy();
    expect(screen.getAllByText(/b{64}/).length).toBeGreaterThan(0);
    const facts = screen.getByRole('region', { name: 'Facts' });
    expect(within(facts).getByText(/toy final words/)).toBeTruthy();
    expect(within(facts).getByText(/Engine proposed: toy engine words/)).toBeTruthy();
    const meds = screen.getByRole('region', { name: 'Medicines' });
    expect(within(meds).getByText(/Source: test fixture, page 26/)).toBeTruthy();
    expect(within(meds).getByText('Not in master list')).toBeTruthy();
    expect(screen.getByText('Working condition not listed: toy note')).toBeTruthy();
    // read only: no input, no save
    expect(document.querySelectorAll('input, textarea').length).toBe(0);
  });

  it('lists the version history with reasons and times, and opens an older version', async () => {
    await openRecord();
    const hist = await screen.findByRole('region', { name: 'Version history' });
    expect(within(hist).getByText('Version 2 (amendment) · Current')).toBeTruthy();
    expect(within(hist).getByText('Reason: wrong duration typed')).toBeTruthy();
    expect(within(hist).getByText('Version 1 (signed)')).toBeTruthy();
    const link = within(hist).getByRole('link', { name: 'View version 1' });
    expect(link.getAttribute('href')).toBe(`/consult/${IDS.session}/record?v=1`);
  });

  it('an older version is labelled older and shows its own content', async () => {
    await openRecord(recordRoutes(), 'en', `/consult/${IDS.session}/record?v=1`);
    expect(await screen.findByText('Older version')).toBeTruthy();
    expect(screen.getByText('Version 1 (signed)', { selector: 'span' })).toBeTruthy();
  });

  it('has an empty FHIR tab that says when it arrives', async () => {
    await openRecord();
    fireEvent.click(await screen.findByRole('tab', { name: 'FHIR' }));
    expect(await screen.findByText('Coming in Phase 9. No FHIR bundle exists yet.')).toBeTruthy();
  });

  it('says plainly when the visit is not signed yet', async () => {
    await openRecord(
      recordRoutes({
        'GET /sessions/:id/visit': () => ({
          status: 404,
          error: { code: 'NOT_FOUND', message: 'x' },
        }),
        'GET /sessions/:id/visit/versions': () => ({ data: { versions: [] } }),
      }),
    );
    expect(await screen.findByText('This visit is not signed yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to sign-off' })).toBeTruthy();
  });

  it('links to the amendment screen and works in Gujarati', async () => {
    await openRecord(recordRoutes(), 'gu');
    expect(await screen.findByText('મુલાકાતનો રેકોર્ડ', { selector: 'h1' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'આ મુલાકાતમાં સુધારો કરો' }).getAttribute('href')).toBe(
      `/consult/${IDS.session}/amend`,
    );
  });
});

describe('Amendment screen', () => {
  const amendRoutes = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
    'GET /sessions/:id/visit': () => ({ data: visit() }),
    'GET /sessions/:id/sign-readiness': () => ({
      data: {
        signed: true,
        blockers: [{ code: 'session_not_draft', count: 1 }],
        medicineCount: 2,
        safety: { configured: false, blocked: 0, message: 'x' },
        currentVersion: 1,
      },
    }),
    'GET /medicines': () => ({ data: { items: [], total: 0, limit: 10, offset: 0 } }),
    ...over,
  });
  const openAmend = (routes = amendRoutes(), language: 'en' | 'gu' = 'en') =>
    renderApp({ role: 'doctor', path: `/consult/${IDS.session}/amend`, language, routes });
  const submit = () => screen.getByRole('button', { name: 'Save amendment' }) as HTMLButtonElement;

  it('shows the version being replaced and starts with nothing changed and the button off', async () => {
    await openAmend();
    const replacing = await screen.findByRole('region', { name: 'Version being replaced' });
    expect(within(replacing).getByText(/Version 1 \(signed\)/)).toBeTruthy();
    expect(screen.getByText('Nothing changed yet.')).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it('shows exactly what changed, and needs a reason, the acknowledgement and the password', async () => {
    const { calls } = await openAmend(
      amendRoutes({
        'POST /sessions/:id/amend': () => ({
          status: 201,
          data: {
            ...summary({ version: 2, kind: 'amendment', reason: 'r' }),
            content: visit().content,
          },
        }),
      }),
    );
    await screen.findByRole('region', { name: 'Version being replaced' });
    const durations = screen.getAllByLabelText(/^Duration/) as HTMLInputElement[];
    fireEvent.change(durations[0] as HTMLInputElement, { target: { value: '3 days' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Hand-typed (FAKE)' }));
    const changes = screen.getByRole('region', { name: 'What changed' });
    expect(within(changes).getByText('Drug-A (FAKE): Duration 5 days → 3 days')).toBeTruthy();
    expect(within(changes).getByText('Removed: Hand-typed (FAKE)')).toBeTruthy();
    expect(submit().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Reason for the amendment/), {
      target: { value: 'wrong duration typed' },
    });
    fireEvent.change(screen.getByLabelText(/^Your password/), { target: { value: 'pw-for-test' } });
    expect(submit().disabled).toBe(true); // the acknowledgement is still missing
    fireEvent.click(screen.getByLabelText('Safety checks were not run'));
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    expect(await screen.findByText('Amendment saved')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/amend'));
    expect(post?.body).toMatchObject({
      reason: 'wrong duration typed',
      safetyNotRunAcknowledged: true,
      password: 'pw-for-test',
      medicines: [{ medicineId: fakeMedicine().id, frequency: 'BD', duration: '3 days' }],
    });
  });

  it('a safety-engine error blocks the amendment with a clear message', async () => {
    await openAmend(
      amendRoutes({
        'GET /sessions/:id/sign-readiness': () => ({
          data: {
            signed: true,
            blockers: [],
            medicineCount: 2,
            safety: { configured: true, blocked: 0, message: 'x', error: true },
            currentVersion: 1,
          },
        }),
      }),
    );
    await screen.findByRole('region', { name: 'Version being replaced' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Hand-typed (FAKE)' }));
    fireEvent.change(screen.getByLabelText(/^Reason for the amendment/), {
      target: { value: 'r' },
    });
    fireEvent.change(screen.getByLabelText(/^Your password/), { target: { value: 'pw' } });
    expect(await screen.findByText('Safety checks failed to run')).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it('shows the server refusal in words and clears the password', async () => {
    await openAmend(
      amendRoutes({
        'POST /sessions/:id/amend': () => ({
          status: 403,
          error: { code: 'INVALID_PASSWORD', message: 'x' },
        }),
      }),
    );
    await screen.findByRole('region', { name: 'Version being replaced' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Hand-typed (FAKE)' }));
    fireEvent.change(screen.getByLabelText(/^Reason for the amendment/), {
      target: { value: 'r' },
    });
    fireEvent.click(screen.getByLabelText('Safety checks were not run'));
    fireEvent.change(screen.getByLabelText(/^Your password/), { target: { value: 'wrong' } });
    fireEvent.click(submit());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('The password is not correct.'),
    );
    expect((screen.getByLabelText(/^Your password/) as HTMLInputElement).value).toBe('');
  });

  it('works in Gujarati', async () => {
    await openAmend(amendRoutes(), 'gu');
    expect(await screen.findByText('સહી થયેલી મુલાકાતમાં સુધારો', { selector: 'h1' })).toBeTruthy();
  });
});

describe('Previous visits in the workspace', () => {
  const visits = [
    {
      sessionId: '5eed0000-0000-4000-8000-0000000000b2',
      signedAt: '2026-10-20T09:00:00.000Z',
      currentVersion: 2,
      medicineCount: 3,
      factCount: 4,
      safetyNotRun: true,
    },
  ];
  const consult = (list: typeof visits) =>
    renderApp({
      role: 'doctor',
      path: `/consult/${IDS.session}`,
      routes: {
        'GET /sessions/:id/consent': () => ({ data: noConsent() }),
        'GET /sessions/:id/previous-visits': () => ({ data: { visits: list } }),
      },
    });

  it('lists earlier signed visits, each linking to the visit record', async () => {
    await consult(visits);
    const region = await screen.findByRole('region', { name: 'Previous visits' });
    expect(within(region).getByText('Version 2, 4 facts, 3 medicines')).toBeTruthy();
    expect(within(region).getByText('Safety checks were not run')).toBeTruthy();
    expect(within(region).getAllByRole('link')[0]?.getAttribute('href')).toBe(
      `/consult/${visits[0]?.sessionId}/record`,
    );
  });

  it('says so when there are none', async () => {
    await consult([]);
    expect(await screen.findByText('No earlier signed visits for this patient.')).toBeTruthy();
  });
});
