// PG-20 Data erasure requests (Phase 12B Run 2): the plain-words notice with its "to be confirmed" line, recording a request (staff),
// the admin queue (review, impact, complete with confirmation, refuse with a reason), failures in words, Gujarati. A small fake
// server keeps the state. Fake data only.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErasureImpact, ErasureRequest } from '../api/privacy';
import { cleanupApp, fakePatient, IDS, renderApp, type Handler } from '../test-utils/harness';

afterEach(cleanupApp);

const request = (over: Partial<ErasureRequest> = {}): ErasureRequest => ({
  id: '5eed0000-0000-4000-8000-0000000009a1',
  patientId: IDS.patient,
  patientName: 'Fake Patient',
  status: 'received',
  channel: 'phone',
  note: '',
  requestedByRole: 'staff',
  receivedAt: '2026-10-27T09:00:00.000Z',
  reviewedAt: null,
  decidedAt: null,
  refusalReason: null,
  result: null,
  ...over,
});
const IMPACT: ErasureImpact = {
  sessions: 2,
  signedVisitsKept: 1,
  audioRecordingsToDelete: 2,
  transcriptSegmentsToRemove: 3,
  factsToRemove: 4,
  prescriptionRowsToRemove: 1,
  derivedExportsToRemove: 2,
  abhaRowsToRemove: 2,
  clinicalProfileRowsToRemove: 1,
};

function server(initial: ErasureRequest[]) {
  const st = { items: initial, fail: null as null | { status: number } };
  const failure = () => {
    const f = st.fail;
    st.fail = null;
    return f ? { status: f.status, error: { code: 'CONFLICT', message: 'x' } } : null;
  };
  const routes: Record<string, Handler> = {
    'GET /privacy/requests': (req) => {
      const status = req.query.get('status');
      return { data: { items: st.items.filter((r) => !status || r.status === status) } };
    },
    'POST /patients/lookup': () => ({ data: { found: true, patient: fakePatient() } }),
    'POST /privacy/requests': (req) => {
      const f = failure();
      if (f) return f;
      const b = req.body as { channel: ErasureRequest['channel']; note: string };
      st.items = [
        request({ id: '5eed0000-0000-4000-8000-0000000009b2', channel: b.channel, note: b.note }),
        ...st.items,
      ];
      return { status: 201, data: st.items[0] };
    },
    'GET /privacy/requests/:id/impact': () => ({ data: { counts: IMPACT } }),
    'POST /privacy/requests/:id/review': (req) => {
      const f = failure();
      if (f) return f;
      st.items = st.items.map((r) => (r.id === req.params.id ? { ...r, status: 'in_review' } : r));
      return { data: st.items.find((r) => r.id === req.params.id) };
    },
    'POST /privacy/requests/:id/complete': (req) => {
      const f = failure();
      if (f) return f;
      st.items = st.items.map((r) =>
        r.id === req.params.id
          ? {
              ...r,
              status: 'completed',
              decidedAt: '2026-10-27T10:00:00.000Z',
              result: { sessions: 2, signedVisitsKept: 1, factsRemoved: 4 },
            }
          : r,
      );
      return { data: st.items.find((r) => r.id === req.params.id) };
    },
    'POST /privacy/requests/:id/refuse': (req) => {
      st.items = st.items.map((r) =>
        r.id === req.params.id
          ? { ...r, status: 'refused', refusalReason: (req.body as { reason: string }).reason }
          : r,
      );
      return { data: st.items.find((r) => r.id === req.params.id) };
    },
  };
  return { st, routes };
}

describe('the page', () => {
  it('says in plain words what is removed and kept, and that the signed-record rule is still to be confirmed', async () => {
    await renderApp({ role: 'admin', path: '/privacy/requests', routes: server([]).routes });
    await screen.findByRole('heading', { name: 'Data erasure requests', level: 1 });
    expect(screen.getByText(/Removed: audio recordings/)).toBeTruthy();
    expect(screen.getByText(/Kept: signed visit records/)).toBeTruthy();
    expect(
      screen.getByText(/To be confirmed: whether a signed clinical record must be kept/),
    ).toBeTruthy();
    expect(screen.getByText(/my guide \/ institution \/ a clinician/)).toBeTruthy();
    expect(await screen.findByText('No requests.')).toBeTruthy();
  });
});

describe('staff', () => {
  it('records a request after finding the patient, and sees only the list of their own', async () => {
    const s = server([]);
    const view = await renderApp({ role: 'staff', path: '/privacy/requests', routes: s.routes });
    await screen.findByRole('heading', { name: 'Data erasure requests', level: 1 });
    expect(screen.getByText(/You see the requests you recorded/)).toBeTruthy();
    // nothing yet: the summary names what is missing and takes focus
    fireEvent.click(screen.getByRole('button', { name: 'Record request' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Enter a 10-digit phone number.')).toBeTruthy();
    expect(within(alert).getByText('Choose how the request was made.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(alert));
    fireEvent.change(screen.getByLabelText('Patient phone number'), {
      target: { value: '0000000001' },
    });
    await screen.findByText('Patient: Fake Patient');
    fireEvent.change(screen.getByLabelText('How was the request made'), {
      target: { value: 'in_person' },
    });
    fireEvent.change(screen.getByLabelText(/Note \(optional\)/), {
      target: { value: 'asked at the desk' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record request' }));
    });
    await waitFor(() => expect(view.callsTo('POST', '/privacy/requests')).toHaveLength(1));
    expect(view.callsTo('POST', '/privacy/requests')[0]?.body).toEqual({
      patientId: IDS.patient,
      channel: 'in_person',
      note: 'asked at the desk',
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole('table')).getAllByText('Received').length,
      ).toBeGreaterThanOrEqual(2),
    ); // the column header and the status
    // staff have no review, complete or refuse buttons
    expect(screen.queryByRole('button', { name: /Start review/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Complete the request/ })).toBeNull();
  });

  it('says in words when there is already an open request', async () => {
    const s = server([]);
    s.st.fail = { status: 409 };
    await renderApp({ role: 'staff', path: '/privacy/requests', routes: s.routes });
    await screen.findByRole('heading', { name: 'Data erasure requests', level: 1 });
    fireEvent.change(screen.getByLabelText('Patient phone number'), {
      target: { value: '0000000001' },
    });
    await screen.findByText('Patient: Fake Patient');
    fireEvent.change(screen.getByLabelText('How was the request made'), {
      target: { value: 'phone' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record request' }));
    });
    expect(
      await screen.findByText(/There is already an open request for this patient/),
    ).toBeTruthy();
  });
});

describe('admin', () => {
  it('reviews, looks at the counts, completes only after the confirmation, and the result is shown', async () => {
    const s = server([request()]);
    const view = await renderApp({ role: 'admin', path: '/privacy/requests', routes: s.routes });
    await screen.findByText('Fake Patient');
    fireEvent.click(screen.getByRole('button', { name: /Start review/ }));
    await within(screen.getByRole('table')).findByText('In review');
    fireEvent.click(screen.getByRole('button', { name: /Show what would happen/ }));
    const impact = await screen
      .findByRole('region', { name: 'What would happen' })
      .catch(() => screen.getByText('What would happen').closest('section') as HTMLElement);
    expect(within(impact).getByText('Signed visit records kept')).toBeTruthy();
    expect(
      within(impact).getByText('Nothing has been changed yet.', { exact: false }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Complete the request/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Complete this request' });
    const submit = within(dialog).getByRole('button', {
      name: 'Complete request',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(
      view.callsTo('POST', '/privacy/requests/5eed0000-0000-4000-8000-0000000009a1/complete'),
    ).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(submit);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      view.callsTo('POST', '/privacy/requests/5eed0000-0000-4000-8000-0000000009a1/complete')[0]
        ?.body,
    ).toEqual({ confirm: true });
    expect(await within(screen.getByRole('table')).findByText('Completed')).toBeTruthy();
    expect(screen.getByText('What was done')).toBeTruthy();
  });

  it('refuses only with a reason, and shows the reason', async () => {
    const s = server([request()]);
    await renderApp({ role: 'admin', path: '/privacy/requests', routes: s.routes });
    await screen.findByText('Fake Patient');
    fireEvent.click(screen.getByRole('button', { name: /Refuse the request/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Refuse this request' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Refuse request' }));
    expect(
      await within(dialog).findByText('Write a reason of at least 3 characters.'),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'asked by someone else' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Refuse request' }));
    });
    expect(await screen.findByText('Reason: asked by someone else')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText('Refused')).toBeTruthy();
  });

  it('shows a conflict in words and reloads the list', async () => {
    const s = server([request()]);
    s.st.fail = { status: 409 };
    await renderApp({ role: 'admin', path: '/privacy/requests', routes: s.routes });
    await screen.findByText('Fake Patient');
    fireEvent.click(screen.getByRole('button', { name: /Start review/ }));
    expect(await screen.findByText(/cannot be changed in its current state/)).toBeTruthy();
  });

  it('works in Gujarati', async () => {
    await renderApp({
      role: 'admin',
      path: '/privacy/requests',
      routes: server([request()]).routes,
      language: 'gu',
    });
    await screen.findByRole('heading', { name: 'ડેટા ભૂંસવાની વિનંતીઓ', level: 1 });
    expect(screen.getByText(/OCI-016/)).toBeTruthy();
    expect(await screen.findByText('Fake Patient')).toBeTruthy();
    expect(screen.getByRole('button', { name: /સમીક્ષા શરૂ કરો/ })).toBeTruthy();
  });
});
