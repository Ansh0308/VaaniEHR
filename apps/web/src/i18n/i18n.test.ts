// i18n guards: English and Gujarati have identical keys and placeholders, and every key the code uses exists.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import commonEn from './locales/en/common.json';
import commonGu from './locales/gu/common.json';
import clinicalEn from './locales/en/clinical.json';
import clinicalGu from './locales/gu/clinical.json';
import designEn from './locales/en/design.json';
import designGu from './locales/gu/design.json';
import shellEn from './locales/en/shell.json';
import shellGu from './locales/gu/shell.json';

type Tree = { [key: string]: string | Tree };

const RESOURCES: Record<string, { en: Tree; gu: Tree }> = {
  common: { en: commonEn, gu: commonGu },
  shell: { en: shellEn, gu: shellGu },
  design: { en: designEn, gu: designGu },
  clinical: { en: clinicalEn, gu: clinicalGu },
};

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'locales' ? [] : sourceFiles(full);
    return /\.(tsx?|ts)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe('locale parity', () => {
  for (const [ns, { en, gu }] of Object.entries(RESOURCES)) {
    const flatEn = flatten(en);
    const flatGu = flatten(gu);

    it(`${ns}: English and Gujarati have the same keys`, () => {
      expect(Object.keys(flatGu).sort()).toEqual(Object.keys(flatEn).sort());
    });

    it(`${ns}: placeholders match and no value is empty`, () => {
      for (const [key, value] of Object.entries(flatEn)) {
        expect(value.trim(), `${ns}:${key} (en) is empty`).not.toBe('');
        expect(flatGu[key]?.trim(), `${ns}:${key} (gu) is empty`).toBeTruthy();
        expect(placeholders(flatGu[key] ?? ''), `${ns}:${key} placeholders`).toEqual(
          placeholders(value),
        );
      }
    });
  }
});

describe('key usage', () => {
  const known = new Set(
    Object.entries(RESOURCES).flatMap(([ns, { en }]) =>
      Object.keys(flatten(en)).map((k) => `${ns}:${k}`),
    ),
  );
  const files = sourceFiles(join(__dirname, '..'));

  it('every statically referenced key exists', () => {
    const pattern = /\b(?:t|en|gu)\(\s*['"]([a-zA-Z]+:)?([\w.]+)['"]/g;
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(pattern)) {
        const id = `${(m[1] ?? 'common:').slice(0, -1)}:${m[2]}`;
        if (!known.has(id)) missing.push(`${id} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every dynamic key family is complete', () => {
    const states = ['clear', 'acknowledge', 'blocked', 'unconfirmed', 'ai'];
    const need = [
      ...states.flatMap((s) => [`common:state.${s}.label`, `common:state.${s}.desc`]),
      ...states.map((s) => `design:states.examples.${s}`),
      ...['idle', 'recording', 'paused', 'processing', 'error'].map(
        (s) => `clinical:record.state.${s}`,
      ),
      ...['doctor', 'patient'].map((s) => `clinical:transcript.speaker.${s}`),
      ...['audio', 'aiProcessing', 'whatsapp'].flatMap((s) => [
        `clinical:consent.scope.${s}.label`,
        `clinical:consent.scope.${s}.desc`,
      ]),
      ...['doctor', 'staff', 'admin', 'researcher'].map((r) => `shell:role.${r}`),
      ...['completed', 'current', 'upcoming'].map((s) => `common:stepper.${s}`),
    ];
    expect(need.filter((id) => !known.has(id))).toEqual([]);
  });
});
