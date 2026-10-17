// PG-16 Audit log: filters (user, action, date), verify badge, paging, CSV export, researcher's reduced view.
import { AUDIT_ACTIONS } from '../api/auditActions';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupApp, IDS, renderApp, type Handler } from '../test-utils/harness';

afterEach(cleanupApp);

const row = (seq: number, over: Record<string, unknown> = {}) => ({
  seq,
  ts: '2026-10-15T10:00:00.000Z',
  action: 'LOGIN_SUCCEEDED',
  resourceType: 'user',
  actorRole: 'staff',
  actorUserId: IDS.user('staff'),
  resourceId: IDS.user('staff'),
  sessionId: null,
  requestId: 'r',
  rowHash: 'h',
  ...over,
});
const page =
  (items: unknown[], nextBeforeSeq: number | null = null): Handler =>
  () => ({
    data: { items, nextBeforeSeq },
  });
const verifyOk: Handler = () => ({ data: { ok: true } });

const openAudit = (role: 'admin' | 'researcher', routes: Record<string, Handler> = {}) =>
  renderApp({
    role,
    path: '/admin/audit',
    routes: {
      'GET /audit': page([row(3), row(2, { action: 'PATIENT_LOOKUP' })]),
      'GET /audit/verify': verifyOk,
      ...routes,
    },
  });

describe('audit table', () => {
  it('admin sees full rows: action names in words, user with role, record type and id', async () => {
    await openAudit('admin');
    const table = await screen.findByRole('table', { name: 'Audit log' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Signed in')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Patient looked up')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(/Staff/)).toBeTruthy();
    // the user id and the record id are both shown, shortened
    expect(
      within(rows[0] as HTMLElement).getAllByText('5eed0000…', { selector: 'code' }),
    ).toHaveLength(2);
    expect(within(table).getByRole('columnheader', { name: 'User' })).toBeTruthy();
  });

  it('researcher gets anonymised rows only: no user, no record id, no user filter, no export, no chain check', async () => {
    const view = await openAudit('researcher', {
      'GET /audit': page([
        {
          seq: 3,
          ts: '2026-10-15T10:00:00.000Z',
          action: 'LOGIN_SUCCEEDED',
          resourceType: 'user',
          actorRole: 'staff',
        },
      ]),
    });
    const table = await screen.findByRole('table', { name: 'Audit log' });
    expect(within(table).queryByRole('columnheader', { name: 'User' })).toBeNull();
    expect(within(table).queryByRole('columnheader', { name: 'Record ID' })).toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'Role' })).toBeTruthy();
    expect(screen.queryByLabelText('User ID')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Filter by this user' })).toBeNull();
    expect(screen.getByText('Chain verification is available to admins.')).toBeTruthy();
    expect(view.callsTo('GET', '/audit/verify')).toHaveLength(0); // never asks for what it may not have
    expect(document.body.textContent).not.toContain('5eed0000');
  });

  it('has loading, empty and error states', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    await openAudit('admin', {
      'GET /audit': async () => {
        await gate;
        return { data: { items: [], nextBeforeSeq: null } };
      },
    });
    expect(screen.getByText('Loading the audit log')).toBeTruthy();
    await act(async () => release?.());
    expect(await screen.findByText('No audit entries yet.')).toBeTruthy();
  });

  it('shows a plain error with retry', async () => {
    let n = 0;
    await openAudit('admin', {
      'GET /audit': () =>
        ++n === 1
          ? { status: 500, error: { code: 'INTERNAL' } }
          : { data: { items: [row(1)], nextBeforeSeq: null } },
    });
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Audit log' })).toBeTruthy();
  });

  it('"Load more" asks for older rows with the cursor', async () => {
    const view = await openAudit('admin', {
      'GET /audit': (req) =>
        req.query.get('beforeSeq')
          ? { data: { items: [row(1, { action: 'LOGOUT' })], nextBeforeSeq: null } }
          : { data: { items: [row(3), row(2)], nextBeforeSeq: 2 } },
    });
    await screen.findByRole('table', { name: 'Audit log' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    });
    const table = screen.getByRole('table', { name: 'Audit log' });
    expect(await within(table).findByText('Signed out')).toBeTruthy();
    expect(view.calls.filter((c) => c.path === '/audit').at(-1)?.query['beforeSeq']).toBe('2');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

describe('chain verification badge', () => {
  it('shows "Chain verified" with an icon and text', async () => {
    await openAudit('admin');
    const badge = await screen.findByText('Chain verified');
    expect(badge.closest('[data-state="clear"]')).toBeTruthy();
  });

  it('shows the broken row number when the chain is broken', async () => {
    await openAudit('admin', {
      'GET /audit/verify': () => ({
        data: { ok: false, firstBrokenSeq: 7, reason: 'row_hash_mismatch' },
      }),
    });
    const badge = await screen.findByText('Chain broken at row 7');
    expect(badge.closest('[data-state="blocked"]')).toBeTruthy();
  });

  it('says so when the check cannot run, and "Verify again" asks again', async () => {
    let n = 0;
    const view = await openAudit('admin', {
      'GET /audit/verify': () =>
        ++n === 1 ? { status: 500, error: { code: 'INTERNAL' } } : { data: { ok: true } },
    });
    expect(await screen.findByText('Chain check could not run')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Verify again' }));
    expect(await screen.findByText('Chain verified')).toBeTruthy();
    expect(view.callsTo('GET', '/audit/verify')).toHaveLength(2);
  });
});

describe('filters', () => {
  const setup = () => openAudit('admin');
  const lastAuditQuery = (view: Awaited<ReturnType<typeof setup>>) =>
    view.calls.filter((c) => c.method === 'GET' && c.path === '/audit').at(-1)?.query ?? {};

  it('action and date range are sent to the API; unset filters are not', async () => {
    const view = await setup();
    await screen.findByRole('table', { name: 'Audit log' });
    expect(lastAuditQuery(view)).toEqual({ limit: '50' });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'PATIENT_LOOKUP' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(lastAuditQuery(view)['action']).toBe('PATIENT_LOOKUP'));
    expect(lastAuditQuery(view)).toEqual({
      limit: '50',
      action: 'PATIENT_LOOKUP',
      from: '2026-10-01',
      to: '2026-10-15',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastAuditQuery(view)).toEqual({ limit: '50' }));
    expect((screen.getByLabelText('Action') as HTMLSelectElement).value).toBe('');
  });

  it('lists every audit action the API can write, in words', async () => {
    await setup();
    await screen.findByRole('table', { name: 'Audit log' });
    const options = within(screen.getByLabelText('Action'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('Any action');
    expect(options).toContain('Audit log exported');
    expect(options).toContain('Consent withdrawn');
    expect(options.length).toBe(AUDIT_ACTIONS.length + 1); // every action the API can write, plus "Any action"
  });

  it('"Filter by this user" in a row applies the user filter', async () => {
    const view = await setup();
    await screen.findByRole('table', { name: 'Audit log' });
    fireEvent.click(
      screen.getAllByRole('button', { name: /Filter by this user/ })[0] as HTMLElement,
    );
    await waitFor(() => expect(lastAuditQuery(view)['actorUserId']).toBe(IDS.user('staff')));
    expect((screen.getByLabelText(/User ID/) as HTMLInputElement).value).toBe(IDS.user('staff'));
  });

  it('a malformed user id or a reversed date range is refused with a focused summary and no request', async () => {
    const view = await setup();
    await screen.findByRole('table', { name: 'Audit log' });
    const before = view.callsTo('GET', '/audit').length;
    fireEvent.change(screen.getByLabelText(/User ID/), { target: { value: 'not-a-uuid' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-15' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    const summary = await screen.findByRole('alert', { name: 'The filters were not applied' });
    expect(summary.textContent).toContain('That is not a valid user ID.');
    expect(summary.textContent).toContain('The start date must not be after the end date.');
    expect(document.activeElement).toBe(summary);
    expect(view.callsTo('GET', '/audit')).toHaveLength(before);
  });

  it('says when nothing matches the filters', async () => {
    await openAudit('admin', {
      'GET /audit': (req) =>
        req.query.get('action')
          ? { data: { items: [], nextBeforeSeq: null } }
          : { data: { items: [row(1)], nextBeforeSeq: null } },
    });
    await screen.findByRole('table', { name: 'Audit log' });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'LOGOUT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByText('No entries match these filters.')).toBeTruthy();
  });
});

describe('CSV export (admin)', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:fake'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  });

  const exportRoute =
    (rows: number, truncated: boolean): Handler =>
    () => ({
      text: 'seq,ts\r\n1,2\r\n',
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="audit-2026-10-15.csv"',
        'X-Exported-Rows': String(rows),
        'X-Export-Truncated': String(truncated),
      },
    });

  it('sends the current filters, downloads the file and says how many rows', async () => {
    const view = await openAudit('admin', { 'POST /audit/export': exportRoute(2, false) });
    await screen.findByRole('table', { name: 'Audit log' });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'PATIENT_LOOKUP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(view.calls.some((c) => c.query['action'] === 'PATIENT_LOOKUP')).toBe(true),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    });
    await waitFor(() => expect(view.callsTo('POST', '/audit/export')).toHaveLength(1));
    expect(view.callsTo('POST', '/audit/export')[0]?.body).toEqual({ action: 'PATIENT_LOOKUP' });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(await screen.findByText('Exported rows: 2')).toBeTruthy();
    expect(screen.queryByText('The export was cut short')).toBeNull();
  });

  it('tells the admin plainly when the export was cut at the row cap', async () => {
    await openAudit('admin', { 'POST /audit/export': exportRoute(5000, true) });
    await screen.findByRole('table', { name: 'Audit log' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    });
    const banner = await screen.findByText('The export was cut short');
    expect(banner.closest('[role="status"]')?.textContent).toContain(
      'Only the newest 5000 rows were exported',
    );
  });

  it('a failed export is explained and nothing is downloaded', async () => {
    await openAudit('admin', {
      'POST /audit/export': () => ({ status: 500, error: { code: 'INTERNAL' } }),
    });
    await screen.findByRole('table', { name: 'Audit log' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    });
    expect(await screen.findByText('The export failed')).toBeTruthy();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('states that the file holds IDs only and that the export itself is recorded', async () => {
    await openAudit('admin');
    expect(await screen.findByText(/holds IDs only/)).toBeTruthy();
  });
});
