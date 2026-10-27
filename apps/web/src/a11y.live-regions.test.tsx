// Dynamic regions and focus handling (Phase 12B Run 2, docs/A11Y_REPORT.md): what is announced, with which role, and where focus
// goes. These are structural checks in jsdom; what a screen reader actually says is for the manual NVDA test (OWNER_ACTIONS).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Banner } from './components/ui/Banner';
import { ErrorSummary } from './components/ui/ErrorSummary';
import { Modal } from './components/ui/Overlay';
import { ToastProvider, useToast } from './components/ui/Toast';
import { RedFlagBanner } from './components/clinical/RedFlagBanner';
import { TranscriptPane } from './components/clinical/TranscriptPane';
import type { NextQuestion } from './api/pathwayAids';
import i18n from './i18n';
import { cleanupApp, renderApp } from './test-utils/harness';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  cleanupApp();
});

describe('banners', () => {
  it('a blocked banner that is live is an alert; other live banners are polite status; static banners say nothing', () => {
    render(
      <>
        <Banner kind="blocked" live title="Blocked">
          blocked text
        </Banner>
        <Banner kind="clear" live title="Clear">
          clear text
        </Banner>
        <Banner kind="acknowledge" title="Static">
          static text
        </Banner>
      </>,
    );
    expect(screen.getByRole('alert').textContent).toContain('blocked text');
    expect(screen.getByRole('status').textContent).toContain('clear text');
    expect(screen.getByText('static text').closest('[role]')).toBeNull();
  });
});

describe('toasts', () => {
  function Trigger() {
    const toast = useToast();
    return (
      <>
        <button onClick={() => toast.push({ kind: 'clear', title: 'Saved' })}>clear</button>
        <button onClick={() => toast.push({ kind: 'blocked', title: 'Refused' })}>blocked</button>
      </>
    );
  }
  it('sit in a polite named region; only a blocked toast is an alert', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    const region = screen.getByRole('region', { name: /notifications/i });
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-relevant')).toBe('additions');
    fireEvent.click(screen.getByText('clear'));
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByText('blocked'));
    expect(screen.getByRole('alert').textContent).toContain('Refused');
  });
});

describe('the red-flag banner', () => {
  const next: NextQuestion = {
    outcome: 'RED_FLAG',
    eventId: 'e1',
    eventStatus: 'suggested',
    nodeId: 'n1',
    pathwayId: 'toy_condition_b',
    pathwayVersion: 1,
    pathwayTitle: 'Toy condition B',
    pathwayStatus: 'test',
    notActive: true,
    slot: null,
    ask: null,
    reasonText: 'Toy reason.',
    redFlags: ['toy_redflag_1'],
    questionsUsed: 1,
    questionCap: 8,
    slotConflicts: [],
  };
  it('is an assertive alert with words and an icon-free text name, and goes away only after acknowledgement', () => {
    const { rerender } = render(
      <RedFlagBanner next={next} busy={false} onAcknowledge={() => undefined} />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Toy reason/);
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeTruthy();
    rerender(
      <RedFlagBanner
        next={{ ...next, eventStatus: 'acknowledged' }}
        busy={false}
        onAcknowledge={() => undefined}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the live transcript', () => {
  it('does not announce every partial word (aria-live off); the recording bar carries the polite status instead', () => {
    const { container } = render(
      <TranscriptPane
        segments={[{ id: 's1', speaker: 'patient', text: 'hello', lang: 'en', final: false }]}
      />,
    );
    expect(container.querySelector('ol')?.getAttribute('aria-live')).toBe('off');
  });
});

describe('forms', () => {
  it('an error summary is an alert that can take focus, and its links move focus to the field', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <>
        <ErrorSummary ref={ref} title="Fix these" errors={[{ fieldId: 'f1', message: 'Needed' }]} />
        <input id="f1" aria-label="field" />
      </>,
    );
    const summary = screen.getByRole('alert');
    expect(summary.getAttribute('tabindex')).toBe('-1');
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(summary);
    fireEvent.click(screen.getByRole('link', { name: 'Needed' }));
    expect(document.activeElement?.id).toBe('f1');
  });
});

describe('dialogs', () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <div id="root">
        <button onClick={() => setOpen(true)}>open dialog</button>
        <Modal open={open} onClose={() => setOpen(false)} title="A dialog">
          <button>inside</button>
        </Modal>
      </div>
    );
  }
  it('moves focus in, keeps it in, closes on Escape and returns focus to the opener', async () => {
    render(<Host />);
    const opener = screen.getByText('open dialog');
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'A dialog' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('moving between pages', () => {
  it('sets the page title from the heading and moves focus to the main region after a route change, not on the first load', async () => {
    await renderApp({
      role: 'doctor',
      path: '/settings',
      routes: { 'GET /templates': () => ({ data: { items: [], total: 0 } }) },
    });
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(document.title).toMatch(/ - VaaniEHR$/));
    expect(document.activeElement?.id).not.toBe('main'); // first load: nothing is stolen
    fireEvent.click(
      screen.getAllByRole('link', { name: 'Prescription templates' })[0] as HTMLElement,
    );
    await waitFor(() => expect(document.activeElement?.id).toBe('main'), { timeout: 2000 });
    expect(document.title).not.toBe('VaaniEHR (research prototype)');
    expect(document.title).toMatch(/ - VaaniEHR$/);
  });
});
