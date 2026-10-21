// QuestionPanel, RedFlagBanner and CandidatesPanel (Phase 6C): every outcome and state, the buttons, the consent rule, the
// wording rule. FAKE toy content only.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CandidateList, NextQuestion, PathwayRecord } from '../../api/pathwayAids';
import type { Fact } from '../../facts/useFacts';
import i18n from '../../i18n';
import resources from '../../i18n/locales/en/consult.json';
import { CandidatesPanel, type CandidatesPanelProps } from './CandidatesPanel';
import { QuestionPanel, type QuestionPanelProps } from './QuestionPanel';
import { RedFlagBanner } from './RedFlagBanner';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

const next = (over: Partial<NextQuestion> = {}): NextQuestion => ({
  outcome: 'QUESTION',
  eventId: 'e1',
  eventStatus: 'suggested',
  nodeId: 'toy_condition_a/q2',
  pathwayId: 'toy_condition_a',
  pathwayVersion: 1,
  pathwayTitle: 'Toy condition A',
  pathwayStatus: 'test',
  notActive: true,
  slot: 'toy_symptom_2',
  ask: 'Toy question: is toy symptom 2 present?',
  reasonText: 'Toy reason: toy symptom 2 adds weight.',
  redFlags: [],
  questionsUsed: 1,
  questionCap: 8,
  slotConflicts: [],
  ...over,
});
const record = (over: Partial<PathwayRecord> = {}): PathwayRecord => ({
  selected: null,
  acknowledgedRedFlags: [],
  notActive: true,
  ...over,
});
const questionProps = (over: Partial<QuestionPanelProps> = {}): QuestionPanelProps => ({
  consentOk: true,
  loading: false,
  busy: false,
  error: null,
  next: next(),
  record: record(),
  lang: 'en',
  onLang: vi.fn(),
  onAct: vi.fn(),
  ...over,
});

describe('QuestionPanel outcomes', () => {
  it('a question: the text, why it is suggested, the slot, and three buttons that do nothing until pressed', () => {
    const props = questionProps();
    render(<QuestionPanel {...props} />);
    expect(screen.getByText('Toy question: is toy symptom 2 present?').getAttribute('lang')).toBe(
      'en',
    );
    expect(screen.getByText(/Toy reason/)).toBeTruthy();
    expect(screen.getByText(/Slot: toy_symptom_2/)).toBeTruthy();
    expect(screen.getByText('Suggestions are aids; the doctor decides.')).toBeTruthy();
    expect(screen.getByText('Test pathway - not clinical')).toBeTruthy();
    expect(props.onAct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Asked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    expect((props.onAct as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['e1', 'asked'],
      ['e1', 'dismissed'],
      ['e1', 'snoozed'],
    ]);
  });
  it('the question language can be changed and the text carries that language', () => {
    const props = questionProps({ lang: 'gu', next: next({ ask: '[TOY-GU] Toy question' }) });
    render(<QuestionPanel {...props} />);
    expect(screen.getByText('[TOY-GU] Toy question').getAttribute('lang')).toBe('gu');
    fireEvent.change(screen.getByLabelText('Question language'), { target: { value: 'hi' } });
    expect(props.onLang).toHaveBeenCalledWith('hi');
  });
  it('ABSTAIN says there is not enough information and offers no buttons', () => {
    render(
      <QuestionPanel
        {...questionProps({ next: next({ outcome: 'ABSTAIN', eventId: null, ask: null }) })}
      />,
    );
    expect(screen.getByText('Not enough information, no suggestion.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Asked' })).toBeNull();
  });
  it('COMPLETE says there are no further questions', () => {
    render(
      <QuestionPanel
        {...questionProps({ next: next({ outcome: 'COMPLETE', eventId: null, ask: null }) })}
      />,
    );
    expect(screen.getByText('No further questions from the pathway.')).toBeTruthy();
  });
  it('RED_FLAG points to the notice; once acknowledged the pathway makes no further suggestions', () => {
    const { rerender } = render(
      <QuestionPanel {...questionProps({ next: next({ outcome: 'RED_FLAG', ask: null }) })} />,
    );
    expect(screen.getByText(/Review it in the notice above/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Asked' })).toBeNull();
    rerender(
      <QuestionPanel
        {...questionProps({
          next: next({ outcome: 'RED_FLAG', ask: null, eventStatus: 'acknowledged' }),
        })}
      />,
    );
    expect(screen.getByText(/makes no further suggestions/)).toBeTruthy();
  });
  it('a conflict between confirmed facts is named, a busy panel disables the buttons', () => {
    render(
      <QuestionPanel
        {...questionProps({ busy: true, next: next({ slotConflicts: ['toy_symptom_1'] }) })}
      />,
    );
    expect(screen.getByText(/disagree for: toy_symptom_1/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Asked' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it('an active pathway shows no test banner', () => {
    render(
      <QuestionPanel
        {...questionProps({ next: next({ notActive: false, pathwayStatus: 'active' }) })}
      />,
    );
    expect(screen.queryByText('Test pathway - not clinical')).toBeNull();
  });
  it('loading and error states are plain', () => {
    const { rerender } = render(<QuestionPanel {...questionProps({ loading: true })} />);
    expect(screen.getByText('Loading the suggestions')).toBeTruthy();
    rerender(<QuestionPanel {...questionProps({ loading: false, error: 'load', next: null })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/);
    rerender(<QuestionPanel {...questionProps({ error: 'save' })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/could not be saved/);
  });
});

describe('consent withdrawn', () => {
  it('the panel explains, offers nothing, and shows the kept decisions read only', () => {
    render(
      <QuestionPanel
        {...questionProps({
          consentOk: false,
          next: null,
          record: record({
            selected: {
              notListed: false,
              pathwayId: 'toy_condition_a',
              version: 1,
              title: 'Toy condition A',
              text: null,
              selectedAt: '2026-10-21T10:00:00.000Z',
            },
            acknowledgedRedFlags: [
              {
                eventId: 'r1',
                pathwayId: 'toy_condition_b',
                pathwayTitle: 'Toy condition B',
                actedAt: '2026-10-21T10:00:00.000Z',
              },
            ],
          }),
        })}
      />,
    );
    expect(screen.getByText(/consent is not on record/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Working condition: Toy condition A')).toBeTruthy();
    expect(screen.getByText(/red-flag condition acknowledged \(Toy condition B\)/)).toBeTruthy();
    expect(screen.getByText(/shown read only/)).toBeTruthy();
  });
});

describe('RedFlagBanner', () => {
  it('is an assertive alert with icon and words, stays until Acknowledge, and gives no advice', () => {
    const onAcknowledge = vi.fn();
    render(
      <RedFlagBanner
        next={next({ outcome: 'RED_FLAG', ask: null })}
        busy={false}
        onAcknowledge={onAcknowledge}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Pathway red-flag condition met - doctor to review');
    expect(alert.querySelector('svg')).toBeTruthy();
    expect(alert.textContent).toContain('stays until you acknowledge it');
    expect(alert.textContent).not.toMatch(/treat|prescrib|diagnos|give |start /i);
    expect(onAcknowledge).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole('button', { name: 'Acknowledge' }));
    expect(onAcknowledge).toHaveBeenCalledWith('e1');
  });
  it('is gone once acknowledged, and for every other outcome', () => {
    const { rerender } = render(
      <RedFlagBanner
        next={next({ outcome: 'RED_FLAG', eventStatus: 'acknowledged' })}
        busy={false}
        onAcknowledge={vi.fn()}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    for (const outcome of ['QUESTION', 'ABSTAIN', 'COMPLETE'] as const) {
      rerender(<RedFlagBanner next={next({ outcome })} busy={false} onAcknowledge={vi.fn()} />);
      expect(screen.queryByRole('alert')).toBeNull();
    }
    rerender(<RedFlagBanner next={null} busy={false} onAcknowledge={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

const fact = (over: Partial<Fact> = {}): Fact => ({
  id: 'f1',
  type: 'symptom',
  value: 'toy fact one',
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
  conceptId: 'toy_c_toy_symptom_1',
  conceptStatus: 'confirmed',
  conceptConfirmedAt: '2026-10-21T10:00:00.000Z',
  ...over,
});
const list = (over: Partial<CandidateList> = {}): CandidateList => ({
  outcome: 'QUESTION',
  notActive: true,
  selected: null,
  candidates: [1, 2, 3].map((n) => ({
    rank: n,
    pathwayId: `toy_condition_${n}`,
    version: 1,
    title: `Toy condition ${n}`,
    status: 'test' as const,
    evidenceFor: [{ ruleId: 'r1', slot: 'toy_symptom_1', nodeId: 'q1', factId: 'f1' }],
    evidenceAgainst:
      n === 1 ? [{ ruleId: 'r2', slot: 'toy_symptom_2', nodeId: 'q2', factId: 'f2' }] : [],
    source: { doc: 'TOY - not a real source', page: 0 },
  })),
  ...over,
});
const candProps = (over: Partial<CandidatesPanelProps> = {}): CandidatesPanelProps => ({
  consentOk: true,
  loading: false,
  busy: false,
  error: null,
  list: list(),
  record: record(),
  facts: [fact(), fact({ id: 'f2', value: 'toy fact two', negated: true })],
  onSelect: vi.fn(),
  onUndo: vi.fn(),
  ...over,
});

describe('CandidatesPanel', () => {
  it('shows up to three candidates with supporting and opposing facts, a source, and no number', () => {
    render(<CandidatesPanel {...candProps()} />);
    expect(
      screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-candidate')),
    ).toHaveLength(3);
    const first = document.querySelector('[data-candidate="toy_condition_1"]') as HTMLElement;
    expect(within(first).getByText('toy fact one')).toBeTruthy();
    expect(within(first).getByText('Not present: toy fact two')).toBeTruthy();
    expect(within(first).getByText(/Source: TOY - not a real source, page 0/)).toBeTruthy();
    expect(screen.getByText('Suggestions are aids; the doctor decides.')).toBeTruthy();
    expect(screen.getByText('Test pathway - not clinical')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/%|\d\.\d|confidence|score/i);
  });
  it('select as working condition, then undo', () => {
    const props = candProps();
    const { rerender } = render(<CandidatesPanel {...props} />);
    const second = document.querySelector('[data-candidate="toy_condition_2"]') as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: 'Select as working condition' }));
    expect(props.onSelect).toHaveBeenCalledWith({ pathwayId: 'toy_condition_2', version: 1 });
    const selected = {
      notListed: false,
      pathwayId: 'toy_condition_2',
      version: 1,
      title: 'Toy condition 2',
      text: null,
      selectedAt: '2026-10-21T10:00:00.000Z',
    };
    const props2 = candProps({ list: list({ selected }) });
    rerender(<CandidatesPanel {...props2} />);
    expect(
      within(screen.getByTestId('working-condition')).getByText(
        'Working condition: Toy condition 2',
      ),
    ).toBeTruthy();
    expect(
      (
        within(
          document.querySelector('[data-candidate="toy_condition_2"]') as HTMLElement,
        ).getByRole('button', {
          name: 'Working condition',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(props2.onUndo).toHaveBeenCalled();
  });
  it('"not listed" takes a short note and sends it', () => {
    const props = candProps();
    render(<CandidatesPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Working condition not listed' }));
    const save = screen.getByRole('button', { name: 'Save note' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Short note, in your own words'), {
      target: { value: 'my own words' },
    });
    fireEvent.click(save);
    expect(props.onSelect).toHaveBeenCalledWith({ notListed: true, text: 'my own words' });
  });
  it('says plainly when there are no candidates, and shows consent withdrawal with the kept choice read only', () => {
    const { rerender } = render(
      <CandidatesPanel {...candProps({ list: list({ candidates: [] }) })} />,
    );
    expect(screen.getByText(/No candidates yet/)).toBeTruthy();
    rerender(
      <CandidatesPanel
        {...candProps({
          consentOk: false,
          list: null,
          record: record({
            selected: {
              notListed: true,
              pathwayId: null,
              version: null,
              title: null,
              text: 'a note',
              selectedAt: '2026-10-21T10:00:00.000Z',
            },
          }),
        })}
      />,
    );
    expect(screen.getByText(/consent is not on record/)).toBeTruthy();
    expect(screen.getByText('Working condition not listed: a note')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// A mutation-style check on the wording rule: the checker must find a forbidden word when one is put in, otherwise a
// passing test would mean nothing.
const FORBIDDEN = /diagnos|prescrib|treat/i;
const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(strings)
      : [];

describe('wording rule', () => {
  it('no English text of the pathway panels says diagnosis, prescribe or treat', () => {
    const all = strings((resources as { pathway: unknown }).pathway);
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter((s) => FORBIDDEN.test(s))).toEqual([]);
  });
  it('the checker is not blind: a mutated string is caught', () => {
    const mutated = [...strings((resources as { pathway: unknown }).pathway), 'The diagnosis is X'];
    expect(mutated.filter((s) => FORBIDDEN.test(s))).toEqual(['The diagnosis is X']);
    expect(FORBIDDEN.test('Prescribe it')).toBe(true);
    expect(FORBIDDEN.test('Treatment plan')).toBe(true);
  });
  it('rendered panels in every state contain none of the words, and never print the API notice', () => {
    const states: ReactElement[] = [
      <QuestionPanel key="q" {...questionProps()} />,
      <QuestionPanel
        key="a"
        {...questionProps({ next: next({ outcome: 'ABSTAIN', eventId: null, ask: null }) })}
      />,
      <QuestionPanel
        key="c"
        {...questionProps({ next: next({ outcome: 'COMPLETE', eventId: null, ask: null }) })}
      />,
      <QuestionPanel key="w" {...questionProps({ consentOk: false, next: null })} />,
      <RedFlagBanner
        key="r"
        next={next({ outcome: 'RED_FLAG', ask: null })}
        busy={false}
        onAcknowledge={vi.fn()}
      />,
      <CandidatesPanel key="l" {...candProps()} />,
      <CandidatesPanel key="n" {...candProps({ list: list({ candidates: [] }) })} />,
      <CandidatesPanel key="x" {...candProps({ consentOk: false, list: null })} />,
    ];
    for (const ui of states) {
      const { container, unmount } = render(ui);
      expect(container.textContent ?? '').not.toMatch(FORBIDDEN);
      unmount();
    }
    // the API sends a notice that contains the word "diagnosis"; the panels must not print it
    const hostile = { ...list(), notice: 'This is not a diagnosis' } as CandidateList & {
      notice: string;
    };
    const { container } = render(<CandidatesPanel {...candProps({ list: hostile })} />);
    expect(container.textContent ?? '').not.toMatch(FORBIDDEN);
  });
});
