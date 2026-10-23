// FHIR tab of the visit record (Phase 9A, ADR-D40): validation badge, errors and warnings with paths, pretty JSON, the download
// button off unless the bundle is valid, a single automatic build when there is none, not-validated handling, the admin view
// without the bundle, Gujarati. Fake data only.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FhirBundleView, FhirList } from '../../api/fhir';
import { cleanupApp, IDS, renderApp, type Handler } from '../../test-utils/harness';

afterEach(cleanupApp);

const bundle = (over: Partial<FhirBundleView> = {}): FhirBundleView => ({
  kind: 'op_consult',
  version: 1,
  status: 'valid',
  errorCount: 0,
  warningCount: 1,
  infoCount: 0,
  issues: [
    {
      severity: 'warning',
      path: 'Bundle.entry[1].resource.identifier[0]',
      message: 'No code provided for the identifier type',
    },
  ],
  validatorVersion: '7.0.3',
  igVersion: '6.5.0',
  notValidatedReason: null,
  validatedAt: '2026-10-23T10:00:00.000Z',
  createdAt: '2026-10-23T10:00:00.000Z',
  bundle: { resourceType: 'Bundle', type: 'document', entry: [] },
  exportable: true,
  ...over,
});
const list = (bundles: FhirBundleView[], over: Partial<FhirList> = {}): FhirList => ({
  currentVersion: 1,
  versions: bundles.length ? [1] : [],
  version: 1,
  bundles,
  ...over,
});

const signedVisit = {
  version: 1,
  kind: 'signed',
  contentHash: 'a'.repeat(64),
  safetyConfigured: false,
  safetyNotRunAcknowledged: true,
  reason: null,
  signedBy: IDS.user('doctor'),
  signedAt: '2026-10-22T10:00:00.000Z',
  content: {
    schema: 1,
    sessionId: IDS.session,
    signedAt: '2026-10-22T10:00:00.000Z',
    facts: [],
    workingCondition: null,
    medicines: [],
    consent: { audio: true, aiProcessing: true },
    aiContentIncluded: false,
    amendedFrom: null,
  },
};
const versions = { versions: [{ ...signedVisit, content: undefined }] };

async function open(routes: Record<string, Handler>, language: 'en' | 'gu' = 'en') {
  const app = await renderApp({
    role: 'doctor',
    path: `/consult/${IDS.session}/record`,
    language,
    routes: {
      'GET /sessions/:id/visit': () => ({ data: signedVisit }),
      'GET /sessions/:id/visit/versions': () => ({ data: versions }),
      ...routes,
    },
  });
  fireEvent.click(await screen.findByRole('tab', { name: 'FHIR' }));
  return app;
}

describe('FHIR tab', () => {
  it('shows a valid bundle: badge, counts with the warning and its path, pretty JSON and an enabled download', async () => {
    await open({ 'GET /sessions/:id/fhir': () => ({ data: list([bundle()]) }) });
    const card = await screen.findByRole('region', {
      name: 'Consultation record (OPConsultRecord)',
    });
    expect(within(card).getByText('Valid')).toBeTruthy();
    expect(within(card).getByText('0 errors, 1 warnings')).toBeTruthy();
    expect(within(card).getByText('Bundle.entry[1].resource.identifier[0]')).toBeTruthy();
    expect(within(card).getByText('No code provided for the identifier type')).toBeTruthy();
    expect(within(card).getByText('ABDM IG 6.5.0; validator 7.0.3')).toBeTruthy();
    const json = within(card).getByLabelText('FHIR JSON: Consultation record (OPConsultRecord)');
    expect(json.textContent).toContain('"resourceType": "Bundle"');
    expect(
      (within(card).getByRole('button', { name: 'Download JSON' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('an invalid bundle shows its errors and warnings, says the visit stays signed, and the download is off', async () => {
    await open({
      'GET /sessions/:id/fhir': () => ({
        data: list([
          bundle({
            status: 'invalid',
            errorCount: 1,
            exportable: false,
            issues: [
              {
                severity: 'error',
                path: 'Bundle.entry[0].resource',
                message: 'Composition.subject: minimum required = 1',
              },
              { severity: 'warning', path: 'Bundle.entry[2]', message: 'a kept warning' },
            ],
          }),
        ]),
      }),
    });
    const card = await screen.findByRole('region', {
      name: 'Consultation record (OPConsultRecord)',
    });
    expect(within(card).getByText('Invalid')).toBeTruthy();
    expect(within(card).getByText('Composition.subject: minimum required = 1')).toBeTruthy();
    expect(within(card).getByText('a kept warning')).toBeTruthy();
    expect(within(card).getByText(/The visit stays signed/)).toBeTruthy();
    expect(
      (within(card).getByRole('button', { name: 'Download JSON' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(card).getByText(/Download is off/)).toBeTruthy();
  });

  it('downloads through the export route (which the server refuses unless valid) and saves the file', async () => {
    let body: unknown;
    const { calls } = await open({
      'GET /sessions/:id/fhir': () => ({ data: list([bundle()]) }),
      'POST /sessions/:id/fhir/export': (req) => {
        body = req.body;
        return {
          data: { filename: 'visit-x-v1-op_consult.json', bundle: { resourceType: 'Bundle' } },
        };
      },
    });
    const url = globalThis.URL;
    url.createObjectURL = () => 'blob:fake';
    url.revokeObjectURL = () => undefined;
    fireEvent.click(await screen.findByRole('button', { name: 'Download JSON' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/fhir/export'))).toBe(true));
    expect(body).toEqual({ kind: 'op_consult', version: 1 });
  });

  it('a bundle that was not validated says why, is shown, cannot be downloaded, and can be validated again once', async () => {
    let revalidate: unknown;
    await open({
      'GET /sessions/:id/fhir': () => ({
        data: list([
          bundle({
            status: 'not_validated',
            exportable: false,
            issues: [],
            warningCount: 0,
            validatorVersion: null,
            notValidatedReason: 'The FHIR validator could not be reached or timed out.',
          }),
        ]),
      }),
      'POST /sessions/:id/fhir': (req) => {
        revalidate = req.body;
        return { status: 201, data: list([bundle()]) };
      },
    });
    const card = await screen.findByRole('region', {
      name: 'Consultation record (OPConsultRecord)',
    });
    expect(within(card).getByText('Not validated')).toBeTruthy();
    expect(
      within(card).getByText('The FHIR validator could not be reached or timed out.'),
    ).toBeTruthy();
    expect(
      (within(card).getByRole('button', { name: 'Download JSON' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(card).getByRole('button', { name: 'Validate again' }));
    expect(await screen.findByText('Valid')).toBeTruthy();
    expect(revalidate).toEqual({ revalidate: true });
  });

  it('builds the bundles once when there are none, and does not retry a failure by itself', async () => {
    let posts = 0;
    const { callsTo } = await open({
      'GET /sessions/:id/fhir': () => ({ data: list([]) }),
      'POST /sessions/:id/fhir': () => {
        posts += 1;
        return { status: 500, error: { code: 'INTERNAL', message: 'x' } };
      },
    });
    expect(
      await screen.findByText('The bundles could not be built or checked. Nothing was retried.'),
    ).toBeTruthy();
    expect(posts).toBe(1);
    expect(callsTo('POST', `/sessions/${IDS.session}/fhir`)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Build and validate' })).toBeTruthy();
  });

  it('shows both documents when the visit has medicines', async () => {
    await open({
      'GET /sessions/:id/fhir': () => ({
        data: list([bundle(), bundle({ kind: 'prescription' })]),
      }),
    });
    expect(
      await screen.findByRole('region', { name: 'Consultation record (OPConsultRecord)' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'Prescription record (PrescriptionRecord)' }),
    ).toBeTruthy();
  });

  it('works in Gujarati', async () => {
    await open({ 'GET /sessions/:id/fhir': () => ({ data: list([bundle()]) }) }, 'gu');
    expect(await screen.findByText('માન્ય')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'JSON ડાઉનલોડ કરો' })).toBeTruthy();
  });
});

describe('FHIR status for the admin', () => {
  it('shows the verdict and the errors without the bundle, and cannot build', async () => {
    await renderApp({
      role: 'admin',
      path: `/admin/fhir/${IDS.session}`,
      routes: {
        'GET /sessions/:id/fhir': () => ({
          data: list([
            bundle({
              bundle: null,
              status: 'invalid',
              errorCount: 1,
              exportable: false,
              issues: [
                { severity: 'error', path: 'Bundle.entry[0]', message: 'a validator error' },
              ],
            }),
          ]),
        }),
      },
    });
    const card = await screen.findByRole('region', {
      name: 'Consultation record (OPConsultRecord)',
    });
    expect(within(card).getByText('Invalid')).toBeTruthy();
    expect(within(card).getByText('a validator error')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Download JSON' })).toBeNull();
    expect(document.querySelector('pre')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Build and validate' })).toBeNull();
  });

  it('does not build when nothing exists (the admin only reads)', async () => {
    const { callsTo } = await renderApp({
      role: 'admin',
      path: `/admin/fhir/${IDS.session}`,
      routes: { 'GET /sessions/:id/fhir': () => ({ data: list([]) }) },
    });
    expect(
      await screen.findByText('No FHIR bundle has been built for this version yet.'),
    ).toBeTruthy();
    expect(callsTo('POST', `/sessions/${IDS.session}/fhir`)).toHaveLength(0);
  });
});
