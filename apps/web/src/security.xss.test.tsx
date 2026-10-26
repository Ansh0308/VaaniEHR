// XSS: text from a transcript, a fact or a WhatsApp summary is shown as text and never becomes markup (Phase 12B, ADR-D44;
// ASVS 1.2.1, 3.2.2; OWASP LLM05 improper output handling). Hostile strings are rendered through the real components; nothing
// may create an element, run a handler or create a link. Fake data only.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FactChip } from './components/clinical/FactChip';
import { TranscriptPane, type TranscriptSegment } from './components/clinical/TranscriptPane';
import i18n from './i18n';
import { cleanupApp, IDS, renderApp, type Handler } from './test-utils/harness';

const HOSTILE = [
  '<img src=x onerror="window.__pwned=1">',
  '<script>window.__pwned=1</script>',
  '"><svg onload="window.__pwned=1">',
  '<a href="javascript:window.__pwned=1">click</a>',
  '<iframe src="javascript:window.__pwned=1"></iframe>',
  '<style>body{display:none}</style>',
  '&lt;b&gt;already escaped&lt;/b&gt;',
  '{{constructor.constructor("window.__pwned=1")()}}',
];

declare global {
  interface Window {
    __pwned?: number;
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  cleanupApp();
  delete window.__pwned;
});

const noMarkup = (container: ParentNode) => {
  // the app's own icons are inline SVG; hostile text must add none: compare with a render of harmless text
  expect(
    container.querySelectorAll('img, script, iframe, style, object, embed, form'),
  ).toHaveLength(0);
  expect(
    container.querySelectorAll('a[href^="javascript:"], [onerror], [onload], [onclick]'),
  ).toHaveLength(0);
  expect(window.__pwned).toBeUndefined();
};

describe('a fact chip', () => {
  it.each(HOSTILE)('shows %s as text', (payload) => {
    const { container } = render(
      <FactChip
        label="Symptom"
        value={payload}
        status="heard"
        sentence={payload}
        originalValue={payload}
      />,
    );
    noMarkup(container);
    expect(container.textContent).toContain(payload.slice(0, 12));
  });
  it('does not turn an attribute value into script (accessible names are plain text)', () => {
    const { container } = render(
      <FactChip label="Symptom" value={HOSTILE[0] as string} status="heard" />,
    );
    for (const el of container.querySelectorAll('[aria-label]')) {
      expect(el.getAttribute('aria-label')).not.toMatch(/^javascript:/i);
    }
    noMarkup(container);
  });
});

describe('the transcript', () => {
  const segment = (text: string, i: number): TranscriptSegment => ({
    id: `s${i}`,
    speaker: 'patient',
    text,
    lang: 'en',
    final: true,
    originalText: text,
    mark: text.slice(0, 6),
  });
  it('shows every hostile segment as text, also when part of it is highlighted', () => {
    const { container } = render(<TranscriptPane segments={HOSTILE.map(segment)} />);
    noMarkup(container);
    for (const payload of HOSTILE) expect(container.textContent).toContain(payload.slice(0, 12));
  });
});

describe('the WhatsApp summary page', () => {
  it('shows a hostile summary and free-text fields as text', async () => {
    const hostile = HOSTILE.join('\n');
    const state = {
      signedVersion: 1,
      safetyNotRun: false,
      whatsappConsent: true,
      provider: 'mock',
      summary: {
        id: '5eed0000-0000-4000-8000-0000000007a1',
        version: 1,
        status: 'needs_review',
        warningSigns: hostile,
        followUp: hostile,
        textGu: hostile,
        textEn: hostile,
        phraseTableVersion: '0.1',
        templateName: 'vaaniehr_visit_summary_gu',
        needsGujaratiReview: true,
        textHash: null,
        approvedAt: null,
        stale: false,
      },
      messages: [],
    };
    const routes: Record<string, Handler> = {
      'GET /sessions/:id/whatsapp': () => ({ data: state }),
    };
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    await renderApp({ role: 'doctor', path: `/consult/${IDS.session}/summary`, routes });
    await screen.findAllByText(/<img src=x/);
    noMarkup(document.body);
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
