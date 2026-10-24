// The Gujarati summary, the mismatch detector and the providers (Phase 10 Run 1, ADR-D41). Fully fake data.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { findMismatches } from '../../src/whatsapp/detector.js';
import { FREQUENCY, P, TEMPLATE_BODY_GU, allGujaratiPhrases } from '../../src/whatsapp/phrases.js';
import {
  MetaWhatsApp,
  MockWhatsApp,
  NotConfiguredWhatsApp,
  createWhatsApp,
  parseAllowlist,
  toDigits,
} from '../../src/whatsapp/provider.js';
import {
  SummaryError,
  buildSummary,
  summaryHash,
  type SummaryParams,
} from '../../src/whatsapp/summary.js';
import type { SignedContent } from '../../src/visits/repository.js';
import { GOLDEN_INPUTS } from '../fhir/goldenVisits.js';

const content = (GOLDEN_INPUTS['visit1-signed'] as NonNullable<(typeof GOLDEN_INPUTS)[string]>)
  .content;
const free = { warningSigns: 'toy warning words', followUp: 'toy follow-up words' };
const fill = (p: SummaryParams) =>
  TEMPLATE_BODY_GU.replace('{{1}}', p.p1)
    .replace('{{2}}', p.p2)
    .replace('{{3}}', p.p3)
    .replace('{{4}}', p.p4);

describe('building the summary from the signed snapshot', () => {
  const s = buildSummary(content, free);

  it('copies every medicine field verbatim and uses the fixed phrase for the frequency', () => {
    expect(s.params.p2).toBe(
      `1. Drug-A (FAKE) 500 mg Tablet - 1 tablet, ${FREQUENCY['BD']?.gu}, 5 days | 2. Hand-typed (FAKE) - ${FREQUENCY['OD']?.gu}, 3 days`,
    );
  });
  it('renders facts through the fixed label table and passes the value through unchanged', () => {
    expect(s.params.p1).toContain('લક્ષણ: toy symptom one');
    expect(s.params.p1).toContain(`લક્ષણ: toy symptom two (${P.negated.gu})`);
    expect(s.params.p1).toContain('સમયગાળો: 2 days toy');
  });
  it('puts the doctor-typed warning signs and follow-up in unchanged, as one line', () => {
    const t = buildSummary(content, {
      warningSigns: 'line one\nline two\t  tab',
      followUp: '  spaced   out ',
    });
    expect(t.params.p3).toBe('line one line two tab');
    expect(t.params.p4).toBe('spaced out');
  });
  it('the system never writes a warning sign or follow-up: empty fields get only the fixed no-note phrase', () => {
    const t = buildSummary(content, { warningSigns: '', followUp: '   ' });
    expect(t.params.p3).toBe(P.none.gu);
    expect(t.params.p4).toBe(P.none.gu);
    expect(t.textEn).toContain(`Warning signs: ${P.none.en}`);
  });
  it('the Gujarati text is the fixed template with the four variables, and every variable is one line', () => {
    expect(s.textGu).toBe(fill(s.params));
    for (const v of Object.values(s.params)) expect(v).not.toMatch(/[\n\r\t]/);
  });
  it('the English back-translation uses the English side of the table and keeps free text as typed', () => {
    expect(s.textEn).toContain('Summary of your visit');
    expect(s.textEn).toContain('twice a day');
    expect(s.textEn).toContain('Symptom: toy symptom two (not present)');
    expect(s.textEn).toContain('toy warning words');
  });
  it('a red-flag mention is not sent to the patient', () => {
    const c: SignedContent = {
      ...content,
      facts: [
        ...content.facts,
        { ...content.facts[0]!, id: 'x', type: 'red_flag_mention', value: 'toy red flag' },
      ],
    };
    expect(buildSummary(c, free).textGu).not.toContain('toy red flag');
  });
  it('a visit with no facts and no medicines still builds, with the fixed phrase only', () => {
    const t = buildSummary({ ...content, facts: [], medicines: [] }, free);
    expect(t.params.p1).toBe(P.none.gu);
    expect(t.params.p2).toBe(P.none.gu);
  });
  it('refuses text that is too long, a placeholder in the free text, and a snapshot value it cannot send', () => {
    expect(() => buildSummary(content, { warningSigns: 'x'.repeat(601), followUp: '' })).toThrow(
      SummaryError,
    );
    expect(() => buildSummary(content, { warningSigns: 'see {{1}}', followUp: '' })).toThrow(
      /placeholder/,
    );
    const c: SignedContent = {
      ...content,
      medicines: [{ ...content.medicines[0]!, name: 'bad | name' }],
    };
    expect(() => buildSummary(c, free)).toThrow(/separator/);
  });
  it('the hash covers the text and the variables, so any change changes it', () => {
    const a = summaryHash(s.textGu, s.params);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(summaryHash(s.textGu, { ...s.params, p3: 'other' })).not.toBe(a);
    expect(summaryHash(`${s.textGu} `, s.params)).not.toBe(a);
  });
});

describe('the mismatch detector', () => {
  const s = buildSummary(content, free);
  const run = (params: SummaryParams, text = fill(params)) => findMismatches(params, text, content);
  const codes = (m: ReturnType<typeof run>) => m.map((x) => x.code);

  it('finds nothing in a correct summary', () => {
    expect(run(s.params)).toEqual([]);
  });
  it('catches a wrong strength (500 mg became 50 mg)', () => {
    expect(codes(run({ ...s.params, p2: s.params.p2.replace('500 mg', '50 mg') }))).toContain(
      'strength',
    );
  });
  it('catches a wrong dose, frequency and duration', () => {
    expect(codes(run({ ...s.params, p2: s.params.p2.replace('1 tablet', '2 tablet') }))).toContain(
      'dose',
    );
    expect(
      codes(
        run({ ...s.params, p2: s.params.p2.replace(FREQUENCY['BD']!.gu, FREQUENCY['TDS']!.gu) }),
      ),
    ).toContain('frequency');
    expect(codes(run({ ...s.params, p2: s.params.p2.replace('5 days', '15 days') }))).toContain(
      'duration',
    );
  });
  it('catches a missing medicine and an extra one', () => {
    const items = s.params.p2.split(' | ');
    expect(codes(run({ ...s.params, p2: items[0]! }))).toContain('medicine_count');
    expect(
      codes(run({ ...s.params, p2: `${s.params.p2} | 3. Extra - ${FREQUENCY['OD']!.gu}, 1 day` })),
    ).toContain('medicine_count');
  });
  it('catches a changed name, a swapped order and text added after a medicine', () => {
    expect(
      codes(run({ ...s.params, p2: s.params.p2.replace('Drug-A (FAKE)', 'Drug-B (FAKE)') })),
    ).toContain('name');
    const [a, b] = s.params.p2.split(' | ');
    expect(
      run({ ...s.params, p2: `${b!.replace('2.', '1.')} | ${a!.replace('1.', '2.')}` }).length,
    ).toBeGreaterThan(0);
    expect(
      codes(run({ ...s.params, p2: s.params.p2.replace('5 days', '5 days, take double') })),
    ).toContain('trailing');
  });
  it('catches a changed finding, and text that is not the fixed template', () => {
    expect(
      codes(run({ ...s.params, p1: s.params.p1.replace('toy symptom one', 'toy symptom nine') })),
    ).toContain('fact');
    expect(codes(run(s.params, `${s.textGu}\nextra advice`))).toContain('text');
  });
  it('catches medicines listed for a visit that has none', () => {
    expect(codes(findMismatches(s.params, s.textGu, { ...content, medicines: [] }))).toContain(
      'medicine_count',
    );
  });
});

describe('providers', () => {
  const input = (to: string) => ({
    toDigits: to,
    template: 'vaaniehr_visit_summary_gu',
    language: 'gu',
    params: buildSummary(content, free).params,
    text: 'x',
  });
  const cfg = {
    accessToken: 'test-token',
    phoneNumberId: '123',
    apiVersion: 'v-test',
    allowlist: ['919999900001'],
  };

  it('normalises numbers: a bare 10-digit number is Indian; the allowlist is parsed', () => {
    expect(toDigits('0000000001')).toBe('910000000001');
    expect(toDigits('+91 99999 00001')).toBe('919999900001');
    expect(parseAllowlist('+91 99999 00001, 12, 919999900002')).toEqual([
      '919999900001',
      '919999900002',
    ]);
  });
  it('the mock records the message and sends nothing anywhere', async () => {
    const mock = new MockWhatsApp();
    const r = await mock.send(input('919999900001'));
    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toMatch(/^mock-/);
    expect(mock.sent).toHaveLength(1);
  });
  it('the default is the mock; real sending needs every flag; a half-set real provider fails, it never falls back', async () => {
    expect(createWhatsApp({}).name).toBe('mock');
    expect(createWhatsApp({ WHATSAPP_PROVIDER: 'mock', WHATSAPP_ACCESS_TOKEN: 't' }).name).toBe(
      'mock',
    );
    const off = createWhatsApp({ WHATSAPP_PROVIDER: 'meta', WHATSAPP_ACCESS_TOKEN: 't' });
    expect(off).toBeInstanceOf(NotConfiguredWhatsApp);
    expect(((await off.send(input('919999900001'))) as { error: string }).error).toMatch(/off/);
    const half = createWhatsApp({
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_ENABLE_REAL: 'true',
      WHATSAPP_ACCESS_TOKEN: 't',
    });
    expect(half).toBeInstanceOf(NotConfiguredWhatsApp);
    const noList = createWhatsApp({
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_ENABLE_REAL: 'true',
      WHATSAPP_ACCESS_TOKEN: 't',
      WHATSAPP_PHONE_NUMBER_ID: '1',
      WHATSAPP_API_VERSION: 'v1',
    });
    expect(noList).toBeInstanceOf(NotConfiguredWhatsApp);
    const on = createWhatsApp({
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_ENABLE_REAL: 'true',
      WHATSAPP_ACCESS_TOKEN: 't',
      WHATSAPP_PHONE_NUMBER_ID: '1',
      WHATSAPP_API_VERSION: 'v1',
      WHATSAPP_TEST_ALLOWLIST: '9999900001',
    });
    expect(on).toBeInstanceOf(MetaWhatsApp);
  });
  it('the real client never calls Meta for a number that is not on the allowlist', async () => {
    const fetchSpy = vi.fn();
    const meta = new MetaWhatsApp(cfg, fetchSpy as unknown as typeof fetch);
    const r = await meta.send(input('919876543210'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/allowlist/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('the real client sends the documented template request to the allowlisted number and reads messages[].id', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.TEST' }] }),
          { status: 200 },
        ),
    );
    const meta = new MetaWhatsApp(cfg, fetchSpy as unknown as typeof fetch);
    const r = await meta.send(input('919999900001'));
    expect(r).toEqual({ ok: true, providerMessageId: 'wamid.TEST', error: null });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://graph.facebook.com/v-test/123/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer test-token');
    const body = JSON.parse(init.body) as {
      messaging_product: string;
      recipient_type: string;
      to: string;
      type: string;
      template: {
        name: string;
        language: { code: string };
        components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }>;
      };
    };
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919999900001',
      type: 'template',
    });
    expect(body.template.name).toBe('vaaniehr_visit_summary_gu');
    expect(body.template.language).toEqual({ code: 'gu' });
    expect(body.template.components[0]?.type).toBe('body');
    expect(body.template.components[0]?.parameters.map((p) => p.type)).toEqual([
      'text',
      'text',
      'text',
      'text',
    ]);
    expect(body.template.components[0]?.parameters.every((p) => !/[\n\t]/.test(p.text))).toBe(true);
  });
  it('a refusal or a network failure is reported in plain words and is never retried', async () => {
    const refuse = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 132000, message: 'secret detail' } }), {
          status: 400,
        }),
    );
    const r = await new MetaWhatsApp(cfg, refuse as unknown as typeof fetch).send(
      input('919999900001'),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe('WhatsApp refused the message (HTTP 400, code 132000).');
    expect(refuse).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => {
      throw new Error('boom');
    });
    const d = await new MetaWhatsApp(cfg, down as unknown as typeof fetch).send(
      input('919999900001'),
    );
    expect(d.error).toBe('WhatsApp could not be reached or timed out.');
    expect(down).toHaveBeenCalledTimes(1);
  });
});

describe('the phrase table', () => {
  it('lists every Gujarati phrase once for the review document', () => {
    const list = allGujaratiPhrases();
    expect(list.length).toBeGreaterThan(20);
    expect(new Set(list).size).toBe(list.length);
    expect(list.every((p) => /[઀-૿]/.test(p))).toBe(true);
  });
});

describe('docs/WHATSAPP_SUBMISSION.md', () => {
  const doc = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'docs',
      'WHATSAPP_SUBMISSION.md',
    ),
    'utf8',
  );
  it('lists every unreviewed Gujarati phrase of the table, and nothing the table does not have', () => {
    for (const phrase of allGujaratiPhrases()) expect(doc, phrase).toContain(`| ${phrase} |`);
    const rows = doc.split(String.fromCharCode(10)).filter((l) => /^\| [઀-૿]/.test(l));
    expect(rows).toHaveLength(allGujaratiPhrases().length);
  });
  it('shows the template body exactly as the code sends it, with the template name and language', () => {
    expect(doc).toContain(TEMPLATE_BODY_GU);
    expect(doc).toContain('vaaniehr_visit_summary_gu');
    expect(doc).toContain('code `gu`');
  });
});
