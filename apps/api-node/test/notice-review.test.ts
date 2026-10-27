// docs/NOTICE_REVIEW.md must list exactly the Gujarati strings of the product (Phase 12B Run 2). Regenerate with
// `npx tsx scripts/notice-review.mjs` and format it when this fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import gu from '../src/consent/notices/v0.1/gu.json' with { type: 'json' };
import { allGujaratiPhrases } from '../src/whatsapp/phrases.js';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const doc = read('../../../docs/NOTICE_REVIEW.md');
const flat = doc.replaceAll('\|', '|').replaceAll(/\s+/g, ' ');
const has = (text: string) => flat.includes(text.replaceAll(/\s+/g, ' '));

describe('the Gujarati notice review checklist', () => {
  it('lists every WhatsApp phrase', () => {
    for (const phrase of allGujaratiPhrases()) expect(has(phrase), phrase).toBe(true);
  });
  it('lists the whole consent notice, title, body and all three scopes', () => {
    expect(has(gu.title)).toBe(true);
    expect(has(gu.body)).toBe(true);
    for (const scope of Object.values(gu.scopes)) {
      expect(has(scope.label), scope.label).toBe(true);
      expect(has(scope.description), scope.description).toBe(true);
    }
  });
  it('lists the erasure page notice and carries the to-be-confirmed line in both languages', () => {
    const privacy = JSON.parse(read('../../web/src/i18n/locales/gu/privacy.json')) as {
      rules: { open: string };
    };
    expect(has(privacy.rules.open)).toBe(true);
    expect(doc).toMatch(/To be confirmed: whether a signed clinical record must be kept/);
  });
  it('has a sign-off table and says that the legal wording is for the guide / institution', () => {
    expect(doc).toMatch(/## Sign-off/);
    expect(doc).toMatch(/to be checked by my guide \/ institution/);
    expect(doc).toMatch(/UNREVIEWED/);
  });
});
