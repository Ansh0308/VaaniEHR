// PG-13 Templates list: visibility, edit rights shown per row, scope and retired filters, load with retired-medicine
// flags, retire / restore, error state and role visibility. Fake data only.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupApp, IDS, renderApp, type Handler } from '../test-utils/harness';
import { brief, fakeMedicine, fakeSummary, MED, TPL } from '../test-utils/medicineFixtures';

afterEach(cleanupApp);

const clinicWide = fakeSummary();
const mine = fakeSummary({
  id: TPL(2),
  name: 'My personal template (FAKE)',
  visibility: 'personal',
  ownedByMe: true,
  ownerName: 'Fake doctor',
  canEdit: true,
  itemCount: 1,
});
const editableClinic = fakeSummary({
  id: TPL(3),
  name: 'Shared and editable (FAKE)',
  ownedByMe: false,
  canEdit: true,
});
const gone = fakeSummary({ id: TPL(4), name: 'Old template (FAKE)', retired: true, canEdit: true });

const list: Handler = (req) => {
  const scope = req.query.get('scope') ?? 'all';
  const showRetired = req.query.get('includeRetired') === 'true';
  let items = [clinicWide, mine, editableClinic];
  if (scope === 'mine') items = items.filter((t) => t.ownedByMe);
  if (scope === 'clinic') items = items.filter((t) => t.visibility === 'clinic');
  if (showRetired) items = [...items, gone];
  return { data: { items, total: items.length, limit: 25, offset: 0 } };
};

const show = (
  role: 'doctor' | 'admin' | 'staff' | 'researcher' = 'doctor',
  routes: Record<string, Handler> = {},
  language: 'en' | 'gu' = 'en',
) =>
  renderApp({
    role,
    path: '/admin/templates',
    language,
    routes: { 'GET /templates': list, ...routes },
  });

const loaded = (retired: boolean) => {
  const ok = fakeMedicine();
  const old = fakeMedicine({ id: MED(2), genericName: 'Drug-Old (FAKE)', retired });
  return {
    template: { id: TPL(1), name: clinicWide.name, visibility: 'clinic' },
    items: [
      {
        position: 0,
        medicine: brief(ok),
        dose: '1 tablet',
        frequency: 'BD',
        duration: '5 days',
        instructions: null,
        problem: null,
      },
      {
        position: 1,
        medicine: brief(old),
        dose: null,
        frequency: 'SOS',
        duration: null,
        instructions: 'with water',
        problem: retired ? 'MEDICINE_RETIRED' : null,
      },
    ],
    warnings: retired ? [{ position: 1, code: 'MEDICINE_RETIRED', medicineId: MED(2) }] : [],
    hasRetiredMedicine: retired,
  };
};

describe('Templates list', () => {
  it('shows name, who can use it, owner, item count; edit and retire only where the API says canEdit', async () => {
    await show();
    const table = await screen.findByRole('table', { name: 'Prescription templates' });
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement;

    const wide = row(clinicWide.name);
    expect(wide.textContent).toContain('Clinic-wide');
    expect(wide.textContent).toContain('Fake doctor');
    expect(within(wide).getByRole('button', { name: `Load ${clinicWide.name}` })).toBeTruthy();
    expect(within(wide).queryByRole('button', { name: /^Edit/ })).toBeNull();
    expect(within(wide).queryByRole('button', { name: /^Retire/ })).toBeNull();

    const own = row(mine.name);
    expect(own.textContent).toContain('Personal');
    expect(own.textContent).toContain('You');
    expect(within(own).getByRole('button', { name: `Edit ${mine.name}` })).toBeTruthy();
    expect(within(own).getByRole('button', { name: `Retire ${mine.name}` })).toBeTruthy();

    const shared = row(editableClinic.name);
    expect(
      within(shared).getByRole('button', { name: `Edit ${editableClinic.name}` }),
    ).toBeTruthy();
  });

  it('asks the API for the chosen scope and for retired templates only when asked', async () => {
    const app = await show();
    await screen.findByRole('table');
    expect(app.callsTo('GET', '/templates')[0]?.query).toMatchObject({ scope: 'all' });
    expect(app.callsTo('GET', '/templates')[0]?.query.includeRetired).toBeUndefined();

    fireEvent.change(screen.getByLabelText('Whose templates'), { target: { value: 'mine' } });
    await waitFor(() => expect(app.callsTo('GET', '/templates').at(-1)?.query.scope).toBe('mine'));
    await waitFor(() => expect(screen.queryByText(clinicWide.name)).toBeNull());

    fireEvent.click(screen.getByRole('switch', { name: 'Show retired templates' }));
    const retiredRow = (await screen.findByText(gone.name)).closest('tr') as HTMLElement;
    expect(retiredRow.textContent).toContain('Retired');
    expect(within(retiredRow).queryByRole('button', { name: /^Load/ })).toBeNull();
    expect(within(retiredRow).getByRole('button', { name: `Restore ${gone.name}` })).toBeTruthy();
  });

  it('loads a template: the lines are shown, a retired medicine is flagged and kept, nothing is swapped', async () => {
    await show('doctor', { 'GET /templates/:id/load': () => ({ data: loaded(true) }) });
    fireEvent.click(await screen.findByRole('button', { name: `Load ${clinicWide.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/Some medicines in this template have been retired/),
    ).toBeTruthy();
    const items = within(dialog).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Drug-A (FAKE) · 500 mg · Tablet');
    expect(items[0]?.textContent).toContain('Twice daily (BD)');
    expect(items[0]?.textContent).toContain('PDF p. 27, printed 26');
    expect(items[1]?.textContent).toContain('Drug-Old (FAKE)');
    expect(items[1]?.textContent).toContain('As needed (SOS)');
    expect(items[1]?.textContent).toContain(
      'Drug-Old (FAKE) has been retired. It was not removed or replaced.',
    );
    expect(items[0]?.textContent).not.toContain('has been retired');
  });

  it('a template with no retired medicine loads without a warning', async () => {
    await show('doctor', { 'GET /templates/:id/load': () => ({ data: loaded(false) }) });
    fireEvent.click(await screen.findByRole('button', { name: `Load ${clinicWide.name}` }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findAllByRole('listitem');
    expect(within(dialog).queryByText(/have been retired/)).toBeNull();
  });

  it('says plainly when a template cannot be loaded because it is retired (409)', async () => {
    await show('doctor', {
      'GET /templates/:id/load': () => ({
        status: 409,
        error: { code: 'CONFLICT', message: 'retired' },
      }),
    });
    fireEvent.click(await screen.findByRole('button', { name: `Load ${clinicWide.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'retired template cannot be loaded',
    );
  });

  it('retires after confirmation and restores directly', async () => {
    const app = await show('doctor', {
      'POST /templates/:id/retire': () => ({ data: { ...mine, retired: true } }),
      'POST /templates/:id/restore': () => ({ data: gone }),
    });
    fireEvent.click(await screen.findByRole('button', { name: `Retire ${mine.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect(app.callsTo('POST', `/templates/${TPL(2)}/retire`)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(app.callsTo('POST', `/templates/${TPL(2)}/retire`)).toHaveLength(1));
    expect(await screen.findByText('Template retired')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Show retired templates' }));
    fireEvent.click(await screen.findByRole('button', { name: `Restore ${gone.name}` }));
    await waitFor(() =>
      expect(app.callsTo('POST', `/templates/${TPL(4)}/restore`)).toHaveLength(1),
    );
    expect(await screen.findByText('Template restored')).toBeTruthy();
  });

  it('has an error state with retry, and an empty state that invites the first template', async () => {
    let fail = true;
    await show('admin', {
      'GET /templates': () =>
        fail
          ? { status: 500, error: { code: 'INTERNAL', message: 'x' } }
          : { data: { items: [], total: 0, limit: 25, offset: 0 } },
    });
    const alert = await screen.findByRole('alert');
    fail = false;
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByText('No templates yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New template' }).length).toBeGreaterThan(1);
  });

  it('is open to doctors and admins only', async () => {
    for (const role of ['doctor', 'admin'] as const) {
      await show(role);
      expect(await screen.findByRole('table', { name: 'Prescription templates' })).toBeTruthy();
      cleanupApp();
    }
    for (const role of ['staff', 'researcher'] as const) {
      const app = await show(role);
      await waitFor(() =>
        expect(screen.queryByRole('table', { name: 'Prescription templates' })).toBeNull(),
      );
      expect(app.callsTo('GET', '/templates')).toHaveLength(0);
      cleanupApp();
    }
    void IDS;
  });

  it('works in Gujarati, with the needs-review mark on the Gujarati text', async () => {
    await show('doctor', { 'GET /templates/:id/load': () => ({ data: loaded(true) }) }, 'gu');
    await screen.findByRole('table', { name: 'પ્રિસ્ક્રિપ્શન ટેમ્પલેટ' });
    expect(screen.getByText('Needs review by a Gujarati speaker')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: `${clinicWide.name} લોડ કરો` }));
    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findAllByRole('listitem'))[0]?.textContent).toContain(
      'દિવસમાં બે વાર (BD)',
    );
  });
});
