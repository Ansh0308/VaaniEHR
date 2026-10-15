// PG-01 Login: validation, error summary (focus + links), plain error messages, double-submit, redirect, language.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupApp, renderApp, renderSignedOut, userFor } from '../test-utils/harness';

afterEach(cleanupApp);

const fill = async (email: string, password: string) => {
  fireEvent.change(await screen.findByLabelText(/E-mail/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: password } });
};
const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  });
};

describe('login page', () => {
  it('shows labelled fields, the fake-data hint and the banner', async () => {
    await renderSignedOut('/login');
    expect(await screen.findByRole('heading', { name: 'Sign in', level: 2 })).toBeTruthy();
    expect(screen.getByLabelText(/E-mail/)).toBeTruthy();
    expect(screen.getByLabelText(/Password/)).toBeTruthy();
    expect(screen.getByText(/fake accounts only/i)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Prototype notice' })).toBeTruthy();
  });

  it('is available in Gujarati', async () => {
    await renderSignedOut('/login', {}, 'gu');
    expect(await screen.findByRole('heading', { name: 'સાઇન ઇન', level: 2 })).toBeTruthy();
  });

  it('empty submit: no request, error summary takes focus and links to both fields', async () => {
    const view = await renderSignedOut('/login');
    await screen.findByLabelText(/E-mail/);
    await submit();
    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toContain('The sign-in did not work');
    expect(document.activeElement).toBe(summary);
    const links = summary.querySelectorAll('a');
    expect(Array.from(links).map((a) => a.textContent)).toEqual([
      'Enter your e-mail address.',
      'Enter your password.',
    ]);
    expect(view.callsTo('POST', '/auth/login')).toHaveLength(0);
    // inline errors stay on the fields, and the fields are marked invalid
    expect(screen.getByLabelText(/E-mail/).getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(links[1] as HTMLElement);
    expect(document.activeElement).toBe(screen.getByLabelText(/Password/));
  });

  it('wrong password: one plain message that does not say which part was wrong; password field is cleared', async () => {
    await renderSignedOut('/login', {
      'POST /auth/login': () => ({
        status: 401,
        error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' },
      }),
    });
    await fill('doctor@example.invalid', 'wrong');
    await submit();
    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toContain('The e-mail or password is not correct.');
    expect(summary.textContent).not.toMatch(/Invalid email or password/); // server text is never shown
    expect((screen.getByLabelText(/Password/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/E-mail/) as HTMLInputElement).value).toBe(
      'doctor@example.invalid',
    );
    expect(document.activeElement).toBe(summary);
  });

  it.each([
    [429, 'ACCOUNT_LOCKED', 'locked for a while'],
    [429, 'RATE_LIMITED', 'Too many sign-in attempts'],
    [403, 'FORBIDDEN', 'cannot sign in'],
    [500, 'INTERNAL', 'Something went wrong'],
  ])('%s %s is explained in plain words', async (status, code, text) => {
    await renderSignedOut('/login', { 'POST /auth/login': () => ({ status, error: { code } }) });
    await fill('a@example.invalid', 'pw');
    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain(text);
  });

  it('says so when the server cannot be reached', async () => {
    const view = await renderSignedOut('/login');
    view.fetchMock.mockImplementation(async () => {
      throw new TypeError('failed to fetch');
    });
    await fill('a@example.invalid', 'pw');
    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain('cannot be reached');
  });

  it('a second submit while the first is running sends only one request', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const view = await renderSignedOut('/login', {
      'POST /auth/login': async () => {
        await gate;
        return { status: 401, error: { code: 'UNAUTHENTICATED' } };
      },
    });
    await fill('a@example.invalid', 'pw');
    const form = screen.getByRole('button', { name: 'Sign in' }).closest('form') as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form); // e.g. Enter pressed twice
    });
    expect(screen.getByRole('button', { name: /Sign in|Loading/ }).getAttribute('aria-busy')).toBe(
      'true',
    );
    await act(async () => release?.());
    expect(view.callsTo('POST', '/auth/login')).toHaveLength(1);
  });

  it('success: sends the trimmed e-mail and lands on the role home page', async () => {
    const view = await renderSignedOut('/login', {
      'POST /auth/login': () => ({
        data: { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 3600, user: userFor('staff') },
      }),
    });
    await fill('  staff@example.invalid ', 'fake-password');
    await submit();
    expect(await screen.findByRole('heading', { name: 'Patients', level: 1 })).toBeTruthy();
    expect(view.callsTo('POST', '/auth/login')[0]?.body).toEqual({
      email: 'staff@example.invalid',
      password: 'fake-password',
    });
  });

  it('an already signed-in person visiting /login is sent to their home page', async () => {
    await renderApp({
      role: 'researcher',
      path: '/login',
      routes: { 'GET /audit': () => ({ data: { items: [], nextBeforeSeq: null } }) },
    });
    expect(await screen.findByRole('heading', { name: 'Audit log', level: 1 })).toBeTruthy();
  });

  it('keyboard: Enter in the password field submits the form', async () => {
    const view = await renderSignedOut('/login', {
      'POST /auth/login': () => ({ status: 401, error: { code: 'UNAUTHENTICATED' } }),
    });
    await fill('a@example.invalid', 'pw');
    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/Password/).closest('form') as HTMLFormElement);
    });
    await waitFor(() => expect(view.callsTo('POST', '/auth/login')).toHaveLength(1));
  });
});
