// PG-11 WhatsApp summary approval page (Phase 10 Run 1): the sign and consent banners, the safety-not-run banner, only the two
// free-text fields editable, the Gujarati preview beside the approximate English back-translation (both labelled), approve and
// send, the log with the last four digits, server refusals in words, Gujarati. A small fake server keeps the state.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { WhatsAppMessage, WhatsAppState, WhatsAppSummary } from '../api/whatsapp';
import { cleanupApp, IDS, renderApp, type Handler } from '../test-utils/harness';

afterEach(cleanupApp);

const GU =
  'તમારી મુલાકાતનો સારાંશ\n\nતારણો: લક્ષણ: toy symptom\n\nદવાઓ: 1. Drug-A (FAKE) 500 mg Tablet - 1 tablet, દિવસમાં બે વાર, 5 days';
const EN =
  'Summary of your visit\n\nFindings: Symptom: toy symptom\n\nMedicines: 1. Drug-A (FAKE) 500 mg Tablet - 1 tablet, twice a day, 5 days';
const summary = (over: Partial<WhatsAppSummary> = {}): WhatsAppSummary => ({
  id: '5eed0000-0000-4000-8000-0000000007a1',
  version: 1,
  status: 'needs_review',
  warningSigns: 'toy warning words',
  followUp: 'toy follow-up words',
  textGu: GU,
  textEn: EN,
  phraseTableVersion: '0.1',
  templateName: 'vaaniehr_visit_summary_gu',
  needsGujaratiReview: true,
  textHash: null,
  approvedAt: null,
  stale: false,
  ...over,
});
const base = (over: Partial<WhatsAppState> = {}): WhatsAppState => ({
  signedVersion: 1,
  safetyNotRun: true,
  whatsappConsent: true,
  provider: 'mock',
  summary: null,
  messages: [],
  ...over,
});

function server(initial: WhatsAppState) {
  const st = { data: initial, fail: null as null | { status: number; code: string } };
  const failure = () => {
    const f = st.fail;
    st.fail = null;
    return f ? { status: f.status, error: { code: f.code, message: 'x' } } : null;
  };
  const routes: Record<string, Handler> = {
    'GET /sessions/:id/whatsapp': () => ({ data: st.data }),
    'POST /sessions/:id/whatsapp/summary': (req) => {
      const f = failure();
      if (f) return f;
      const b = req.body as { warningSigns: string; followUp: string };
      st.data = {
        ...st.data,
        summary: summary({ warningSigns: b.warningSigns, followUp: b.followUp }),
      };
      return { status: 201, data: st.data.summary };
    },
    'POST /sessions/:id/whatsapp/approve': () => {
      const f = failure();
      if (f) return f;
      st.data = {
        ...st.data,
        summary: summary({
          ...st.data.summary!,
          status: 'approved',
          textHash: 'f'.repeat(64),
          approvedAt: '2026-10-24T10:00:00.000Z',
        }),
      };
      return { data: st.data.summary };
    },
    'POST /sessions/:id/whatsapp/send': () => {
      const f = failure();
      if (f) return f;
      const m: WhatsAppMessage = {
        id: '5eed0000-0000-4000-8000-0000000008a1',
        summaryVersion: 1,
        status: 'sent',
        provider: 'mock',
        template: 'vaaniehr_visit_summary_gu',
        recipientLast4: '0001',
        errorMessage: null,
        sentAt: '2026-10-24T10:01:00.000Z',
        deliveredAt: null,
      };
      st.data = { ...st.data, messages: [m] };
      return { status: 201, data: m };
    },
  };
  return { st, routes };
}

const open = (s: ReturnType<typeof server>, language: 'en' | 'gu' = 'en') =>
  renderApp({
    role: 'doctor',
    path: `/consult/${IDS.session}/summary`,
    language,
    routes: s.routes,
  });
const preview = async () => {
  fireEvent.change(screen.getByLabelText(/^Warning signs/), {
    target: { value: 'toy warning words' },
  });
  fireEvent.change(screen.getByLabelText(/^Follow-up/), {
    target: { value: 'toy follow-up words' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview summary' }));
  await screen.findByRole('region', { name: 'Summary preview' });
};

describe('gates and banners', () => {
  it('an unsigned visit says so and offers nothing', async () => {
    await open(server(base({ signedVersion: null, safetyNotRun: false })));
    expect(await screen.findByText(/not signed yet, so no summary/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Preview summary' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('link', { name: 'Go to sign-off' })).toBeTruthy();
  });

  it('without WhatsApp consent it says so, links to the consent screen and offers nothing', async () => {
    await open(server(base({ whatsappConsent: false })));
    expect(await screen.findByText('No WhatsApp consent on record')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the consent screen' }).getAttribute('href')).toBe(
      `/consult/${IDS.session}/consent`,
    );
    expect(
      (screen.getByRole('button', { name: 'Preview summary' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the test-mode banner, and the safety-checks-not-run banner when the signed record says so', async () => {
    await open(server(base()));
    expect(await screen.findByText('Test mode: nothing is sent to WhatsApp')).toBeTruthy();
    expect(screen.getByText(/Safety checks were not run on this signed record/)).toBeTruthy();
  });

  it('no safety banner when the record has no such flag; real WhatsApp is announced as such', async () => {
    await open(server(base({ safetyNotRun: false, provider: 'meta' })));
    expect(await screen.findByText('Real WhatsApp is switched on')).toBeTruthy();
    expect(screen.queryByText(/Safety checks were not run on this signed record/)).toBeNull();
  });
});

describe('preview, approve and send', () => {
  it('only the two free-text fields are editable; the preview shows Gujarati beside an approximate English back-translation', async () => {
    const s = server(base());
    const { calls } = await open(s);
    await screen.findByText('Warning signs and follow-up');
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    await preview();
    expect(
      calls.find((c) => c.method === 'POST' && c.path.endsWith('/whatsapp/summary'))?.body,
    ).toEqual({
      warningSigns: 'toy warning words',
      followUp: 'toy follow-up words',
    });
    const region = screen.getByRole('region', { name: 'Summary preview' });
    expect(within(region).getByTestId('wa-gu').textContent).toContain('દિવસમાં બે વાર');
    expect(within(region).getByTestId('wa-gu').getAttribute('lang')).toBe('gu');
    expect(within(region).getByTestId('wa-en').textContent).toContain('twice a day');
    expect(within(region).getByText('Needs Gujarati review')).toBeTruthy();
    expect(within(region).getByText('Approximate')).toBeTruthy();
    expect(within(region).getByText('Needs review')).toBeTruthy();
    // the generated text is not an input: nothing in the preview can be edited
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('changing a field after the preview switches the approval off until the preview is made again', async () => {
    await open(server(base()));
    await screen.findByText('Warning signs and follow-up');
    await preview();
    const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/^Follow-up/), { target: { value: 'something else' } });
    expect(approve.disabled).toBe(true);
    expect(screen.getByText(/You changed the text after the preview/)).toBeTruthy();
  });

  it('approving stores the hash, locks the fields and offers Send; sending shows the message in the log with its last four digits', async () => {
    const s = server(base());
    const { calls } = await open(s);
    await screen.findByText('Warning signs and follow-up');
    await preview();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/f{64}/)).toBeTruthy();
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    for (const box of screen.getAllByRole('textbox'))
      expect((box as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send to the patient' }));
    const log = await screen.findByRole('region', { name: 'WhatsApp messages' });
    expect(await within(log).findByText(/number ending 0001/)).toBeTruthy();
    expect(within(log).getByText('Sent')).toBeTruthy();
    expect(within(log).getByText(/test mode \(not sent\)/)).toBeTruthy();
    expect(
      calls
        .filter((c) => c.method === 'POST' && c.path.includes('/whatsapp/'))
        .map((c) => c.path.split('/whatsapp/')[1]),
    ).toEqual(['summary', 'approve', 'send']);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Sent' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
  });

  it('Approve and send does both steps in order', async () => {
    const s = server(base());
    const { calls } = await open(s);
    await screen.findByText('Warning signs and follow-up');
    await preview();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/whatsapp/send'))).toBe(true));
    expect(
      calls
        .filter((c) => c.method === 'POST' && c.path.includes('/whatsapp/'))
        .map((c) => c.path.split('/whatsapp/')[1]),
    ).toEqual(['summary', 'approve', 'send']);
  });

  it('a refused approval stops there: the send is not tried', async () => {
    const s = server(base());
    const { calls } = await open(s);
    await screen.findByText('Warning signs and follow-up');
    await preview();
    s.st.fail = { status: 409, code: 'CONFLICT' };
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/The server refused this step/);
    expect(calls.some((c) => c.path.endsWith('/whatsapp/send'))).toBe(false);
  });

  it('a consent refusal and a bad text are said in words', async () => {
    const s = server(base());
    await open(s);
    await screen.findByText('Warning signs and follow-up');
    s.st.fail = { status: 403, code: 'CONSENT_REQUIRED' };
    fireEvent.click(screen.getByRole('button', { name: 'Preview summary' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /WhatsApp consent is not on record/,
    );
    s.st.fail = { status: 400, code: 'VALIDATION_ERROR' };
    fireEvent.click(screen.getByRole('button', { name: 'Preview summary' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be used/));
  });

  it('a summary made for an older version is stale and cannot be approved or sent', async () => {
    await open(server(base({ signedVersion: 2, summary: summary({ stale: true }) })));
    expect(await screen.findByText('The visit was amended after this summary')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Approve and send' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('works in Gujarati', async () => {
    await open(server(base()), 'gu');
    expect(await screen.findByRole('button', { name: 'સારાંશ જુઓ' })).toBeTruthy();
    expect(screen.getByText('દર્દી માટે WhatsApp સારાંશ')).toBeTruthy();
  });
});

describe('the message list on the visit record', () => {
  it('shows the WhatsApp messages sent for the visit', async () => {
    const visit = {
      version: 1,
      kind: 'signed',
      contentHash: 'a'.repeat(64),
      safetyConfigured: false,
      safetyNotRunAcknowledged: true,
      reason: null,
      signedBy: IDS.user('doctor'),
      signedAt: '2026-10-22T10:00:00.000Z',
      content: {
        schema: 1,
        sessionId: IDS.session,
        signedAt: '2026-10-22T10:00:00.000Z',
        facts: [],
        workingCondition: null,
        medicines: [],
        consent: { audio: true, aiProcessing: true },
        aiContentIncluded: false,
        amendedFrom: null,
      },
    };
    await renderApp({
      role: 'doctor',
      path: `/consult/${IDS.session}/record`,
      routes: {
        'GET /sessions/:id/visit': () => ({ data: visit }),
        'GET /sessions/:id/visit/versions': () => ({ data: { versions: [] } }),
        'GET /sessions/:id/whatsapp': () => ({
          data: base({
            messages: [
              {
                id: 'm1',
                summaryVersion: 1,
                status: 'delivered',
                provider: 'meta',
                template: 't',
                recipientLast4: '4321',
                errorMessage: null,
                sentAt: '2026-10-24T10:01:00.000Z',
                deliveredAt: '2026-10-24T10:02:00.000Z',
              },
            ],
          }),
        }),
      },
    });
    const log = await screen.findByRole('region', { name: 'WhatsApp messages' });
    expect(within(log).getByText('Delivered')).toBeTruthy();
    expect(within(log).getByText(/number ending 4321/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'WhatsApp summary' }).getAttribute('href')).toBe(
      `/consult/${IDS.session}/summary`,
    );
  });
});
