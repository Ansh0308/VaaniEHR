// CSV files of the NLEM import, the diff between two runs, and the licensed-code file format (no database, no PDF).
import { describe, expect, it } from 'vitest';
import { parseCodesCsv } from '../src/medicines/codes.js';
import { parseTranslitCsv } from '../src/medicines/translit.js';
import {
  diffRuns,
  medicinesToCsv,
  readCsv,
  readCsvObjects,
  rejectedToCsv,
  reviewToCsv,
} from '../src/medicines/nlemFiles.js';
import { parseNlem, type FormulationRow } from '../src/medicines/nlemParser.js';
import { sampleDocument } from './nlemFixtures.js';

const rows = (): FormulationRow[] => parseNlem(sampleDocument(), { nlemYear: 2022 }).rows;

describe('CSV reader and writer', () => {
  it('round-trips commas, quotes and line breaks', () => {
    const text = 'a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",plain\r\n';
    expect(readCsv(text)).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['line\nbreak', 'plain'],
    ]);
    expect(readCsvObjects(text)[1]).toEqual({ a: 'line\nbreak', b: 'plain' });
  });

  it('the medicine CSV has empty snomed, atc and review columns and a source on every row', () => {
    const records = readCsvObjects(medicinesToCsv(rows()));
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(r.snomed_code).toBe('');
      expect(r.atc_code).toBe('');
      expect(r.reviewed_on).toBe('');
      expect(r.reviewed_by).toBe('');
      expect(r.route).toBe('');
      expect(r.source).toContain('NLEM 2022');
      expect(r.source_page).not.toBe('');
    }
  });

  it('refuses to write a value that would need the spreadsheet-safety prefix, instead of changing it silently', () => {
    const bad = rows().map((r, i) => (i === 0 ? { ...r, genericName: '=cmd()' } : r));
    expect(() => medicinesToCsv(bad)).toThrow(/formula character/);
  });

  it('the review and rejected sheets say what happened to each row', () => {
    const r = parseNlem(sampleDocument(), { nlemYear: 2022 });
    const review = readCsvObjects(reviewToCsv(r.review));
    expect(review.some((x) => x.status === 'loaded with a note')).toBe(true);
    expect(readCsvObjects(rejectedToCsv(r.rejected))).toEqual([]);
  });
});

describe('diff between two runs', () => {
  const csv = medicinesToCsv(rows());
  it('is empty for identical runs', () => {
    expect(diffRuns(csv, csv)).toEqual({ added: [], removed: [], changed: [] });
  });
  it('reports added, removed and changed rows', () => {
    const [first, ...rest] = rows();
    const changed = { ...first, therapeuticCategory: 'Another Group' } as FormulationRow;
    const withoutOne = medicinesToCsv(rest);
    expect(diffRuns(csv, withoutOne).removed).toHaveLength(1);
    expect(diffRuns(withoutOne, csv).added).toHaveLength(1);
    const diff = diffRuns(csv, medicinesToCsv([changed, ...rest]));
    expect(diff.changed).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
  });
});

describe('licensed-code file (the loader never invents a code)', () => {
  const ok =
    'generic_name,dose_form,strength,snomed_code,atc_code,licence_note\r\nDrug-A,Tablet,10 mg,12345678,N02BE01,MLDS test licence\r\n';
  it('accepts a complete file', () => {
    const r = parseCodesCsv(ok);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      genericName: 'Drug-A',
      snomedCode: '12345678',
      atcCode: 'N02BE01',
    });
  });
  it('refuses a row with no licence note', () => {
    const r = parseCodesCsv(ok.replace('MLDS test licence', ''));
    expect(r.errors.join(' ')).toContain('licence_note is empty');
    expect(r.rows).toHaveLength(0);
  });
  it('refuses a file with no licence_note column, a bad SNOMED id and a bad ATC code', () => {
    expect(
      parseCodesCsv('generic_name,snomed_code\r\nDrug-A,12345678\r\n').errors.join(' '),
    ).toContain('missing column: licence_note');
    expect(parseCodesCsv(ok.replace('12345678', 'abc')).errors.join(' ')).toContain('snomed_code');
    expect(parseCodesCsv(ok.replace('N02BE01', 'xx')).errors.join(' ')).toContain('atc_code');
  });
  it('refuses a row that has no code at all', () => {
    expect(parseCodesCsv(ok.replace('12345678,N02BE01', ',')).errors.join(' ')).toContain(
      'no code on this row',
    );
  });
});

describe('Gujarati search list (nothing unreviewed reaches the live table)', () => {
  const head = 'gu_text,latin_text,source,reviewed_by,reviewed_on\r\n';
  it('accepts a row that names its reviewer and date', () => {
    const r = parseTranslitCsv(
      `${head}પેરાસીટામોલ,Paracetamol,reviewed list,Fake Reviewer,2026-10-01\r\n`,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      guText: 'પેરાસીટામોલ',
      latinText: 'Paracetamol',
      reviewedBy: 'Fake Reviewer',
    });
  });
  it('refuses a machine draft: no reviewer, no date, a bad date, no Gujarati letters, or the review columns missing', () => {
    expect(parseTranslitCsv(`${head}પેરા,Para,s,,2026-10-01\r\n`).errors.join(' ')).toContain(
      'not approved',
    );
    expect(parseTranslitCsv(`${head}પેરા,Para,s,Fake Reviewer,\r\n`).errors.join(' ')).toContain(
      'not approved',
    );
    expect(
      parseTranslitCsv(`${head}પેરા,Para,s,Fake Reviewer,01/10/2026\r\n`).errors.join(' '),
    ).toContain('not approved');
    expect(
      parseTranslitCsv(`${head}para,Para,s,Fake Reviewer,2026-10-01\r\n`).errors.join(' '),
    ).toContain('no Gujarati letters');
    expect(
      parseTranslitCsv('gu_text,latin_text,source\r\nપેરા,Para,s\r\n').errors.join(' '),
    ).toContain('missing column: reviewed_by');
  });
});
