// Failure modes of the fact service (Phase 8 Run 2): the language model is down, rate limited or not allowed for the data.
// The doctor gets a plain message, and adding facts by hand still works. Nothing is silently skipped.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { FactsPanel, type FactsPanelProps } from './FactsPanel';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

const panel = (over: Partial<FactsPanelProps> = {}) => {
  const onAdd = vi.fn(() => Promise.resolve(true));
  render(
    <FactsPanel
      facts={[]}
      sentenceOf={() => null}
      mode="live"
      blocked={null}
      busy={false}
      extracting={false}
      error={null}
      announcement=""
      onExtract={vi.fn()}
      onConfirm={vi.fn()}
      onReject={vi.fn()}
      onEdit={vi.fn()}
      onAdd={onAdd}
      onPeek={vi.fn()}
      {...over}
    />,
  );
  return { onAdd };
};

describe('fact extraction fails', () => {
  it.each([
    ['model_unavailable', /could not be reached/],
    ['rate_limited', /busy right now/],
    ['cap_reached', /usage limit/],
    ['network', /could not be reached/],
    ['other', /could not be extracted/],
  ] as const)('%s: plain message, and facts can still be added by hand', (error, message) => {
    const { onAdd } = panel({ error });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(message);
    expect(alert.textContent).toMatch(/You can still add facts by hand/);
    fireEvent.click(screen.getByRole('button', { name: 'Add a fact by hand' }));
    fireEvent.change(screen.getByLabelText('Fact'), { target: { value: 'typed by hand' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add fact' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ value: 'typed by hand' }));
  });

  it('a real model that is not allowed for this data: nothing is sent, the message says so, manual still works', () => {
    panel({ mode: 'blocked' });
    expect(screen.getByRole('alert').textContent).toMatch(/Nothing was sent/);
    expect(screen.getByRole('alert').textContent).toMatch(/add facts by hand/);
    expect(
      (screen.getByRole('button', { name: 'Add a fact by hand' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('a failed save or a consent problem does not claim the manual fallback', () => {
    panel({ error: 'save' });
    expect(screen.getByRole('alert').textContent).not.toMatch(/add facts by hand/);
  });
});
