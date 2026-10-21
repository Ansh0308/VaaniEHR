// ConceptLink and the concept parts of FactsPanel (remaining Phase 5 items): suggestion, confirm, choose another, none of
// these, confirmed and stale states, the unreviewed-list label, no numbers, list not loaded. Toy words only.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConceptSuggestion } from '../../api/concepts';
import type { Fact } from '../../facts/useFacts';
import i18n from '../../i18n';
import { ConceptLink, type ConceptLinkProps } from './ConceptLink';
import { FactsPanel, type FactsPanelProps } from './FactsPanel';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

const s = (id: string, label: string): ConceptSuggestion => ({
  conceptId: id,
  label,
  reviewStatus: 'unreviewed',
});
const props = (over: Partial<ConceptLinkProps> = {}): ConceptLinkProps => ({
  status: 'none',
  linkedLabel: null,
  suggestions: [s('c1', 'toy one'), s('c2', 'toy two'), s('c3', 'toy three')],
  busy: false,
  onConfirm: vi.fn(),
  onClear: vi.fn(),
  ...over,
});

describe('ConceptLink', () => {
  it('shows the suggestion with the unreviewed-list label and three buttons; nothing is chosen by itself', () => {
    const p = props();
    render(<ConceptLink {...p} />);
    expect(screen.getByText('Suggested concept: toy one (unreviewed list)')).toBeTruthy();
    expect(p.onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm concept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose another' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'None of these' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/%|\d\.\d|score|confidence/i);
  });
  it('Confirm sends the first suggestion', () => {
    const p = props();
    render(<ConceptLink {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm concept' }));
    expect(p.onConfirm).toHaveBeenCalledWith('c1');
  });
  it('Choose another lists the other suggestions and sends the one picked', () => {
    const p = props();
    render(<ConceptLink {...p} />);
    const another = screen.getByRole('button', { name: 'Choose another' });
    expect(another.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(another);
    expect(another.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Choose toy one' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose toy three' }));
    expect(p.onConfirm).toHaveBeenCalledWith('c3');
  });
  it('Choose another is off when there is only one suggestion', () => {
    render(<ConceptLink {...props({ suggestions: [s('c1', 'toy one')] })} />);
    expect(
      (screen.getByRole('button', { name: 'Choose another' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('None of these hides the suggestions and says no concept was chosen; nothing is sent', () => {
    const p = props();
    render(<ConceptLink {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'None of these' }));
    expect(screen.getByText('No concept chosen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm concept' })).toBeNull();
    expect(p.onConfirm).not.toHaveBeenCalled();
    expect(p.onClear).not.toHaveBeenCalled();
  });
  it('a confirmed link is a small label with a Clear button', () => {
    const p = props({ status: 'confirmed', linkedLabel: 'toy one', suggestions: [] });
    render(<ConceptLink {...p} />);
    expect(screen.getByText('Concept: toy one (unreviewed list)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear concept' }));
    expect(p.onClear).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirm concept' })).toBeNull();
  });
  it('a stale link says it needs re-checking and offers to confirm the current suggestion again, or clear', () => {
    const p = props({ status: 'stale', linkedLabel: 'toy one' });
    render(<ConceptLink {...p} />);
    expect(
      screen.getByText('Concept link needs re-checking: toy one (unreviewed list)'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm toy one again' }));
    expect(p.onConfirm).toHaveBeenCalledWith('c1');
    expect(screen.getByRole('button', { name: 'Clear concept' })).toBeTruthy();
  });
  it('with nothing suggested and nothing linked it shows nothing', () => {
    const { container } = render(<ConceptLink {...props({ suggestions: [] })} />);
    expect(container.textContent).toBe('');
  });
  it('every button is disabled while a change is being saved', () => {
    render(<ConceptLink {...props({ busy: true })} />);
    for (const b of screen.getAllByRole('button'))
      expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

const fact = (over: Partial<Fact> = {}): Fact => ({
  id: 'f1',
  type: 'symptom',
  value: 'toy fact',
  negated: false,
  uncertain: false,
  speaker: null,
  source: 'manual',
  sourceSegmentSeq: null,
  spanStart: null,
  spanEnd: null,
  evidenceQuote: null,
  status: 'confirmed',
  edited: false,
  originalValue: null,
  conceptId: null,
  conceptStatus: 'none',
  conceptConfirmedAt: null,
  ...over,
});
const panel = (over: Partial<FactsPanelProps> = {}) =>
  render(
    <FactsPanel
      facts={[fact(), fact({ id: 'f2', type: 'duration', value: '2 days' })]}
      sentenceOf={() => null}
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
      concepts={{
        data: { listLoaded: true, byFact: { f1: [s('c1', 'toy one')] }, conceptLabels: {} },
        busy: false,
        error: null,
        onConfirm: vi.fn(),
        onClear: vi.fn(),
      }}
      {...over}
    />,
  );

describe('FactsPanel and concepts', () => {
  it('shows the suggestion on a symptom, not on other fact types', () => {
    panel();
    expect(screen.getAllByText(/Suggested concept:/)).toHaveLength(1);
  });
  it('says plainly when the list is not loaded, and suggests nothing', () => {
    panel({
      concepts: {
        data: { listLoaded: false, byFact: {}, conceptLabels: {} },
        busy: false,
        error: null,
        onConfirm: vi.fn(),
        onClear: vi.fn(),
      },
    });
    expect(screen.getByTestId('concepts-not-loaded').textContent).toBe(
      'Concept list not loaded. No concepts are suggested.',
    );
    expect(screen.queryByText(/Suggested concept:/)).toBeNull();
  });
  it('says nothing about concepts before they are read (no consent or not yet loaded)', () => {
    panel({
      concepts: { data: null, busy: false, error: null, onConfirm: vi.fn(), onClear: vi.fn() },
    });
    expect(screen.queryByTestId('concepts-not-loaded')).toBeNull();
    expect(screen.queryByText(/concept/i)).toBeNull();
  });
  it('shows a confirmed link with its label from the list and a stale one as needing re-checking', () => {
    panel({
      facts: [
        fact({ id: 'f1', conceptId: 'c1', conceptStatus: 'confirmed' }),
        fact({ id: 'f3', value: 'other', conceptId: 'c1', conceptStatus: 'stale' }),
      ],
      concepts: {
        data: { listLoaded: true, byFact: {}, conceptLabels: { c1: 'toy one' } },
        busy: false,
        error: null,
        onConfirm: vi.fn(),
        onClear: vi.fn(),
      },
    });
    expect(screen.getByText('Concept: toy one (unreviewed list)')).toBeTruthy();
    expect(screen.getByText(/needs re-checking: toy one/)).toBeTruthy();
  });
  it('a rejected fact gets no concept line; an error is plain words', () => {
    panel({
      facts: [fact({ status: 'rejected' })],
      concepts: {
        data: { listLoaded: true, byFact: { f1: [s('c1', 'toy one')] }, conceptLabels: {} },
        busy: false,
        error: 'save',
        onConfirm: vi.fn(),
        onClear: vi.fn(),
      },
    });
    expect(screen.queryByText(/Suggested concept:/)).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/could not be saved/);
  });
  it("the confirm button of the concept does not clash with the fact's own confirm button", () => {
    panel({ facts: [fact({ status: 'heard' })] });
    expect(screen.getByRole('button', { name: 'Confirm concept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm toy fact' })).toBeTruthy();
  });
});
