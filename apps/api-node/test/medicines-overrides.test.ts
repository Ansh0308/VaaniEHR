// The manual-transcription overrides file: what it accepts, what it refuses, and how it replaces parsed rows.
import { describe, expect, it } from 'vitest';
import { parseNlem } from '../src/medicines/nlemParser.js';
import {
  applyOverrides,
  OVERRIDE_NOTE_PHRASE,
  parseOverridesCsv,
} from '../src/medicines/overrides.js';
import { sampleDocument } from './nlemFixtures.js';

const head = 'generic_name,dose_form,strength,healthcare_levels,nlem_ref,source_page,note\r\n';
const parsed = () => parseNlem(sampleDocument(), { nlemYear: 2022 });

describe('overrides file', () => {
  it('accepts a complete row', () => {
    const { rows, errors } = parseOverridesCsv(
      `${head}Drug-A,Tablet,10 mg,"P,S,T",1.1.1,2,"${OVERRIDE_NOTE_PHRASE}"\r\n`,
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      genericName: 'Drug-A',
      doseForm: 'Tablet',
      strength: '10 mg',
      healthcareLevels: 'P,S,T',
      nlemRef: '1.1.1',
      sourcePage: 2,
    });
  });

  it('refuses a row whose note does not say it was manually transcribed and confirmed by the owner', () => {
    const r = parseOverridesCsv(`${head}Drug-A,Tablet,10 mg,P,1.1.1,2,typed from memory\r\n`);
    expect(r.errors.join(' ')).toContain(OVERRIDE_NOTE_PHRASE);
    expect(r.rows).toHaveLength(0);
  });

  it('refuses a missing page, a bad item number and an empty name', () => {
    const note = `"${OVERRIDE_NOTE_PHRASE}"`;
    expect(
      parseOverridesCsv(`${head}Drug-A,Tablet,10 mg,P,1.1.1,,${note}\r\n`).errors.join(' '),
    ).toContain('source_page');
    expect(
      parseOverridesCsv(`${head}Drug-A,Tablet,10 mg,P,banana,2,${note}\r\n`).errors.join(' '),
    ).toContain('item number');
    expect(
      parseOverridesCsv(`${head},Tablet,10 mg,P,1.1.1,2,${note}\r\n`).errors.join(' '),
    ).toContain('generic_name');
  });

  it('has no route, code or review columns: they are refused, not ignored', () => {
    for (const column of ['route', 'snomed_code', 'atc_code', 'reviewed_on', 'reviewed_by']) {
      const r = parseOverridesCsv(
        `generic_name,nlem_ref,source_page,note,${column}\r\nDrug-A,1.1.1,2,"${OVERRIDE_NOTE_PHRASE}",x\r\n`,
      );
      expect(r.errors.join(' '), column).toContain(`"${column}" is not allowed`);
    }
  });

  it('an empty file is not an error and changes nothing', () => {
    expect(parseOverridesCsv('')).toEqual({ rows: [], errors: [] });
  });
});

describe('applying overrides', () => {
  const category = (page: number, ref: string) =>
    parsed().entries.find((e) => e.page === page && e.ref === ref)?.category ?? null;

  it('replaces EVERY parsed row of an overridden item, so a wrongly read row cannot survive beside its correction', () => {
    const before = parsed().rows;
    expect(before.filter((r) => r.nlemRef === '1.1.1')).toHaveLength(2); // Tablet 10 mg and Injection 5 mg/mL
    const { rows } = parseOverridesCsv(
      `${head}Drug-A,Tablet,12 mg,"P,S,T",1.1.1,2,"${OVERRIDE_NOTE_PHRASE}"\r\n`,
    );
    const result = applyOverrides(before, rows, category, 2022);
    expect(result.replacedRows).toBe(2);
    expect(result.addedRows).toBe(1);
    expect(result.items).toEqual(['1.1.1']);
    const drugA = result.rows.filter((r) => r.genericName === 'Drug-A');
    expect(drugA.map((r) => r.strength)).toEqual(['12 mg']);
    // untouched items stay exactly as parsed
    expect(result.rows.filter((r) => r.nlemRef !== '1.1.1')).toEqual(
      before.filter((r) => r.nlemRef !== '1.1.1'),
    );
  });

  it('adds a transcribed row for an item the importer had held, with the note, the page and the item category; route and codes stay empty', () => {
    const { rows } = parseOverridesCsv(
      `${head}Drug-H,Injection,50 mg/vial,"S,T",1.1.9,2,"${OVERRIDE_NOTE_PHRASE}"\r\n`,
    );
    const result = applyOverrides(
      parsed().rows,
      rows,
      () => 'Fake Medicines Used in Testing',
      2022,
    );
    const added = result.rows.find((r) => r.genericName === 'Drug-H');
    expect(added).toMatchObject({
      sourcePage: 2,
      nlemRef: '1.1.9',
      nlemYear: 2022,
      route: null,
      sourceNotes: expect.stringContaining(OVERRIDE_NOTE_PHRASE),
      therapeuticCategory: 'Fake Medicines Used in Testing',
    });
    expect(result.replacedRows).toBe(0);
  });
});
