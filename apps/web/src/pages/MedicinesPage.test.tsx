// PG-12 Medicine master: table, sort, filters, badges, add / edit / retire / restore, error states, role visibility.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupApp, renderApp, type Handler } from '../test-utils/harness';
import { fakeMedicine, MED } from '../test-utils/medicineFixtures';

afterEach(cleanupApp);

const A = fakeMedicine({
  brands: [{ id: 'b1', brandName: 'Brand-X', manufacturer: null, source: 's' }],
});
const B = fakeMedicine({
  id: MED(2),
  genericName: 'Drug-B (FAKE)',
  strength: '10 mg',
  doseForm: 'Capsule',
  sourcePage: 4,
  sourcePagePrinted: 3,
  reviewStatus: 'reviewed',
  reviewedOn: '2026-10-01',
  reviewedBy: 'Dr Fake Reviewer',
});
const R = fakeMedicine({ id: MED(3), genericName: 'Drug-R (FAKE)', retired: true });

const list =
  (rows = [A, B]): Handler =>
  (req) => {
    const retired = req.query.get('includeRetired') === 'true';
    const items = [...rows, ...(retired ? [R] : [])];
    return { data: { items, total: items.length, limit: 25, offset: 0 } };
  };
const base: Record<string, Handler> = {
  'GET /medicines': list(),
  'GET /medicines/categories': () => ({
    data: {
      categories: [
        { name: 'Section One', count: 2 },
        { name: 'Section Two', count: 1 },
      ],
    },
  }),
};

const show = (routes: Record<string, Handler> = {}, language: 'en' | 'gu' = 'en') =>
  renderApp({
    role: 'admin',
    path: '/admin/medicines',
    language,
    routes: { ...base, ...routes },
  });

describe('Medicine master page', () => {
  it('shows each row with its source, "PDF p. 27, printed 26", and a Not reviewed / Reviewed badge', async () => {
    await show();
    const table = await screen.findByRole('table', { name: 'Medicine master' });
    const a = within(table).getByText('Drug-A (FAKE)').closest('tr') as HTMLElement;
    expect(a.textContent).toContain('500 mg');
    expect(a.textContent).toContain('Tablet');
    expect(a.textContent).toContain('PDF p. 27, printed 26');
    expect(a.textContent).toContain('Not reviewed');
    expect(a.textContent).toContain('Brand: Brand-X');
    const b = within(table).getByText('Drug-B (FAKE)').closest('tr') as HTMLElement;
    expect(b.textContent).toContain('PDF p. 4, printed 3');
    expect(b.textContent).toMatch(/Reviewed/);
    expect(b.textContent).not.toContain('Not reviewed');
  });

  it('says there is no CSV upload and offers none', async () => {
    await show();
    await screen.findByRole('table');
    expect(screen.getByText(/no CSV upload/i)).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('sorts on the server: clicking a header asks for that column, again reverses it, and aria-sort follows', async () => {
    const app = await show();
    const table = await screen.findByRole('table');
    const header = () => within(table).getByRole('columnheader', { name: /Strength/ });
    expect(app.callsTo('GET', '/medicines')[0]?.query).toMatchObject({
      sort: 'name',
      order: 'asc',
    });

    fireEvent.click(within(header()).getByRole('button'));
    await waitFor(() =>
      expect(app.callsTo('GET', '/medicines').at(-1)?.query).toMatchObject({
        sort: 'strength',
        order: 'asc',
      }),
    );
    await waitFor(() => expect(header().getAttribute('aria-sort')).toBe('ascending'));
    fireEvent.click(within(header()).getByRole('button'));
    await waitFor(() =>
      expect(app.callsTo('GET', '/medicines').at(-1)?.query).toMatchObject({
        sort: 'strength',
        order: 'desc',
      }),
    );
    await waitFor(() => expect(header().getAttribute('aria-sort')).toBe('descending'));
  });

  it('filters by category from the categories list', async () => {
    const app = await show();
    await screen.findByRole('table');
    const select = screen.getByLabelText('Category');
    await waitFor(() => expect(within(select).getByText('Section Two (1)')).toBeTruthy());
    fireEvent.change(select, { target: { value: 'Section Two' } });
    await waitFor(() =>
      expect(app.callsTo('GET', '/medicines').at(-1)?.query.category).toBe('Section Two'),
    );
  });

  it('searches when asked, and says results are then ordered by best match', async () => {
    const app = await show();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Search by generic or brand name'), {
      target: { value: 'drug' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(app.callsTo('GET', '/medicines').at(-1)?.query.q).toBe('drug'));
    expect(await screen.findByText(/ordered by best match/)).toBeTruthy();
  });

  it('lists retired rows only when the toggle is on, with a Retired badge and a Restore action', async () => {
    const app = await show();
    await screen.findByRole('table');
    expect(screen.queryByText('Drug-R (FAKE)')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Show retired medicines' }));
    const row = (await screen.findByText('Drug-R (FAKE)')).closest('tr') as HTMLElement;
    expect(app.callsTo('GET', '/medicines').at(-1)?.query.includeRetired).toBe('true');
    expect(row.textContent).toContain('Retired');
    expect(within(row).getByRole('button', { name: 'Restore Drug-R (FAKE)' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /^Retire/ })).toBeNull();
  });

  it('adds a medicine: a name and a source are required, the new row is sent with no codes or review fields', async () => {
    const created = fakeMedicine({ id: MED(9), genericName: 'Drug-N (FAKE)' });
    const app = await show({ 'POST /medicines': () => ({ status: 201, data: created }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Add medicine' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save medicine' }));
    const summary = await within(dialog).findByText('The medicine was not saved');
    expect(summary).toBeTruthy();
    expect(within(dialog).getAllByText('Enter the generic name.').length).toBeGreaterThan(0);
    expect(app.callsTo('POST', '/medicines')).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/Generic name/), {
      target: { value: ' Drug-N (FAKE) ' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Source \(required\)/), {
      target: { value: 'test fixture' },
    });
    fireEvent.change(within(dialog).getByLabelText(/PDF page/), { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save medicine' }));
    await waitFor(() => expect(app.callsTo('POST', '/medicines')).toHaveLength(1));
    expect(app.callsTo('POST', '/medicines')[0]?.body).toEqual({
      genericName: 'Drug-N (FAKE)',
      source: 'test fixture',
      strength: null,
      doseForm: null,
      route: null,
      therapeuticCategory: null,
      nlemYear: null,
      sourcePage: 12,
      sourceNotes: null,
    });
    expect(await screen.findByText('Medicine added')).toBeTruthy();
  });

  it('shows the duplicate message when the API says the formulation already exists', async () => {
    await show({
      'POST /medicines': () => ({ status: 409, error: { code: 'CONFLICT', message: 'dup' } }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add medicine' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Generic name/), {
      target: { value: 'Drug-A (FAKE)' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Source \(required\)/), {
      target: { value: 'x' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save medicine' }));
    expect((await within(dialog).findAllByText(/already exists/)).length).toBeGreaterThan(0);
  });

  it('edits: only changed fields are sent, and a reviewed row warns that saving clears the review', async () => {
    const app = await show({
      'PATCH /medicines/:id': () => ({
        data: { ...B, strength: '20 mg', reviewStatus: 'not_reviewed' },
      }),
    });
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Edit Drug-B (FAKE)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/clears any clinical review/)).toBeTruthy();

    // nothing changed: nothing is sent
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save medicine' }));
    expect((await within(dialog).findAllByText('Nothing was changed.')).length).toBeGreaterThan(0);
    expect(app.callsTo('PATCH', `/medicines/${MED(2)}`)).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Strength'), { target: { value: '20 mg' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save medicine' }));
    await waitFor(() => expect(app.callsTo('PATCH', `/medicines/${MED(2)}`)).toHaveLength(1));
    expect(app.callsTo('PATCH', `/medicines/${MED(2)}`)[0]?.body).toEqual({ strength: '20 mg' });
    expect(await screen.findByText('Medicine saved')).toBeTruthy();
  });

  it('retires only after confirmation, and restores straight away', async () => {
    const app = await show({
      'POST /medicines/:id/retire': () => ({ data: { ...A, retired: true } }),
      'POST /medicines/:id/restore': () => ({ data: R }),
    });
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Retire Drug-A (FAKE)' }));
    const dialog = await screen.findByRole('dialog');
    expect(app.callsTo('POST', `/medicines/${MED(1)}/retire`)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(app.callsTo('POST', `/medicines/${MED(1)}/retire`)).toHaveLength(1));
    expect(await screen.findByText('Medicine retired')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Show retired medicines' }));
    const row = (await screen.findByText('Drug-R (FAKE)')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Restore Drug-R (FAKE)' }));
    await waitFor(() =>
      expect(app.callsTo('POST', `/medicines/${MED(3)}/restore`)).toHaveLength(1),
    );
    expect(await screen.findByText('Medicine restored')).toBeTruthy();
  });

  it('shows an error with a retry when the list cannot be loaded, and an empty state with an action when there are no rows', async () => {
    let fail = true;
    await show({
      'GET /medicines': () =>
        fail
          ? { status: 500, error: { code: 'INTERNAL', message: 'x' } }
          : list([])({ query: new URLSearchParams() } as never),
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Something went wrong');
    fail = false;
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByText('No medicines yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add medicine' }).length).toBeGreaterThan(1);
  });

  it('is for admins: other roles are sent away from the page', async () => {
    for (const role of ['doctor', 'staff', 'researcher'] as const) {
      const app = await renderApp({ role, path: '/admin/medicines', routes: base });
      await waitFor(() =>
        expect(screen.queryByRole('table', { name: 'Medicine master' })).toBeNull(),
      );
      expect(app.callsTo('GET', '/medicines')).toHaveLength(0);
      cleanupApp();
    }
  });

  it('is readable in Gujarati, with the page convention kept', async () => {
    await show({}, 'gu');
    const table = await screen.findByRole('table', { name: 'દવાની મુખ્ય યાદી' });
    expect(within(table).getByText('Drug-A (FAKE)').closest('tr')?.textContent).toContain(
      'PDF પૃ. 27, છાપેલું 26',
    );
  });
});
