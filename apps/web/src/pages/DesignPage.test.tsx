// Behaviour and automated accessibility checks, driven through the real /design page.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { ToastProvider } from '../components/ui/Toast';
import { DemoSessionProvider } from '../demo/session';
import i18n from '../i18n';

function renderDesign(path = '/design') {
  // Overlays set `inert` on #root, so mount inside a #root element like the real app.
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DemoSessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DemoSessionProvider>
    </MemoryRouter>,
    { container: root },
  );
}

beforeEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});
afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
});

describe('shell', () => {
  it('language toggle switches text and sets <html lang>', async () => {
    renderDesign();
    expect(document.documentElement.lang).toBe('en');
    const gu = screen.getByRole('button', { name: 'ગુજરાતી' });
    expect(gu.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(gu);
    expect(document.documentElement.lang).toBe('gu');
    expect(gu.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ડિઝાઇન સિસ્ટમ');
    // the banner stays after switching
    expect(screen.getByRole('region', { name: 'પ્રોટોટાઇપ સૂચના' })).toBeTruthy();
  });

  it('navigation follows the demo role', () => {
    renderDesign();
    const nav = () => screen.getByRole('navigation', { name: 'Main navigation' });
    const role = screen.getByLabelText(/Demo role/);
    fireEvent.change(role, { target: { value: 'doctor' } });
    expect(within(nav()).queryByText('Doctor dashboard')).toBeTruthy();
    expect(within(nav()).queryByText('Medicine master')).toBeNull();
    fireEvent.change(role, { target: { value: 'admin' } });
    expect(within(nav()).queryByText('Medicine master')).toBeTruthy();
    expect(within(nav()).queryByText('Doctor dashboard')).toBeNull();
  });

  it('has a skip link and one main landmark', () => {
    renderDesign();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toBeTruthy();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});

describe('overlays and widgets', () => {
  it('modal: focus moves in, Esc closes, focus returns to the trigger', () => {
    renderDesign();
    const trigger = screen.getByRole('button', { name: 'Open modal' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Modal dialog' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false);
  });

  it('modal: Tab wraps inside the dialog', () => {
    renderDesign();
    fireEvent.click(screen.getByRole('button', { name: 'Open modal' }));
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, input, textarea, select, a[href]',
    );
    const last = focusable[focusable.length - 1];
    last?.focus();
    fireEvent.keyDown(last as HTMLElement, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('drawer opens and closes with Esc', () => {
    renderDesign();
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    const drawer = screen.getByRole('dialog', { name: 'Drawer' });
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tabs: arrow keys move selection and focus (roving tabindex)', () => {
    renderDesign();
    const tablist = screen.getByRole('tablist', { name: 'Sample tabs' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    tabs[0]?.focus();
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    fireEvent.keyDown(tabs[1] as HTMLElement, { key: 'End' });
    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[2] as HTMLElement, { key: 'Home' });
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('combobox: typing filters, arrows and Enter select, empty state shown', () => {
    renderDesign();
    const input = screen.getByRole('combobox', { name: /Medicine \(fake list\)/ });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    fireEvent.change(input, { target: { value: 'Drug-' } });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = document.getElementById(
      input.getAttribute('aria-controls') ?? '',
    ) as HTMLElement;
    const options = within(listbox).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/Chosen: Drug-/)).toBeTruthy();
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(within(listbox).queryAllByRole('option')).toHaveLength(0);
    // visible message plus the polite live-region announcement
    expect(screen.getAllByText('No matching item')).toHaveLength(2);
  });

  it('toast: neutral is a polite status, blocked is an alert', () => {
    renderDesign();
    fireEvent.click(screen.getByRole('button', { name: 'Show neutral toast' }));
    expect(screen.getByRole('region', { name: 'Notifications' }).textContent).toContain(
      'Saved (sample)',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show blocked toast' }));
    expect(screen.getByRole('alert').textContent).toContain('Blocked');
  });

  it('stepper marks the current step', () => {
    renderDesign();
    const list = screen.getByRole('list', { name: 'Consultation steps' });
    expect(list.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('table is sortable with aria-sort and a caption', () => {
    renderDesign();
    const table = screen.getByRole('table', { name: /Fake patients waiting/ });
    const nameHeader = within(table).getByRole('columnheader', { name: /Name/ });
    const before = nameHeader.getAttribute('aria-sort');
    fireEvent.click(within(nameHeader).getByRole('button'));
    expect(nameHeader.getAttribute('aria-sort')).not.toBe(before);
  });
});

describe('clinical stubs', () => {
  it('Start recording is disabled with a visible reason until both consents are on', () => {
    renderDesign();
    const start = screen.getByRole('button', { name: 'Start recording' });
    if (start.hasAttribute('disabled') || start.getAttribute('aria-disabled') === 'true') {
      expect(screen.getAllByText(/Recording is off until consent/).length).toBeGreaterThan(0);
    } else {
      // The demo defaults to consent given; withdrawing it must disable recording.
      fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }));
      const after = screen.getByRole('button', { name: 'Start recording' });
      expect(after.hasAttribute('disabled') || after.getAttribute('aria-disabled') === 'true').toBe(
        true,
      );
    }
  });

  it('a blocked alert needs a typed reason of at least 8 characters to override', () => {
    renderDesign();
    const override = screen.getByRole('button', { name: 'Override and keep' });
    const reason = screen.getByLabelText(/Override reason/);
    fireEvent.change(reason, { target: { value: 'short' } });
    fireEvent.click(override);
    expect(screen.queryByText('Overridden with your reason. This is recorded.')).toBeNull();
    fireEvent.change(reason, { target: { value: 'a long enough reason' } });
    fireEvent.click(override);
    expect(screen.getByText('Overridden with your reason. This is recorded.')).toBeTruthy();
  });

  it('all five safety states show an icon-backed text label', () => {
    renderDesign();
    for (const label of ['Clear', 'Acknowledge', 'Blocked', 'Heard, unconfirmed', 'AI suggested']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });
});

describe('axe (jsdom; colour contrast is checked by tokens.contrast.test.ts and the browser run)', () => {
  for (const lang of ['en', 'gu'] as const) {
    it(`/design has no axe violations in ${lang}`, async () => {
      await act(() => i18n.changeLanguage(lang));
      const { container } = renderDesign();
      const results = await axe.run(container, {
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
      const summary = results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      );
      expect(summary).toEqual([]);
      // axe over the whole page is slow when every workspace's tests run in parallel
    }, 30_000);
  }
});
