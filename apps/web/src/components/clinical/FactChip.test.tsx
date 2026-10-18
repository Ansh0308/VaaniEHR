// FactChip and FactsPanel: every state in words + icon, hover/focus sentence, keys only on the focused chip.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import type { Fact } from '../../facts/useFacts';
import { FactChip, type FactChipProps } from './FactChip';
import { FactsPanel, type FactsPanelProps } from './FactsPanel';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

const chip = (over: Partial<FactChipProps> = {}) => {
  const handlers = { onConfirm: vi.fn(), onReject: vi.fn(), onEdit: vi.fn(), onPeek: vi.fn() };
  render(
    <FactChip
      label="Symptom"
      value="fever"
      status="heard"
      sentence="He has had fever since two days"
      {...handlers}
      {...over}
    />,
  );
  return { ...handlers, group: screen.getByRole('group') };
};

describe('FactChip states', () => {
  it('heard: words "Heard", confirm / edit / reject, no confidence figure', () => {
    chip();
    expect(screen.getByText('Heard')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm fever' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit fever' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject fever' })).toBeTruthy();
    expect(screen.getByRole('group').textContent).not.toMatch(/%|\d\.\d/);
  });
  it('confirmed has no confirm button; rejected can still be confirmed again', () => {
    chip({ status: 'confirmed' });
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm fever' })).toBeNull();
    cleanup();
    chip({ status: 'rejected' });
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm fever' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reject fever' })).toBeNull();
  });
  it('stale says the text changed and explains', () => {
    chip({ status: 'stale' });
    expect(screen.getByText('Text changed - re-check')).toBeTruthy();
    expect(screen.getByText(/were edited/)).toBeTruthy();
  });
  it('negated is written "Not present"; uncertain, manual and the original value are shown', () => {
    chip({ negated: true, uncertain: true, manual: true, originalValue: 'fevr' });
    expect(screen.getByText('Not present')).toBeTruthy();
    expect(screen.getByText('Uncertain')).toBeTruthy();
    expect(screen.getByText('Added by hand')).toBeTruthy();
    expect(screen.getByText(/Extracted as:/).textContent).toContain('fevr');
  });
});

describe('FactChip peek and keys', () => {
  it('hover and focus show the supporting sentence and tell the page', () => {
    const { group, onPeek } = chip();
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.mouseEnter(group);
    expect(screen.getByRole('note').textContent).toContain('since two days');
    fireEvent.mouseLeave(group);
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.focus(group);
    expect(screen.getByRole('note')).toBeTruthy();
    expect(onPeek).toHaveBeenCalledWith(true);
    fireEvent.blur(group);
    expect(onPeek).toHaveBeenLastCalledWith(false);
  });
  it('c confirms, r rejects, e opens the editor, only on the chip itself', () => {
    const { group, onConfirm, onReject } = chip();
    fireEvent.keyDown(group, { key: 'c' });
    fireEvent.keyDown(group, { key: 'r' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(group, { key: 'c', ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(group, { key: 'e' });
    const field = screen.getByLabelText('Fact');
    fireEvent.keyDown(field, { key: 'c' });
    fireEvent.keyDown(field, { key: 'r' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });
  it('edit sends the new value and flags', () => {
    const { onEdit } = chip();
    fireEvent.click(screen.getByRole('button', { name: 'Edit fever' }));
    fireEvent.change(screen.getByLabelText('Fact'), { target: { value: 'high fever' } });
    fireEvent.click(screen.getByLabelText('Not present'));
    fireEvent.click(screen.getByRole('button', { name: 'Save change' }));
    expect(onEdit).toHaveBeenCalledWith({ value: 'high fever', negated: true, uncertain: false });
  });
});

const fact = (over: Partial<Fact> = {}): Fact => ({
  id: 'f1',
  type: 'symptom',
  value: 'fever',
  negated: false,
  uncertain: false,
  speaker: 'patient',
  source: 'extracted',
  sourceSegmentSeq: 0,
  spanStart: 0,
  spanEnd: 5,
  evidenceQuote: 'fever',
  status: 'heard',
  edited: false,
  originalValue: null,
  conceptId: null,
  ...over,
});

const panel = (over: Partial<FactsPanelProps> = {}) =>
  render(
    <FactsPanel
      facts={[fact(), fact({ id: 'f2', type: 'duration', value: '2 days' })]}
      sentenceOf={() => 'sentence'}
      mode="sample"
      blocked={null}
      busy={false}
      extracting={false}
      error={null}
      announcement=""
      onExtract={vi.fn()}
      onConfirm={vi.fn()}
      onReject={vi.fn()}
      onEdit={vi.fn()}
      onAdd={() => Promise.resolve(true)}
      onPeek={vi.fn()}
      {...over}
    />,
  );

describe('FactsPanel', () => {
  it('groups by type and labels test mode', () => {
    panel();
    expect(screen.getByText('Test mode - sample extraction')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Symptoms' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Duration' })).toBeTruthy();
    expect(screen.getByText(/press C to confirm/)).toBeTruthy();
  });
  it('the button never starts by itself and is off when blocked or the model is not allowed', () => {
    const onExtract = vi.fn();
    panel({ onExtract });
    expect(onExtract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Extract facts' }));
    expect(onExtract).toHaveBeenCalledTimes(1);
    cleanup();
    panel({ blocked: 'unsaved' });
    expect(screen.getByRole('button', { name: 'Extract facts' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/shows as saved/)).toBeTruthy();
    cleanup();
    panel({ mode: 'blocked' });
    expect(screen.getByRole('button', { name: 'Extract facts' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/not allowed/);
  });
  it('errors are plain words and new facts are announced politely', () => {
    panel({ error: 'rate_limited', announcement: '2' });
    expect(screen.getByRole('alert').textContent).toMatch(/busy right now/);
    const live = screen.getByText('New facts arrived: 2');
    expect(live.getAttribute('aria-live')).toBe('polite');
  });
  it('adds a fact by hand', () => {
    const onAdd = vi.fn(() => Promise.resolve(true));
    panel({ onAdd });
    fireEvent.click(screen.getByRole('button', { name: 'Add a fact by hand' }));
    const form = screen.getByRole('button', { name: 'Add fact' }).closest('form') as HTMLElement;
    fireEvent.change(within(form).getByLabelText('Fact'), { target: { value: 'cough' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add fact' }));
    expect(onAdd).toHaveBeenCalledWith({
      type: 'symptom',
      value: 'cough',
      negated: false,
      uncertain: false,
    });
  });
});
