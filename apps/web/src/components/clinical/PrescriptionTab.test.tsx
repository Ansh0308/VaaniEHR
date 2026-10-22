// PG-08 Prescription tab inside the consultation workspace (Phase 8 Run 1): search the medicine master, the flagged
// "Not in master list" fallback, templates, edit and remove until signing, the locked state, server errors in words,
// no suggestions or checks, Gujarati. Fake medicine names only; a small fake server keeps the rows.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrescriptionRow } from '../../api/prescription';
import { cleanupApp, IDS, noConsent, renderApp, type Handler } from '../../test-utils/harness';
import { fakeMedicine, fakeSummary, TPL } from '../../test-utils/medicineFixtures';

afterEach(cleanupApp);

const A = fakeMedicine();
const B = fakeMedicine({
  id: '5eed0000-0000-4000-8000-000000000299',
  genericName: 'Drug-B (FAKE)',
});

const row = (over: Partial<PrescriptionRow> = {}): PrescriptionRow => ({
  id: '5eed0000-0000-4000-8000-0000000004a1',
  position: 0,
  medicineId: A.id,
  name: 'Drug-A (FAKE)',
  source: 'master',
  strength: '500 mg',
  doseForm: 'Tablet',
  dose: null,
  frequency: 'BD',
  duration: '5 days',
  note: null,
  fromTemplateId: null,
  masterSource: 'test fixture',
  masterSourcePage: 27,
  masterSourcePagePrinted: 26,
  masterReviewStatus: 'not_reviewed',
  incomplete: false,
  ...over,
});

/** a tiny fake server for the prescription routes */
function fakeServer(initial: PrescriptionRow[] = [], opts: { locked?: boolean } = {}) {
  const state = {
    rows: [...initial],
    locked: opts.locked ?? false,
    failNext: null as null | { status: number; code: string },
  };
  const failure = () => {
    const f = state.failNext;
    state.failNext = null;
    return f ? { status: f.status, error: { code: f.code, message: 'x' } } : null;
  };
  let n = 10;
  const routes: Record<string, Handler> = {
    'GET /sessions/:id/consent': () => ({ data: noConsent() }),
    'GET /medicines': (req) => {
      const q = (req.query.get('q') ?? '').toLowerCase();
      const items = [A, B].filter((m) => m.genericName.toLowerCase().includes(q));
      return { data: { items, total: items.length, limit: 10, offset: 0 } };
    },
    'GET /templates': () => ({
      data: {
        items: [fakeSummary({ id: TPL(1), name: 'Toy template (FAKE)' })],
        total: 1,
        limit: 100,
        offset: 0,
      },
    }),
    'GET /sessions/:id/prescription': () => ({ data: { rows: state.rows, locked: state.locked } }),
    'POST /sessions/:id/prescription/items': (req) => {
      const fail = failure();
      if (fail) return fail;
      const b = req.body as Record<string, string | null>;
      state.rows.push(
        row({
          id: `5eed0000-0000-4000-8000-0000000004${n++}`,
          position: state.rows.length,
          medicineId: b.medicineId ?? null,
          name: b.medicineId ? 'Drug-A (FAKE)' : (b.name as string),
          source: b.medicineId ? 'master' : 'free_text',
          strength: b.strength ?? null,
          doseForm: b.doseForm ?? null,
          frequency: b.frequency as never,
          duration: b.duration as string,
          masterSource: b.medicineId ? 'test fixture' : null,
          masterSourcePagePrinted: b.medicineId ? 26 : null,
          masterReviewStatus: b.medicineId ? 'not_reviewed' : null,
        }),
      );
      return { status: 201, data: state.rows[state.rows.length - 1] };
    },
    'PATCH /sessions/:id/prescription/items/:itemId': (req) => {
      const target = state.rows.find((r) => r.id === req.params.itemId);
      Object.assign(target ?? {}, req.body);
      return { data: target };
    },
    'DELETE /sessions/:id/prescription/items/:itemId': (req) => {
      state.rows = state.rows.filter((r) => r.id !== req.params.itemId);
      return { data: { removed: true } };
    },
    'POST /sessions/:id/prescription/apply-template': () => {
      state.rows.push(
        row({
          id: '5eed0000-0000-4000-8000-0000000004b1',
          name: 'From template (FAKE)',
          fromTemplateId: TPL(1),
          position: state.rows.length,
        }),
      );
      return { status: 201, data: { rows: state.rows, added: 1, skippedRetired: 0 } };
    },
  };
  return { state, routes };
}

async function openTab(server = fakeServer(), language: 'en' | 'gu' = 'en') {
  const app = await renderApp({
    role: 'doctor',
    path: `/consult/${IDS.session}`,
    language,
    routes: server.routes,
  });
  fireEvent.click(
    await screen.findByRole('tab', { name: language === 'en' ? 'Prescription' : 'પ્રિસ્ક્રિપ્શન' }),
  );
  await screen.findByRole('region', {
    name: language === 'en' ? 'Prescription' : 'પ્રિસ્ક્રિપ્શન',
  });
  return { ...app, server };
}

const pick = async (query: string, name: RegExp) => {
  fireEvent.change(screen.getByRole('combobox', { name: /Search the medicine master/ }), {
    target: { value: query },
  });
  fireEvent.mouseDown(await screen.findByRole('option', { name }));
};
const choose = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Prescription tab', () => {
  it('lives in a tab of the workspace; the consultation stays mounted underneath', async () => {
    await openTab();
    expect(screen.getByRole('tablist', { name: 'Consultation sections' })).toBeTruthy();
    expect(screen.getByText(/No medicines added yet/)).toBeTruthy();
    // the recording controls are still in the page (hidden), so a running recording is not lost
    expect(document.querySelector('[role="tabpanel"][hidden]')).toBeTruthy();
    expect(screen.getByText(/No suggestions and no safety checks are made here/)).toBeTruthy();
  });

  it('adds a master medicine: strength and form start from the master, the source is shown on the row', async () => {
    const { calls } = await openTab();
    await pick('drug-a', /Drug-A/);
    expect((screen.getByLabelText('Strength') as HTMLInputElement).value).toBe('500 mg');
    expect((screen.getByLabelText('Form') as HTMLInputElement).value).toBe('Tablet');
    const add = screen.getByRole('button', { name: 'Add medicine' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true); // frequency and duration are still empty
    choose(/^Frequency/, 'BD');
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: '5 days' } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    const list = await screen.findByRole('list', { name: 'Medicines on this prescription' });
    expect(within(list).getByText('Drug-A (FAKE)')).toBeTruthy();
    expect(within(list).getByText(/Source: test fixture, page 26/)).toBeTruthy();
    expect(within(list).getByText(/not clinically reviewed/)).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/prescription/items'));
    expect(post?.body).toMatchObject({
      medicineId: A.id,
      strength: '500 mg',
      doseForm: 'Tablet',
      frequency: 'BD',
      duration: '5 days',
    });
  });

  it('the "Not in master list" fallback is labelled, needs a name, and is flagged on the row', async () => {
    const { calls } = await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Medicine not in the master list' }));
    expect(screen.getByText(/typed by hand, has no source/)).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Add medicine' }) as HTMLButtonElement;
    choose(/^Frequency/, 'OD');
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: '3 days' } });
    expect(add.disabled).toBe(true); // no name yet
    fireEvent.change(screen.getByLabelText(/^Medicine name/), {
      target: { value: 'Hand-typed (FAKE)' },
    });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    const list = await screen.findByRole('list', { name: 'Medicines on this prescription' });
    expect(within(list).getByText('Hand-typed (FAKE)')).toBeTruthy();
    expect(within(list).getByText('Not in master list')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/prescription/items'));
    expect(post?.body).toMatchObject({ medicineId: null, name: 'Hand-typed (FAKE)' });
  });

  it('applies a template as ordinary rows', async () => {
    await openTab();
    choose(/Apply a template/, TPL(1));
    fireEvent.click(screen.getByRole('button', { name: 'Apply template' }));
    expect(await screen.findByText('From template (FAKE)')).toBeTruthy();
  });

  it('every field can be edited before signing; a row can be removed', async () => {
    const { calls } = await openTab(fakeServer([row()]));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Drug-A (FAKE)' }));
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: '7 days' } });
    fireEvent.change(screen.getByLabelText('Strength'), { target: { value: '250 mg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText(/7 days/)).toBeTruthy());
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({ duration: '7 days', strength: '250 mg', frequency: 'BD' });
    expect(patch?.body).not.toHaveProperty('name'); // a master name is not editable
    fireEvent.click(screen.getByRole('button', { name: 'Remove Drug-A (FAKE)' }));
    await waitFor(() => expect(screen.getByText(/No medicines added yet/)).toBeTruthy());
  });

  it('a template line without frequency or duration is flagged and has to be completed', async () => {
    await openTab(fakeServer([row({ frequency: null, duration: null, incomplete: true })]));
    expect(await screen.findByText(/Frequency and duration are needed/)).toBeTruthy();
  });

  it('a signed visit shows the locked state: no add form, no edit buttons, a link to the record', async () => {
    await openTab(fakeServer([row()], { locked: true }));
    expect(await screen.findByText(/This visit is signed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add medicine' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open the signed record' }).getAttribute('href')).toBe(
      `/consult/${IDS.session}/record`,
    );
  });

  it('server answers are shown in words: invalid fields, and a visit signed meanwhile', async () => {
    const server = fakeServer();
    await openTab(server);
    await pick('drug-a', /Drug-A/);
    choose(/^Frequency/, 'BD');
    fireEvent.change(screen.getByLabelText(/^Duration/), { target: { value: '5 days' } });
    server.state.failNext = { status: 400, code: 'VALIDATION_ERROR' };
    fireEvent.click(screen.getByRole('button', { name: 'Add medicine' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Check the fields/);
    server.state.failNext = { status: 409, code: 'VISIT_SIGNED' };
    fireEvent.click(screen.getByRole('button', { name: 'Add medicine' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/already signed and cannot be changed/),
    );
  });

  it('offers no suggestion, check or dose guidance anywhere', async () => {
    await openTab(fakeServer([row()]));
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/recommend|interaction|contraindicat|maximum dose|safe dose/i);
    expect(screen.queryByRole('button', { name: /suggest/i })).toBeNull();
  });

  it('works in Gujarati', async () => {
    await openTab(fakeServer([row()]), 'gu');
    expect(await screen.findByRole('button', { name: 'દવા ઉમેરો' })).toBeTruthy();
    expect(screen.getByText('Drug-A (FAKE)')).toBeTruthy();
  });
});
