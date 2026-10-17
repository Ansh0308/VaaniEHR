// MedicineCombobox, exercised inside the real template builder (it needs the signed-in API). Fake medicines only.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupApp, renderApp, type Handler } from '../../test-utils/harness';
import { fakeMedicine, MED } from '../../test-utils/medicineFixtures';

afterEach(cleanupApp);

const drugA = fakeMedicine({
  brands: [{ id: 'b1', brandName: 'Brand-X', manufacturer: null, source: 's' }],
});
const drugB = fakeMedicine({
  id: MED(2),
  genericName: 'Drug-B (FAKE)',
  strength: '10 mg',
  doseForm: 'Capsule',
  reviewStatus: 'reviewed',
  reviewedOn: '2026-10-01',
  reviewedBy: 'Dr Fake Reviewer',
});
const drugGone = fakeMedicine({ id: MED(3), genericName: 'Drug-Gone (FAKE)', retired: true });

async function open(
  search: Handler = () => ({
    data: { items: [drugA, drugB, drugGone], total: 3, limit: 10, offset: 0 },
  }),
  language: 'en' | 'gu' = 'en',
) {
  const app = await renderApp({
    role: 'doctor',
    path: '/admin/templates/new',
    language,
    routes: { 'GET /medicines': search },
  });
  fireEvent.click(await screen.findByRole('button', { name: /Add medicine|દવા ઉમેરો/ }));
  const input = (await screen.findByRole('combobox', { name: /Medicine|દવા/ })) as HTMLInputElement;
  return { app, input };
}
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });

describe('MedicineCombobox', () => {
  it('does not search before 2 characters, then searches once after a pause in typing', async () => {
    const { app, input } = await open();
    type(input, 'd');
    await new Promise((r) => setTimeout(r, 400));
    expect(app.callsTo('GET', '/medicines')).toHaveLength(0);

    type(input, 'dr');
    type(input, 'dru');
    type(input, 'drug');
    await screen.findByRole('option', { name: /Drug-A/ });
    const calls = app.callsTo('GET', '/medicines');
    expect(calls).toHaveLength(1); // the three keystrokes became one request
    expect(calls[0]?.query).toMatchObject({ q: 'drug', limit: '10' });
  });

  it('shows generic first, brand lighter, strength and dose form, and the not-reviewed line', async () => {
    const { input } = await open();
    type(input, 'drug');
    const a = await screen.findByRole('option', { name: /Drug-A/ });
    expect(a.textContent).toContain('Drug-A (FAKE)');
    expect(a.textContent).toContain('500 mg · Tablet');
    expect(a.textContent).toContain('Brand: Brand-X');
    expect(a.textContent).toContain('NLEM 2022 - not clinically reviewed');
    // generic name comes before the brand
    expect(a.textContent?.indexOf('Drug-A')).toBeLessThan(a.textContent?.indexOf('Brand-X') ?? 0);
    // a reviewed medicine does not carry the not-reviewed line
    const b = screen.getByRole('option', { name: /Drug-B/ });
    expect(b.textContent).toContain('10 mg · Capsule');
    expect(b.textContent).not.toContain('not clinically reviewed');
  });

  it('never offers a retired medicine, even if the server sends one', async () => {
    const { input } = await open();
    type(input, 'drug');
    await screen.findByRole('option', { name: /Drug-A/ });
    expect(screen.queryByRole('option', { name: /Drug-Gone/ })).toBeNull();
    expect(
      within(screen.getByRole('listbox', { name: /Medicine/ })).getAllByRole('option'),
    ).toHaveLength(2);
  });

  it('options are at least 44 px tall targets (class min-h-11) and the input is a labelled combobox', async () => {
    const { input } = await open();
    expect(input.className).toContain('min-h-11');
    type(input, 'drug');
    const option = await screen.findByRole('option', { name: /Drug-A/ });
    expect(option.className).toContain('min-h-11');
  });

  it('is operated with the keyboard: arrows move, Enter chooses, Escape closes', async () => {
    const { input } = await open();
    type(input, 'drug');
    await screen.findByRole('option', { name: /Drug-A/ });
    expect(input.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toContain(MED(2));
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toContain(MED(1));
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('Drug-B (FAKE) · 10 mg · Capsule'));
  });

  it('says so when nothing is found, and when the search fails', async () => {
    const empty = await open(() => ({ data: { items: [], total: 0, limit: 10, offset: 0 } }));
    type(empty.input, 'zzz');
    await waitFor(() => expect(screen.getAllByText(/No medicine found/).length).toBeGreaterThan(0));
    cleanupApp();

    const broken = await open(() => ({
      status: 500,
      error: { code: 'INTERNAL', message: 'boom' },
    }));
    type(broken.input, 'drug');
    await waitFor(() =>
      expect(screen.getAllByText(/could not be loaded/).length).toBeGreaterThan(0),
    );
  });

  it('works in Gujarati: the label, hint and results are Gujarati and the medicine is still found', async () => {
    const { input } = await open(undefined, 'gu');
    expect(screen.getByRole('combobox', { name: /દવા/ })).toBe(input);
    type(input, 'drug');
    const option = await screen.findByRole('option', { name: /Drug-A/ });
    expect(option.textContent).toContain('બ્રાન્ડ: Brand-X');
    expect(option.textContent).toContain('NLEM 2022 - ક્લિનિકલ સમીક્ષા થઈ નથી');
  });
});
