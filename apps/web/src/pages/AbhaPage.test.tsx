// PG-04 ABHA verification (Phase 9B, ADR-D42): the staged flow, the permanent MOCK/SANDBOX label, plain errors for each failure, the
// attestation gate, and the status badge on the patient card. Fake data and a fake API only.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupApp,
  fakePatient,
  IDS,
  renderApp,
  type Handler,
  type MockReply,
} from '../test-utils/harness';

afterEach(cleanupApp);

const status = (over: Record<string, unknown> = {}) => ({
  patientId: IDS.patient,
  verified: false,
  abhaAddress: null,
  verifiedAt: null,
  verifiedMode: null,
  mode: 'mock',
  notice: 'MOCK - a simulated check with fake identities. This is not a real ABHA verification.',
  mockOtp: '123456',
  mockIdentities: [
    { number: '91-0000-0000-0001', address: 'mock.success@mock.invalid', outcome: 'success' },
  ],
  ...over,
});
const statusRoute =
  (over: Record<string, unknown> = {}): Handler =>
  () => ({ data: status(over) });
const fail = (status: number, code: string, details?: Record<string, unknown>): MockReply => ({
  status,
  error: { code, message: 'server text that must not be shown', ...(details ? { details } : {}) },
});
const PATH = `/patients/${IDS.patient}/abha`;

const startFlow = async (routes: Record<string, Handler>, role: 'staff' | 'doctor' = 'staff') => {
  const view = await renderApp({
    role,
    path: PATH,
    routes: { 'GET /abha/status/:id': statusRoute(), ...routes },
  });
  await screen.findByRole('heading', { name: 'ABHA check', level: 1 });
  return view;
};
const fillAndSend = async (identity = 'mock.success@mock.invalid') => {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Test ABHA number or address'), {
    target: { value: identity },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }));
  });
};

describe('the labels', () => {
  it('says MOCK at the top, in a badge and in a banner', async () => {
    await startFlow({});
    expect(document.querySelectorAll('[data-abha-mode="mock"]').length).toBeGreaterThan(0);
    expect(await screen.findByText(/not a real ABHA verification/)).toBeTruthy();
  });
  it('says SANDBOX when the server runs against the sandbox, and lists no mock identities', async () => {
    await startFlow({
      'GET /abha/status/:id': statusRoute({ mode: 'sandbox', mockIdentities: null, mockOtp: null }),
    });
    expect(document.querySelectorAll('[data-abha-mode="sandbox"]').length).toBeGreaterThan(0);
    expect(screen.queryByText('Fake test identities')).toBeNull();
    expect(await screen.findByText(/not a real person/)).toBeTruthy();
  });
});

describe('the staged flow', () => {
  it('cannot send before the patient agreement is ticked and an identity is typed', async () => {
    const view = await startFlow({});
    const send = screen.getByRole('button', { name: 'Send OTP' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Test ABHA number or address'), {
      target: { value: 'mock.success@mock.invalid' },
    });
    expect(send.disabled).toBe(false);
    expect(view.callsTo('POST', '/abha/verify/start')).toHaveLength(0);
  });

  it('goes enter, OTP, result, and never keeps the number in the page', async () => {
    const view = await startFlow({
      'POST /abha/verify/start': () => ({
        status: 201,
        data: { txnId: IDS.session, mode: 'mock', notice: 'MOCK', expiresInSeconds: 600 },
      }),
      'POST /abha/verify/otp': () => ({
        data: status({
          verified: true,
          abhaAddress: 'mock.success@mock.invalid',
          verifiedAt: '2026-10-24T09:00:00.000Z',
          verifiedMode: 'mock',
        }),
      }),
    });
    await fillAndSend('91000000000001');
    const sent = view.callsTo('POST', '/abha/verify/start')[0];
    expect(sent?.body).toMatchObject({ patientId: IDS.patient, attested: true });
    await screen.findByRole('heading', { name: 'Enter the OTP' });
    expect(document.body.textContent).not.toContain('91000000000001');
    fireEvent.change(screen.getByLabelText('6-digit OTP'), { target: { value: '123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check OTP' }));
    });
    const heading = await screen.findByRole('heading', { name: 'ABHA checked (MOCK)' });
    expect(heading).toBeTruthy();
    expect(screen.getByText(/ABHA address: mock.success@mock.invalid/)).toBeTruthy();
    expect(screen.getByText(/The number and the OTP are not stored/)).toBeTruthy();
    expect(view.callsTo('POST', '/abha/verify/otp')[0]?.body).toEqual({
      txnId: IDS.session,
      otp: '123456',
    });
  });
});

describe('plain errors', () => {
  const startOk: Handler = () => ({
    status: 201,
    data: { txnId: IDS.session, mode: 'mock', notice: 'MOCK', expiresInSeconds: 600 },
  });
  const toOtp = async () => {
    await fillAndSend();
    await screen.findByRole('heading', { name: 'Enter the OTP' });
  };
  const checkOtp = async (code = '000000') => {
    fireEvent.change(screen.getByLabelText('6-digit OTP'), { target: { value: code } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check OTP' }));
    });
  };

  it('an identity that is not allowed', async () => {
    await startFlow({ 'POST /abha/verify/start': () => fail(400, 'ABHA_IDENTITY_REJECTED') });
    await fillAndSend('123456789012');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('This test ABHA is not allowed')).toBeTruthy();
    expect(document.body.textContent).not.toContain('server text that must not be shown');
    expect(screen.queryByRole('heading', { name: 'Enter the OTP' })).toBeNull();
  });
  it('a wrong OTP shows the tries left and stays on the OTP step', async () => {
    await startFlow({
      'POST /abha/verify/start': startOk,
      'POST /abha/verify/otp': () => fail(400, 'ABHA_OTP_WRONG', { attemptsLeft: 2 }),
    });
    await toOtp();
    await checkOtp();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('The OTP is not correct')).toBeTruthy();
    expect(within(alert).getByText(/Tries left: 2/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Enter the OTP' })).toBeTruthy();
  });
  it('an expired OTP sends the person back to the first step', async () => {
    await startFlow({
      'POST /abha/verify/start': startOk,
      'POST /abha/verify/otp': () => fail(410, 'ABHA_OTP_EXPIRED'),
    });
    await toOtp();
    await checkOtp();
    expect(await screen.findByText('The OTP has expired')).toBeTruthy();
    await screen.findByRole('heading', { name: 'Enter a test ABHA' });
  });
  it('rate limit, outage and unknown account each have their own words', async () => {
    for (const [status, code, title] of [
      [429, 'ABHA_RATE_LIMITED', 'Too many tries'],
      [503, 'ABHA_UNAVAILABLE', 'The ABHA service is not answering'],
      [422, 'ABHA_NOT_FOUND', 'No ABHA account found'],
    ] as const) {
      await startFlow({ 'POST /abha/verify/start': () => fail(status, code) });
      await fillAndSend();
      expect(await screen.findByText(title)).toBeTruthy();
      cleanupApp();
    }
  });
});

describe('the status badge', () => {
  it('shows on the patient card with the mode, and links to the page', async () => {
    await renderApp({
      role: 'staff',
      path: '/patients',
      routes: {
        'POST /patients/lookup': () => ({ data: { found: true, patient: fakePatient() } }),
        'GET /abha/status/:id': statusRoute({
          verified: true,
          abhaAddress: 'mock.success@mock.invalid',
          verifiedMode: 'mock',
        }),
      },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0000000001' } });
    const badge = await screen.findByTestId('abha-badge');
    expect(badge.textContent).toContain('ABHA checked (MOCK)');
    expect(badge.querySelector('[data-abha-mode="mock"]')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Check ABHA' });
    expect(link.getAttribute('href')).toBe(PATH);
  });
  it('is left out when the status cannot be read', async () => {
    await renderApp({
      role: 'staff',
      path: '/patients',
      routes: {
        'POST /patients/lookup': () => ({ data: { found: true, patient: fakePatient() } }),
      },
    });
    await screen.findByRole('heading', { name: 'Patients', level: 1 });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0000000001' } });
    await screen.findByRole('article');
    await waitFor(() => expect(screen.queryByTestId('abha-badge')).toBeNull());
  });
});
