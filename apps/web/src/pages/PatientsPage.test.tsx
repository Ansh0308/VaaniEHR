// PG-03 Patients: phone-first lookup, quick-create dialog, prominent and editable allergy chips, session-code box.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupApp,
  fakeNotices,
  fakePatient,
  IDS,
  noConsent,
  renderApp,
  type Handler,
} from '../test-utils/harness';

afterEach(cleanupApp);

const found =
  (over: Record<string, unknown> = {}): Handler =>
  () => ({ data: { found: true, patient: fakePatient(over) } });
const missing: Handler = () => ({ data: { found: false } });
const type = (value: string) =>
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value } });

describe('patient lookup', () => {
  it('matches by itself once ten digits are typed and shows allergies before anything else', async () => {
    const view = await renderApp({
      role: 'staff',
      path: '/patients',
      routes: { 'POST /patients/lookup': found() },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000001');
    const card = await screen.findByRole('article');
    // the allergy section precedes the patient name in reading order
    const text = card.textContent ?? '';
    expect(text.indexOf('Allergies')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Allergies')).toBeLessThan(text.indexOf('Fake Patient'));
    expect(within(card).getByText('Drug-A (FAKE)')).toBeTruthy();
    expect(within(card).getByText(/17 May 1990/)).toBeTruthy();
    expect(within(card).getByText(/Age \d+/)).toBeTruthy();
    expect(screen.getByText('Patient found')).toBeTruthy();
    expect(view.callsTo('POST', '/patients/lookup')).toHaveLength(1);
  });

  it('accepts typed formatting and sends plain digits in the body, never in the URL', async () => {
    const view = await renderApp({
      role: 'staff',
      path: '/patients',
      routes: { 'POST /patients/lookup': found() },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('00000-00001');
    await screen.findByRole('article');
    expect(view.callsTo('POST', '/patients/lookup')[0]?.body).toEqual({ phone: '0000000001' });
    // (the ABHA status URL holds the patient's UUID, which the fake data builds from similar digits)
    for (const call of view.fetchMock.mock.calls)
      if (!String(call[0]).includes('/abha/status/'))
        expect(String(call[0])).not.toContain('0000000001');
  });

  it('does not search for fewer than ten digits, and explains on Find', async () => {
    const view = await renderApp({ role: 'staff', path: '/patients' });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('123456');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(view.callsTo('POST', '/patients/lookup')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText('Enter a 10-digit phone number.')).toBeTruthy();
    expect(screen.getByLabelText('Phone number').getAttribute('aria-invalid')).toBe('true');
  });

  it('Enter in the phone box searches (keyboard flow)', async () => {
    const view = await renderApp({
      role: 'staff',
      path: '/patients',
      routes: { 'POST /patients/lookup': found() },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000001');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Phone number').closest('form') as HTMLFormElement);
    });
    await waitFor(() => expect(view.callsTo('POST', '/patients/lookup').length).toBeGreaterThan(0));
  });

  it('a lookup failure is explained in plain words', async () => {
    await renderApp({
      role: 'staff',
      path: '/patients',
      routes: { 'POST /patients/lookup': () => ({ status: 500, error: { code: 'INTERNAL' } }) },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000001');
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
  });

  it('a patient with no allergies and no date of birth is shown honestly (nothing invented)', async () => {
    await renderApp({
      role: 'staff',
      path: '/patients',
      routes: {
        'POST /patients/lookup': found({ allergies: [], dob: null, name: null, gender: null }),
      },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000001');
    const card = await screen.findByRole('article');
    expect(within(card).getByText('No allergies on record.')).toBeTruthy();
    expect(within(card).getByText('(no name on record)')).toBeTruthy();
    expect(within(card).getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2);
  });
});

describe('register a new patient', () => {
  it('offers to register when the number is unknown, opens a dialog, and shows the new patient', async () => {
    const view = await renderApp({
      role: 'staff',
      path: '/patients',
      routes: {
        'POST /patients/lookup': missing,
        'POST /patients': () => ({
          status: 201,
          data: {
            created: true,
            patient: fakePatient({ phone: '0000000555', name: 'New Fake', allergies: [] }),
          },
        }),
      },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000555');
    const banner = await screen.findByText('No patient with this number');
    expect(banner).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    const dialog = await screen.findByRole('dialog', { name: 'Register a new patient' });
    expect((within(dialog).getByLabelText('Phone number') as HTMLInputElement).value).toBe(
      '0000000555',
    );
    expect((within(dialog).getByLabelText('Phone number') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Name (optional)'), {
      target: { value: ' New Fake ' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    });
    expect(view.callsTo('POST', '/patients')[0]?.body).toEqual({
      phone: '0000000555',
      name: 'New Fake',
      optInMsg: true,
    });
    expect(await screen.findByRole('article')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Patient registered')).toBeTruthy();
  });

  it('only the phone is required: it can be registered with nothing else', async () => {
    const view = await renderApp({
      role: 'admin',
      path: '/patients',
      routes: {
        'POST /patients/lookup': missing,
        'POST /patients': () => ({
          status: 201,
          data: { created: true, patient: fakePatient({ allergies: [] }) },
        }),
      },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000556');
    fireEvent.click(await screen.findByRole('button', { name: 'Register patient' }));
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    });
    expect(view.callsTo('POST', '/patients')[0]?.body).toEqual({
      phone: '0000000556',
      optInMsg: true,
    });
  });

  it('a future date of birth is refused with a focused error summary and no request', async () => {
    const view = await renderApp({
      role: 'staff',
      path: '/patients',
      routes: { 'POST /patients/lookup': missing },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000557');
    fireEvent.click(await screen.findByRole('button', { name: 'Register patient' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Date of birth/), {
      target: { value: '2999-01-01' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    });
    const summary = within(dialog).getByRole('alert');
    expect(summary.textContent).toContain('The date of birth cannot be in the future.');
    expect(document.activeElement).toBe(summary);
    expect(view.callsTo('POST', '/patients')).toHaveLength(0);
  });

  it('a server refusal keeps the dialog open and says why in plain words', async () => {
    await renderApp({
      role: 'staff',
      path: '/patients',
      routes: {
        'POST /patients/lookup': missing,
        'POST /patients': () => ({ status: 400, error: { code: 'VALIDATION_ERROR' } }),
      },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000558');
    fireEvent.click(await screen.findByRole('button', { name: 'Register patient' }));
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    });
    expect((await within(dialog).findByRole('alert')).textContent).toContain('not valid');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Escape closes the dialog and focus goes back to the phone box', async () => {
    await renderApp({
      role: 'staff',
      path: '/patients',
      routes: { 'POST /patients/lookup': missing },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000559');
    fireEvent.click(await screen.findByRole('button', { name: 'Register patient' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByLabelText('Phone number'));
  });
});

describe('allergy chips', () => {
  async function open(allergies = ['Drug-A (FAKE)', 'Food-X (FAKE)']) {
    const view = await renderApp({
      role: 'staff',
      path: '/patients',
      routes: {
        'POST /patients/lookup': found({ allergies }),
        'PUT /patients/:id/clinical-profile': (req) => ({
          data: { allergies: (req.body as { allergies: string[] }).allergies },
        }),
      },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000001');
    await screen.findByRole('article');
    return view;
  }

  it('removing and adding chips marks the list unsaved; saving sends the whole list and clears the mark', async () => {
    const view = await open();
    const save = screen.getByRole('button', { name: 'Save allergies' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove allergy Food-X (FAKE)' }));
    fireEvent.change(screen.getByLabelText(/Add an allergy/), {
      target: { value: ' Drug-Z (FAKE) ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('You have unsaved changes to the allergy list.')).toBeTruthy();
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(view.callsTo('PUT', `/patients/${IDS.patient}/clinical-profile`)[0]?.body).toEqual({
      allergies: ['Drug-A (FAKE)', 'Drug-Z (FAKE)'],
    });
    expect(await screen.findByText('Allergies saved')).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save allergies' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it('refuses a duplicate (any letter case) and an over-long entry', async () => {
    await open();
    const input = screen.getByLabelText(/Add an allergy/);
    fireEvent.change(input, { target: { value: 'drug-a (fake)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('This allergy is already in the list.')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'x'.repeat(201) } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('An allergy can be at most 200 characters.')).toBeTruthy();
  });

  it('a failed save keeps the unsaved list and says so', async () => {
    await renderApp({
      role: 'staff',
      path: '/patients',
      routes: {
        'POST /patients/lookup': found(),
        'PUT /patients/:id/clinical-profile': () => ({ status: 500, error: { code: 'INTERNAL' } }),
      },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    type('0000000001');
    await screen.findByRole('article');
    fireEvent.click(screen.getByRole('button', { name: 'Remove allergy Drug-A (FAKE)' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save allergies' }));
    });
    expect(await screen.findByText('Allergies were not saved')).toBeTruthy();
    expect(screen.getByText('You have unsaved changes to the allergy list.')).toBeTruthy();
  });
});

describe('open a consent page by session code', () => {
  it('rejects something that is not a session code, and opens the consent page for a real one', async () => {
    await renderApp({
      role: 'staff',
      path: '/patients',
      routes: {
        'GET /sessions/:id': () => ({
          data: {
            id: IDS.session,
            tokenId: null,
            patientId: IDS.patient,
            doctorId: IDS.user('doctor'),
            clinicId: IDS.clinic,
            startedAt: '2026-10-15T09:30:00.000Z',
            endedAt: null,
            languageMix: null,
            status: 'created',
          },
        }),
        'GET /sessions/:id/consent': () => ({ data: noConsent() }),
        'GET /consent/notice': () => ({ data: fakeNotices() }),
        'GET /patients/:id': () => ({ data: fakePatient() }),
      },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    fireEvent.change(screen.getByLabelText(/Session code/), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open consent page' }));
    expect(await screen.findByText('That is not a valid session code.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Session code/), { target: { value: IDS.session } });
    fireEvent.click(screen.getByRole('button', { name: 'Open consent page' }));
    expect(await screen.findByRole('heading', { name: 'Consent', level: 1 })).toBeTruthy();
  });
});
