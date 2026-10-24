// WhatsApp sending (Phase 10 Run 1, ADR-D41, FR-F10-02). A WhatsAppProvider interface with two implementations:
//  - MockWhatsApp (the DEFAULT): records the message in memory and "delivers" nothing;
//  - MetaWhatsApp: the WhatsApp Business Cloud API, written against Meta's documentation (see docs/WHATSAPP_SUBMISSION.md for
//    the pages): POST https://graph.facebook.com/{version}/{phone-number-id}/messages with a Bearer token and a template
//    message body {messaging_product, recipient_type, to, type: "template", template: {name, language: {code}, components:
//    [{type: "body", parameters: [{type: "text", text}, ...]}]}}; the answer carries messages[].id.
// Real sending is OFF unless every flag is set (WHATSAPP_PROVIDER=meta, WHATSAPP_ENABLE_REAL=true, token, phone-number id, API
// version, a non-empty test allowlist). A real send goes ONLY to a number on the allowlist, checked here at the last moment.
// No credentials are needed or used by the default setup, and a failed send is reported, never retried.
import { randomUUID } from 'node:crypto';
import type { SummaryParams } from './summary.js';

export interface SendInput {
  /** digits only with the country code, e.g. 919876543210 */
  toDigits: string;
  template: string;
  /** BCP-47-ish code Meta expects for the template language ("gu") */
  language: string;
  params: SummaryParams;
  /** the exact text the patient will see (kept by the mock, never sent by Meta, which renders the template itself) */
  text: string;
}
export interface SendResult {
  ok: boolean;
  providerMessageId: string | null;
  error: string | null;
}
export interface WhatsAppProvider {
  readonly name: 'mock' | 'meta';
  send(input: SendInput): Promise<SendResult>;
}

export interface RecordedMessage extends SendInput {
  id: string;
}

export class MockWhatsApp implements WhatsAppProvider {
  readonly name = 'mock' as const;
  readonly sent: RecordedMessage[] = [];
  async send(input: SendInput): Promise<SendResult> {
    const id = `mock-${randomUUID()}`;
    this.sent.push({ ...input, id });
    return { ok: true, providerMessageId: id, error: null };
  }
}

/** Digits only; a bare 10-digit Indian number gets 91 in front (ClinicOS keeps 10 digits, India only). */
export function toDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
}

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((x) => toDigits(x.trim()))
    .filter((x) => x.length >= 8);
}

export interface MetaConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  allowlist: string[];
  timeoutMs?: number;
}

export class MetaWhatsApp implements WhatsAppProvider {
  readonly name = 'meta' as const;
  constructor(
    private readonly cfg: MetaConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(input: SendInput): Promise<SendResult> {
    // the allowlist is the last gate: nothing reaches Meta for a number that is not on it
    if (!this.cfg.allowlist.includes(input.toDigits)) {
      return {
        ok: false,
        providerMessageId: null,
        error: 'The number is not on the test allowlist; nothing was sent.',
      };
    }
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.toDigits,
      type: 'template',
      template: {
        name: input.template,
        language: { code: input.language },
        components: [
          {
            type: 'body',
            parameters: [input.params.p1, input.params.p2, input.params.p3, input.params.p4].map(
              (text) => ({
                type: 'text',
                text,
              }),
            ),
          },
        ],
      },
    };
    try {
      const res = await this.fetchImpl(
        `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.cfg.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string; code?: number };
      };
      const id = json.messages?.[0]?.id;
      if (res.ok && id) return { ok: true, providerMessageId: id, error: null };
      // the error text comes from Meta and may be long: keep the code and a short message only
      return {
        ok: false,
        providerMessageId: null,
        error: `WhatsApp refused the message (HTTP ${res.status}${json.error?.code ? `, code ${json.error.code}` : ''}).`,
      };
    } catch {
      return {
        ok: false,
        providerMessageId: null,
        error: 'WhatsApp could not be reached or timed out.',
      };
    }
  }
}

/** A real provider that was asked for but is not fully set up: it fails every send with the reason; it never falls back to mock. */
export class NotConfiguredWhatsApp implements WhatsAppProvider {
  readonly name = 'meta' as const;
  constructor(private readonly reason: string) {}
  async send(): Promise<SendResult> {
    return { ok: false, providerMessageId: null, error: this.reason };
  }
}

export interface WhatsAppEnv {
  WHATSAPP_PROVIDER?: string | undefined;
  WHATSAPP_ENABLE_REAL?: string | undefined;
  WHATSAPP_ACCESS_TOKEN?: string | undefined;
  WHATSAPP_PHONE_NUMBER_ID?: string | undefined;
  WHATSAPP_API_VERSION?: string | undefined;
  WHATSAPP_TEST_ALLOWLIST?: string | undefined;
}

export function createWhatsApp(env: WhatsAppEnv): WhatsAppProvider {
  if ((env.WHATSAPP_PROVIDER ?? 'mock') !== 'meta') return new MockWhatsApp();
  if (env.WHATSAPP_ENABLE_REAL !== 'true') {
    return new NotConfiguredWhatsApp(
      'Real WhatsApp sending is off (WHATSAPP_ENABLE_REAL is not true).',
    );
  }
  const allowlist = parseAllowlist(env.WHATSAPP_TEST_ALLOWLIST);
  if (
    !env.WHATSAPP_ACCESS_TOKEN ||
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !env.WHATSAPP_API_VERSION ||
    allowlist.length === 0
  ) {
    return new NotConfiguredWhatsApp(
      'Real WhatsApp sending needs an access token, a phone-number id, an API version and a non-empty test allowlist.',
    );
  }
  return new MetaWhatsApp({
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: env.WHATSAPP_API_VERSION,
    allowlist,
  });
}
