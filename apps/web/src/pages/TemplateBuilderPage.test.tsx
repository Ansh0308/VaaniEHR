// PG-13 Template builder: add and choose medicines, keyboard reorder with focus kept, personal / clinic-wide switch,
// preview, validation, save bodies, existing-template rules (read-only, owner-only visibility, retired medicine kept
// and flagged), Gujarati. Fake data only.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupApp, renderApp, type Handler } from '../test-utils/harness';
import { fakeDetail, fakeItem, fakeMedicine, MED, TPL } from '../test-utils/medicineFixtures';

afterEach(cleanupApp);

const A = fakeMedicine();
const B = fakeMedicine({
  id: MED(2),
  genericName: 'Drug-B (FAKE)',
  strength: '10 mg',
  doseForm: 'Capsule',
});
const C = fakeMedicine({
  id: MED(3),
  genericName: 'Drug-C (FAKE)',
  strength: '5 mg',
  doseForm: 'Syrup',
});

const search: Handler = (req) => {
  const q = (req.query.get('q') ?? '').toLowerCase();
  const items = [A, B, C].filter((m) => m.genericName.toLowerCase().includes(q));
  return { data: { items, total: items.length, limit: 10, offset: 0 } };
};

const open = (
  path = '/admin/templates/new',
  routes: Record<string, Handler> = {},
  role: 'doctor' | 'admin' = 'doctor',
  language: 'en' | 'gu' = 'en',
) => renderApp({ role, path, language, routes: { 'GET /medicines': search, ...routes } });

const medicineInputs = () =>
  screen.getAllByRole('combobox').filter((c) => c.tagName === 'INPUT') as HTMLInputElement[];

async function addMedicine(input: HTMLInputElement, query: string, optionName: RegExp) {
  fireEvent.change(input, { target: { value: query } });
  fireEvent.mouseDown(await screen.findByRole('option', { name: optionName }));
}
async function addLine(query: string, optionName: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: 'Add medicine' }));
  const inputs = medicineInputs();
  const input = inputs[inputs.length - 1] as HTMLInputElement;
  await addMedicine(input, query, optionName);
  return input;
}
const names = () =>
  screen
    .getAllByRole('heading', { level: 3 })
    .map(
      (h) =>
        h.closest('li')?.querySelector<HTMLInputElement>('input[role="combobox"]')?.value ?? '',
    );

describe('Template builder: new template', () => {
  it('starts empty and moves focus to the new medicine field when one is added', async () => {
    await open();
    expect(await screen.findByText('No medicines yet. Add the first one.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add medicine' }));
    await waitFor(() => expect(document.activeElement).toBe(medicineInputs()[0]));
    expect(screen.getByRole('heading', { level: 3, name: 'Medicine 1 of 1' })).toBeTruthy();
  });

  it('shows the picked medicines, in order, in the preview', async () => {
    await open();
    await screen.findByRole('button', { name: 'Add medicine' });
    await addLine('drug-a', /Drug-A/);
    await addLine('drug-b', /Drug-B/);
    const preview = screen.getByRole('region', { name: 'Preview' });
    await waitFor(() =>
      expect(
        within(preview)
          .getAllByRole('listitem')
          .map((l) => l.textContent),
      ).toEqual([
        expect.stringContaining('1. Drug-A (FAKE) · 500 mg · Tablet'),
        expect.stringContaining('2. Drug-B (FAKE) · 10 mg · Capsule'),
      ]),
    );
  });

  it('reorders with the move buttons, announces it and keeps focus on the pressed button', async () => {
    await open();
    await screen.findByRole('button', { name: 'Add medicine' });
    await addLine('drug-a', /Drug-A/);
    await addLine('drug-b', /Drug-B/);
    await addLine('drug-c', /Drug-C/);
    expect(names()).toEqual([
      'Drug-A (FAKE) · 500 mg · Tablet',
      'Drug-B (FAKE) · 10 mg · Capsule',
      'Drug-C (FAKE) · 5 mg · Syrup',
    ]);
    // the first line cannot move up, the last cannot move down
    expect(
      (screen.getByRole('button', { name: 'Move Drug-A (FAKE) up' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Move Drug-C (FAKE) down' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Move Drug-B (FAKE) up' }));
    await waitFor(() => expect(names()[0]).toBe('Drug-B (FAKE) · 10 mg · Capsule'));
    expect(names()[1]).toBe('Drug-A (FAKE) · 500 mg · Tablet');
    expect(screen.getByText('Drug-B (FAKE) moved to position 1 of 3')).toBeTruthy();
    // at the top now: the up button is disabled, so focus goes to the down button of the same line
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Move Drug-B (FAKE) down' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Drug-B (FAKE) down' }));
    await waitFor(() => expect(names()[1]).toBe('Drug-B (FAKE) · 10 mg · Capsule'));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Move Drug-B (FAKE) down' }),
    );
    // each combobox kept its own text while the rows moved
    expect(names()).toEqual([
      'Drug-A (FAKE) · 500 mg · Tablet',
      'Drug-B (FAKE) · 10 mg · Capsule',
      'Drug-C (FAKE) · 5 mg · Syrup',
    ]);
  });

  it('removes a line and returns focus to Add medicine', async () => {
    await open();
    await screen.findByRole('button', { name: 'Add medicine' });
    await addLine('drug-a', /Drug-A/);
    await addLine('drug-b', /Drug-B/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Drug-A (FAKE)' }));
    await waitFor(() => expect(names()).toEqual(['Drug-B (FAKE) · 10 mg · Capsule']));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add medicine' }));
  });

  it('offers exactly the five frequency codes, with labels, and stores the code', async () => {
    const app = await open('/admin/templates/new', {
      'POST /templates': () => ({ status: 201, data: fakeDetail([fakeItem(0, A)]) }),
    });
    await screen.findByRole('button', { name: 'Add medicine' });
    await addLine('drug-a', /Drug-A/);
    const select = screen.getByLabelText('Frequency') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'OD', 'BD', 'TDS', 'QID', 'SOS']);
    expect([...select.options].map((o) => o.text)).toEqual([
      'Not set',
      'Once daily (OD)',
      'Twice daily (BD)',
      'Three times daily (TDS)',
      'Four times daily (QID)',
      'As needed (SOS)',
    ]);
    fireEvent.change(select, { target: { value: 'TDS' } });
    fireEvent.change(screen.getByLabelText('Template name (required)'), {
      target: { value: 'Demo (FAKE)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(app.callsTo('POST', '/templates')).toHaveLength(1));
    expect(
      (app.callsTo('POST', '/templates')[0]?.body as { items: Array<{ frequency: string }> })
        .items[0]?.frequency,
    ).toBe('TDS');
  });

  it('personal by default; the switch makes it clinic-wide; the body carries who can use it and empty text as null', async () => {
    const app = await open(
      '/admin/templates/new',
      { 'POST /templates': () => ({ status: 201, data: fakeDetail([fakeItem(0, A)]) }) },
      'admin',
    );
    await screen.findByRole('button', { name: 'Add medicine' });
    const personal = screen.getByRole('radio', { name: /Personal/ }) as HTMLInputElement;
    const clinic = screen.getByRole('radio', { name: /Clinic-wide/ }) as HTMLInputElement;
    expect(personal.checked).toBe(true);
    fireEvent.click(clinic);
    expect(clinic.checked).toBe(true);

    await addLine('drug-a', /Drug-A/);
    fireEvent.change(screen.getByLabelText('Template name (required)'), {
      target: { value: '  Fever demo (FAKE) ' },
    });
    fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '1 tablet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(app.callsTo('POST', '/templates')).toHaveLength(1));
    expect(app.callsTo('POST', '/templates')[0]?.body).toEqual({
      name: 'Fever demo (FAKE)',
      visibility: 'clinic',
      items: [
        {
          medicineId: MED(1),
          dose: '1 tablet',
          frequency: null,
          duration: null,
          instructions: null,
        },
      ],
    });
    expect(await screen.findByText('Template saved')).toBeTruthy();
    // back on the list afterwards
    await screen.findByRole('heading', { level: 1, name: 'Prescription templates' });
  });

  it('validates before sending: name, at least one medicine, every line has a medicine; the summary takes focus', async () => {
    const app = await open();
    await screen.findByRole('button', { name: 'Add medicine' });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    const summary = await screen.findByText('The template was not saved');
    await waitFor(() => expect(document.activeElement).toBe(summary.closest('[tabindex="-1"]')));
    expect(screen.getAllByText('Enter a template name.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Add at least one medicine.').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Add medicine' }));
    fireEvent.change(screen.getByLabelText('Template name (required)'), {
      target: { value: 'Demo (FAKE)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(
      (await screen.findAllByText('Medicine 1: choose a medicine from the list.')).length,
    ).toBeGreaterThan(0);
    expect(app.callsTo('POST', '/templates')).toHaveLength(0);
  });

  it('shows a server failure in the error summary and keeps what was typed', async () => {
    await open('/admin/templates/new', {
      'POST /templates': () => ({ status: 500, error: { code: 'INTERNAL', message: 'x' } }),
    });
    await screen.findByRole('button', { name: 'Add medicine' });
    await addLine('drug-a', /Drug-A/);
    fireEvent.change(screen.getByLabelText('Template name (required)'), {
      target: { value: 'Demo (FAKE)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect((await screen.findAllByText(/Something went wrong/)).length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Template name (required)') as HTMLInputElement).value).toBe(
      'Demo (FAKE)',
    );
  });
});

describe('Template builder: an existing template', () => {
  const retiredMedicine = fakeMedicine({
    id: MED(4),
    genericName: 'Drug-Old (FAKE)',
    retired: true,
  });
  const own = (over: Record<string, unknown> = {}) =>
    fakeDetail([fakeItem(0, A), fakeItem(1, retiredMedicine, { frequency: 'SOS' })], {
      id: TPL(2),
      name: 'Existing (FAKE)',
      visibility: 'personal',
      ownedByMe: true,
      canEdit: true,
      ...over,
    });

  it('keeps a retired medicine in its line, flags it, and sends it back unchanged on save', async () => {
    const app = await open(`/admin/templates/${TPL(2)}`, {
      'GET /templates/:id': () => ({ data: own() }),
      'PUT /templates/:id': () => ({ data: own() }),
    });
    expect(await screen.findByDisplayValue('Existing (FAKE)')).toBeTruthy();
    expect(screen.getByText(/This medicine has been retired\. The line is kept/)).toBeTruthy();
    expect(names()).toEqual([
      'Drug-A (FAKE) · 500 mg · Tablet',
      'Drug-Old (FAKE) · 500 mg · Tablet',
    ]);

    fireEvent.change(screen.getByLabelText('Template name (required)'), {
      target: { value: 'Existing renamed (FAKE)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(app.callsTo('PUT', `/templates/${TPL(2)}`)).toHaveLength(1));
    const body = app.callsTo('PUT', `/templates/${TPL(2)}`)[0]?.body as {
      items: Array<{ medicineId: string }>;
    };
    expect(body.items.map((i) => i.medicineId)).toEqual([MED(1), MED(4)]);
    expect(await screen.findByText('Template updated')).toBeTruthy();
  });

  it('Load template is available when saved and disabled while there are unsaved changes', async () => {
    await open(`/admin/templates/${TPL(2)}`, { 'GET /templates/:id': () => ({ data: own() }) });
    const load = (await screen.findByRole('button', {
      name: 'Load template',
    })) as HTMLButtonElement;
    expect(load.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Template name (required)'), {
      target: { value: 'Changed (FAKE)' },
    });
    expect(load.disabled).toBe(true);
    expect(screen.getByText('Save your changes to load the saved version.')).toBeTruthy();
  });

  it("an admin editing someone else's clinic-wide template can change the items but not who can use it", async () => {
    await open(
      `/admin/templates/${TPL(3)}`,
      {
        'GET /templates/:id': () => ({
          data: own({ id: TPL(3), visibility: 'clinic', ownedByMe: false, canEdit: true }),
        }),
      },
      'admin',
    );
    await screen.findByDisplayValue('Existing (FAKE)');
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.every((r) => r.matches(':disabled'))).toBe(true);
    expect(screen.getByText('Only the owner can change who can use a template.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save template' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('a template the API says is not editable opens read-only: a preview and no form', async () => {
    await open(`/admin/templates/${TPL(5)}`, {
      'GET /templates/:id': () => ({
        data: own({ id: TPL(5), visibility: 'clinic', ownedByMe: false, canEdit: false }),
      }),
    });
    expect(await screen.findByText('You can view this template but not change it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save template' })).toBeNull();
    expect(screen.queryByLabelText('Template name (required)')).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Preview' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(
      (screen.getByRole('button', { name: 'Load template' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('a retired template is read-only and cannot be loaded', async () => {
    await open(`/admin/templates/${TPL(6)}`, {
      'GET /templates/:id': () => ({ data: own({ id: TPL(6), retired: true }) }),
    });
    expect(await screen.findByText(/This template is retired/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save template' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load template' })).toBeNull();
  });

  it('shows "not found" for a template that is not visible (another clinic, or somebody else\'s personal one)', async () => {
    await open(`/admin/templates/${TPL(7)}`, {
      'GET /templates/:id': () => ({ status: 404, error: { code: 'NOT_FOUND', message: 'x' } }),
    });
    expect((await screen.findByRole('alert')).textContent).toContain('That was not found');
  });

  it('is open to doctors and admins only', async () => {
    for (const role of ['staff', 'researcher'] as const) {
      const app = await renderApp({
        role,
        path: '/admin/templates/new',
        routes: { 'GET /medicines': search },
      });
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Add medicine' })).toBeNull(),
      );
      expect(app.callsTo('POST', '/templates')).toHaveLength(0);
      cleanupApp();
    }
  });
});

describe('Template builder in Gujarati', () => {
  it('shows Gujarati labels, the frequency labels and the needs-review mark', async () => {
    await open('/admin/templates/new', {}, 'doctor', 'gu');
    await screen.findByRole('button', { name: 'દવા ઉમેરો' });
    expect(screen.getByText('Needs review by a Gujarati speaker')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'દવા ઉમેરો' }));
    const select = (await screen.findByLabelText('આવર્તન')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toContain('દિવસમાં ત્રણ વાર (TDS)');
  });
});
