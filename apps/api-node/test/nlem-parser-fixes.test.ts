// Regression tests (fake names) for the Phase 3A fixes found by the spot-check and the systematic cell check:
// prefix lines, repeated page-header fragments, notes inside a cell, footnote text, levels per group of lines, notes of repeats.
import { describe, expect, it } from 'vitest';
import { parseNlem } from '../src/medicines/nlemParser.js';
import { footnote, item, page, rowItems, sectionHeader, tableHeader } from './nlemFixtures.js';

const parse = (...groups: Parameters<typeof page>[1][]) =>
  parseNlem([page(2, sectionHeader(1, 'Fake'), tableHeader(700), ...groups)], { nlemYear: 2022 });
const forms = (r: ReturnType<typeof parse>, generic: string) =>
  r.rows.filter((x) => x.genericName === generic).map((x) => `${x.doseForm} | ${x.strength}`);

describe('prefix lines attach to the dose-form lines that follow them', () => {
  it('"Modified Release -" gives "Modified Release Tablet" to the Tablet lines after it, and stops at the next form', () => {
    const r = parse(
      rowItems({
        ref: '1.1',
        y: 560,
        name: ['Drug-A'],
        level: 'P,S,T',
        forms: [
          'Tablet 100 mg',
          'Tablet 200 mg',
          'Modified Release -',
          'Tablet 200 mg',
          'Tablet 400 mg',
          'Oral liquid 100 mg/5 mL (p)',
        ],
      }),
    );
    expect(forms(r, 'Drug-A')).toEqual([
      'Tablet | 100 mg',
      'Tablet | 200 mg',
      'Modified Release Tablet | 200 mg',
      'Modified Release Tablet | 400 mg',
      'Oral liquid | 100 mg/5 mL',
    ]);
    // nothing is merged into another row of the same item, and no junk row is made from the prefix
    expect(r.cells.filter((c) => c.disposition === 'COLLAPSED_IN_ENTRY')).toHaveLength(0);
    expect(r.rows.some((x) => /-\s*$/.test(x.doseForm ?? ''))).toBe(false);
    expect(r.review.find((x) => x.ref === '1.1')?.reasons).toContain('PREFIX_LINES_ATTACHED');
    expect(r.review.find((x) => x.ref === '1.1')?.held).toBe(false);
    expect(r.cells.filter((c) => c.disposition === 'PREFIX_ATTACHED')).toHaveLength(1);
  });

  it('a "/" prefix that runs over two lines goes onto the next line with a number, once each time', () => {
    const r = parse(
      rowItems({
        ref: '1.1',
        y: 560,
        name: ['Drug-B'],
        level: 'P,S,T',
        forms: [
          'Conventional/Effervescent/',
          'Dispersible/ Enteric coated',
          'Tablets 150 mg',
          'Conventional/Effervescent/',
          'Dispersible/ Enteric coated',
          'Tablets 325 mg',
          'Enteric coated Tablet 75 mg',
        ],
      }),
    );
    expect(forms(r, 'Drug-B')).toEqual([
      'Conventional/Effervescent/ Dispersible/ Enteric coated Tablets | 150 mg',
      'Conventional/Effervescent/ Dispersible/ Enteric coated Tablets | 325 mg',
      'Enteric coated Tablet | 75 mg',
    ]);
  });

  it('a prefix followed by "As licensed" gives the form (the prefix) and the strength text "As licensed"', () => {
    const r = parse(
      rowItems({
        ref: '1.1',
        y: 560,
        name: ['Drug-C'],
        level: 'P,S,T',
        forms: [
          'Soluble/ liquid polyvalent -',
          'As licensed',
          'Lyophilized polyvalent -',
          'As licensed',
        ],
      }),
    );
    expect(forms(r, 'Drug-C')).toEqual([
      'Soluble/ liquid polyvalent | As licensed',
      'Lyophilized polyvalent | As licensed',
    ]);
  });

  it('an inline "Modified Release Tablet 750 mg" is unchanged', () => {
    const r = parse(
      rowItems({
        ref: '1.1',
        y: 560,
        name: ['Drug-D'],
        level: 'S,T',
        forms: ['Modified Release Tablet 750 mg'],
      }),
    );
    expect(forms(r, 'Drug-D')).toEqual(['Modified Release Tablet | 750 mg']);
  });

  it('a prefix with nothing after it is held, not turned into a row', () => {
    const r = parse(
      rowItems({
        ref: '1.1',
        y: 560,
        name: ['Drug-E'],
        level: 'S,T',
        forms: ['Tablet 5 mg', 'Modified Release -'],
      }),
    );
    expect(r.rows.filter((x) => x.genericName === 'Drug-E')).toHaveLength(0);
    expect(r.review.find((x) => x.ref === '1.1')?.held).toBe(true);
  });
});

describe('repeated page-header fragments are taken out of the cells', () => {
  it('"Dosage form( s) and strength(s)" split over three items is dropped; a real form with those words is kept', () => {
    const r = parse(
      rowItems({ ref: '1.1', y: 560, name: ['Drug-F'], level: 'S,T', forms: ['Tablet 10 mg'] }),
      [item('Dosage form(', 366, 200), item('s)', 447, 200), item('and strength(s)', 460, 200)],
      rowItems({
        ref: '1.2',
        y: 420,
        name: ['Drug-G'],
        level: 'S,T',
        forms: ['Oral Dosage forms 2 mg'],
      }),
    );
    expect(forms(r, 'Drug-F')).toEqual(['Tablet | 10 mg']);
    expect(forms(r, 'Drug-G')).toEqual(['Oral Dosage forms | 2 mg']);
    expect(r.stats.headerFragmentsDropped).toBe(1);
    expect(r.cells.filter((c) => c.defects.includes('HEADER_FRAGMENT'))).toHaveLength(0);
  });
});

describe('notes marked with # or * reach source_notes', () => {
  it('a "#" note inside the dose-form cell is a note, not a dose form', () => {
    const r = parse([
      item('6.1', 99, 400),
      item('#', 243, 407),
      item('Drug-H**', 158, 400),
      item('P,S,T', 288, 400),
      item('Capsule 100 mg', 366, 420),
      item('Oral liquid 50 mg/ 5mL', 366, 402),
      item('#', 366, 384),
      item('for prophylaxis of', 370, 379),
      item('P. vivax', 460, 379),
    ]);
    expect(forms(r, 'Drug-H')).toEqual(['Capsule | 100 mg', 'Oral liquid | 50 mg/ 5mL']);
    for (const row of r.rows.filter((x) => x.genericName === 'Drug-H'))
      expect(row.sourceNotes).toContain('table note: #for prophylaxis of P. vivax');
    expect(r.cells.filter((c) => c.disposition === 'NOTE').length).toBe(2);
  });

  it('the footnote paragraph of the marker beside the name goes into the notes of every row, verbatim', () => {
    const r = parseNlem(
      [
        page(
          2,
          sectionHeader(1, 'Fake'),
          tableHeader(700),
          rowItems({
            ref: '1.1',
            y: 560,
            name: ['Drug-I**'],
            level: 'S,T',
            forms: ['Tablet 1 mg', 'Tablet 2 mg'],
          }),
          footnote('Drug-I formulations are also listed in Section 9.9 -', 140, '**'),
          [item('Fake Heading', 112, 124)],
        ),
      ],
      { nlemYear: 2022 },
    );
    expect(r.footnotes).toEqual([
      {
        page: 2,
        marker: '**',
        text: 'Drug-I formulations are also listed in Section 9.9 - Fake Heading',
      },
    ]);
    for (const row of r.rows)
      expect(row.sourceNotes).toContain(
        'footnote **: Drug-I formulations are also listed in Section 9.9 - Fake Heading',
      );
  });

  it('a marker whose footnote is not on the page is recorded in the notes and listed for review', () => {
    const r = parse(
      rowItems({ ref: '1.1', y: 560, name: ['Drug-J*'], level: 'S,T', forms: ['Tablet 1 mg'] }),
    );
    expect(r.rows[0]?.sourceNotes).toContain(
      'footnote marker * beside the name; its text was not found on the page',
    );
    expect(r.review.find((x) => x.ref === '1.1')?.reasons).toContain('FOOTNOTE_NOT_FOUND');
  });

  it('when a later item repeats a formulation, its own footnote is added to the row an earlier item holds', () => {
    const r = parseNlem(
      [
        page(
          2,
          sectionHeader(1, 'First'),
          tableHeader(700),
          rowItems({ ref: '1.1', y: 560, name: ['Drug-K'], level: 'S,T', forms: ['Tablet 1 mg'] }),
          sectionHeader(2, 'Second', 480),
          tableHeader(430),
          rowItems({ ref: '2.1', y: 340, name: ['Drug-K*'], level: 'S,T', forms: ['Tablet 1 mg'] }),
          footnote('Drug-K formulations are also listed in Section 1.1', 140),
        ),
      ],
      { nlemYear: 2022 },
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.alsoListedIn).toEqual(['2.1']);
    expect(r.rows[0]?.sourceNotes).toContain(
      'footnote *: Drug-K formulations are also listed in Section 1.1',
    );
  });
});

describe('levels follow groups of lines, not the nearest level', () => {
  it('P,S,T covers the tablets and the oral liquid, S,T only the injection (the 5.1.10 layout)', () => {
    // no section header here: this page layout needs space between the title and the first rows
    const r = parseNlem(
      [
        page(
          2,
          tableHeader(700),
          rowItems({ ref: '1.0', y: 790, name: ['Drug-Z'], level: 'S,T', forms: ['Tablet 1 mg'] }),
          [
            item('1.1', 99, 584),
            item('Drug-L*', 158, 584),
            item('P,S,T', 288, 605),
            item('S,T', 288, 495),
            item('Tablet 200 mg', 366, 673),
            item('Tablet 300 mg', 366, 654),
            item('Tablet 500 mg', 366, 636),
            item('Modified Release -', 366, 605),
            item('Tablet 300 mg', 366, 587),
            item('Tablet 500 mg', 366, 568),
            item('Oral liquid 200 mg/5 mL (p)', 366, 538),
            item('Injection 100 mg/mL', 366, 495),
          ],
        ),
      ],
      { nlemYear: 2022 },
    );
    const levels = Object.fromEntries(
      r.rows
        .filter((x) => x.genericName === 'Drug-L')
        .map((x) => [`${x.doseForm} ${x.strength}`, x.healthcareLevels]),
    );
    expect(levels['Tablet 200 mg']).toBe('P,S,T');
    expect(levels['Modified Release Tablet 300 mg']).toBe('P,S,T');
    expect(levels['Oral liquid 200 mg/5 mL']).toBe('P,S,T'); // "nearest level" gave this one S,T
    expect(levels['Injection 100 mg/mL']).toBe('S,T');
  });
});

describe('every raw dose-form cell is accounted for', () => {
  it('a clean document has no unmapped cell, no merged cell, no unattached prefix and no header fragment', () => {
    const r = parse(
      rowItems({
        ref: '1.1',
        y: 560,
        name: ['Drug-M'],
        level: 'P,S,T',
        forms: ['Tablet 1 mg', 'Modified Release -', 'Tablet 2 mg'],
      }),
    );
    const bad = r.cells.filter(
      (c) =>
        c.disposition === 'COLLAPSED_IN_ENTRY' ||
        (c.disposition === 'HELD' && !r.review.some((x) => x.held)) ||
        (c.defects.includes('PREFIX_LINE') && c.disposition !== 'PREFIX_ATTACHED') ||
        c.defects.includes('HEADER_FRAGMENT'),
    );
    expect(bad).toEqual([]);
  });
});
