// The NLEM parser on SYNTHETIC pages (no private PDF). Proves the rules: row per formulation, centred matching, wrap
// joining, never guessing (hold), repeats merged, annexes ignored, the alphabetical list read for reconciliation.
import { describe, expect, it } from 'vitest';
import { parseAlphabetical, parseNlem } from '../src/medicines/nlemParser.js';
import { cleanName, formulationKey, parseFormLine } from '../src/medicines/normalise.js';
import { formatReport, reconcile } from '../src/medicines/nlemReport.js';
import {
  alphabeticalPage,
  page,
  rowItems,
  sampleDocument,
  sectionHeader,
  tableHeader,
} from './nlemFixtures.js';

const parse = (pages = sampleDocument()) => parseNlem(pages, { nlemYear: 2022 });

describe('normalisation (it never rewrites a clinical value)', () => {
  it('splits dose form from strength at the first word that starts with a digit', () => {
    expect(parseFormLine('Injection 10 mg/mL')).toMatchObject({
      doseForm: 'Injection',
      strength: '10 mg/mL',
    });
    expect(parseFormLine('Powder for injection 0.5 g')).toMatchObject({
      doseForm: 'Powder for injection',
      strength: '0.5 g',
    });
    expect(parseFormLine('Tablet 500 mg (A) + 125 mg (B)')).toMatchObject({
      strength: '500 mg (A) + 125 mg (B)',
    });
  });
  it('keeps a form with no strength, and keeps "As licensed" as a note instead of inventing a form', () => {
    expect(parseFormLine('Liquid for inhalation')).toMatchObject({
      doseForm: 'Liquid for inhalation',
      strength: null,
    });
    expect(parseFormLine('As licensed for medical purpose')).toMatchObject({
      doseForm: null,
      strength: null,
      noteText: 'As licensed for medical purpose',
    });
  });
  it('reads the paediatric (p) flag without losing the strength', () => {
    expect(parseFormLine('Oral liquid 125 mg/5 mL (p)')).toMatchObject({
      strength: '125 mg/5 mL',
      paediatric: true,
    });
  });
  it('refuses lines it cannot split safely', () => {
    expect(parseFormLine('a) Drug-A (conventional) - Injection 50').problem).toBe(
      'lettered sub-list',
    );
    expect(parseFormLine('250 mg tablet').problem).toBe('starts with a number');
  });
  it('removes footnote stars and hashes from names but records them', () => {
    expect(cleanName('Oxygen*')).toEqual({ name: 'Oxygen', markers: '*', markerGroups: ['*'] });
    expect(cleanName('Co-trimoxazole* [A (A) + B (B)]').name).toBe(
      'Co-trimoxazole [A (A) + B (B)]',
    );
    expect(cleanName('# Drug-M').name).toBe('Drug-M');
    expect(cleanName('Drug-A (A) +Drug-B (B)').name).toBe('Drug-A (A) + Drug-B (B)');
  });
  it('the formulation key ignores case and treats NULL like empty, so a NULL route cannot duplicate', () => {
    const base = { genericName: 'Drug-A', doseForm: 'Tablet', strength: '10 mg', route: null };
    expect(formulationKey(base)).toBe(formulationKey({ ...base, genericName: 'DRUG-A' }));
    expect(formulationKey(base)).not.toBe(formulationKey({ ...base, strength: '20 mg' }));
  });
});

describe('table parsing', () => {
  it('makes one row per formulation, with category, page, item number and levels', () => {
    const r = parse();
    const a = r.rows.filter((x) => x.genericName === 'Drug-A');
    expect(a.map((x) => [x.doseForm, x.strength])).toEqual([
      ['Tablet', '10 mg'],
      ['Injection', '5 mg/mL'],
    ]);
    expect(a[0]).toMatchObject({
      therapeuticCategory: 'Fake Medicines Used in Testing > Fake Subgroup',
      nlemYear: 2022,
      nlemRef: '1.1.1',
      healthcareLevels: 'P,S,T',
      sourcePage: 2,
      route: null,
    });
  });

  it('never sets a route, a code or a review date (those are not in the source)', () => {
    for (const row of parse().rows) {
      expect(row.route).toBeNull();
      expect(Object.keys(row)).not.toContain('snomedCode');
      expect(Object.keys(row)).not.toContain('reviewedOn');
    }
  });

  it('lists rows with no strength for review but still loads them with a note', () => {
    const r = parse();
    const noteRow = r.rows.find((x) => x.genericName === 'Drug-C');
    expect(noteRow).toMatchObject({ doseForm: null, strength: null });
    expect(noteRow?.sourceNotes).toContain('source text: As licensed for medical purpose');
    const item = r.review.find((x) => x.name === 'Drug-C');
    expect(item?.reasons).toContain('NO_FORM_OR_STRENGTH');
    expect(item?.held).toBe(false);
    expect(r.rows.find((x) => x.genericName === 'Drug-B')?.sourceNotes).toContain(
      'footnote *: Drug-B formulations are also listed elsewhere.',
    );
  });

  it('skips front matter and ignores annexes after the alphabetical list', () => {
    const r = parse();
    expect(r.stats.pagesRead).toBe(1);
    expect(r.rows.some((x) => x.genericName === 'Drug-Z')).toBe(false);
    expect(r.rejected).toHaveLength(0);
  });

  it('matches cells that are not exactly centred (a 3-line cell with a 22 pt pitch) without dropping a line', () => {
    const odd = page(
      2,
      sectionHeader(1, 'Fake'),
      tableHeader(700),
      rowItems({ ref: '1.1', y: 600, name: ['Drug-A'], level: 'P,S,T', forms: [] }),
      // three lines, 22 pt apart, centre 8 pt below the number
      [
        { str: 'Tablet 1 mg', x: 366, y: 614, width: 50 },
        { str: 'Tablet 2 mg', x: 366, y: 592, width: 50 },
        { str: 'Tablet 3 mg', x: 366, y: 570, width: 50 },
      ],
      rowItems({ ref: '1.2', y: 500, name: ['Drug-B'], level: 'S,T', forms: ['Tablet 9 mg'] }),
    );
    const r = parse([odd]);
    expect(r.rows.filter((x) => x.genericName === 'Drug-A').map((x) => x.strength)).toEqual([
      '1 mg',
      '2 mg',
      '3 mg',
    ]);
    expect(r.rows.filter((x) => x.genericName === 'Drug-B').map((x) => x.strength)).toEqual([
      '9 mg',
    ]);
  });

  it('keeps every line with its own row when a row has sub-lists with big gaps (the page-15 layout that once stole a line)', () => {
    const item = (str: string, x: number, y: number) => ({ str, x, y, width: str.length * 5 });
    const doc = page(
      2,
      sectionHeader(1, 'Fake'),
      tableHeader(700),
      // a row above, as on the real page (a first row on a page can be mistaken for a continuation)
      rowItems({ ref: '1.0', y: 600, name: ['Drug-Z'], level: 'S,T', forms: ['Tablet 1 mg'] }),
      [
        // row A: three tablet lines, then (46 pt lower) one injection line, with two levels
        item('1.1', 99, 385),
        item('Drug-A', 158, 385),
        item('P,S,T', 288, 422),
        item('Tablet 30 mg', 366, 440),
        item('Tablet 60 mg', 366, 422),
        item('Oral liquid 20 mg/5 mL (p)', 366, 403),
        item('S,T', 288, 357),
        item('Injection 200 mg/mL', 366, 357),
        // row B: eight evenly spaced lines, one level, its number in the middle
        item('1.2', 99, 249),
        item('Drug-B', 158, 249),
        item('P,S,T', 288, 249),
        ...['50', '100', '300', '350', '400', '450', '500', '550'].map((mg, k) =>
          item(`Tablet ${mg} mg`, 366, 314 - k * 18.5),
        ),
      ],
    );
    const r = parse([doc]);
    expect(
      r.rows.filter((x) => x.genericName === 'Drug-A').map((x) => [x.strength, x.healthcareLevels]),
    ).toEqual([
      ['30 mg', 'P,S,T'],
      ['60 mg', 'P,S,T'],
      ['20 mg/5 mL', 'P,S,T'],
      ['200 mg/mL', 'S,T'],
    ]);
    expect(r.rows.filter((x) => x.genericName === 'Drug-B')).toHaveLength(8);
    expect(r.rows.find((x) => x.genericName === 'Drug-B')?.strength).toBe('50 mg');
    const reasons = r.review.flatMap((x) => (x.ref === '1.1' ? x.reasons : []));
    expect(reasons).toContain('MULTI_LEVEL');
    expect(reasons).toContain('UNUSUAL_LAYOUT'); // loaded, but a person is asked to glance at it
    expect(reasons).not.toContain('AMBIGUOUS_ROW'); // both methods agree
  });

  it('joins a wrapped form line back, only on strict cues, and counts it', () => {
    const wrapped = page(
      2,
      sectionHeader(1, 'Fake'),
      tableHeader(700),
      rowItems({
        ref: '1.1',
        y: 560,
        name: ['Drug-A (A) +', 'Drug-B (B)'],
        level: 'P,S,T',
        forms: [
          'Tablet 500 mg (A) + 125 mg',
          '(B)',
          'Oral liquid 200 mg (A) + 28.5',
          'mg (B)/5 mL (p)',
        ],
      }),
    );
    const r = parse([wrapped]);
    expect(r.rows.map((x) => x.strength)).toEqual([
      '500 mg (A) + 125 mg (B)',
      '200 mg (A) + 28.5 mg (B)/5 mL',
    ]);
    expect(r.rows[0]?.genericName).toBe('Drug-A (A) + Drug-B (B)');
    expect(r.rows[1]?.sourceNotes).toContain('paediatric');
    expect(r.stats.wrappedLinesJoined).toBe(2);
  });

  it('gives each form line the nearest level when a row carries two levels, and lists the row for review', () => {
    const two = page(2, sectionHeader(1, 'Fake'), tableHeader(700), [
      { str: '1.1', x: 99, y: 500, width: 20 },
      { str: 'Drug-A', x: 158, y: 500, width: 40 },
      { str: 'P,S,T', x: 288, y: 537, width: 20 },
      { str: 'S,T', x: 288, y: 463, width: 20 },
      { str: 'Tablet 1 mg', x: 366, y: 537, width: 50 },
      { str: 'Tablet 2 mg', x: 366, y: 518.5, width: 50 },
      { str: 'Injection 3 mg/mL', x: 366, y: 481.5, width: 50 },
      { str: 'Injection 4 mg/mL', x: 366, y: 463, width: 50 },
    ]);
    const r = parse([two]);
    expect(r.rows.map((x) => [x.strength, x.healthcareLevels])).toEqual([
      ['1 mg', 'P,S,T'],
      ['2 mg', 'P,S,T'],
      ['3 mg/mL', 'S,T'],
      ['4 mg/mL', 'S,T'],
    ]);
    expect(r.review.find((x) => x.ref === '1.1')?.reasons).toContain('MULTI_LEVEL');
  });

  it('merges the same formulation listed under two sections into ONE row and records the other item number', () => {
    const doc = [
      page(
        2,
        sectionHeader(1, 'First Fake Section'),
        tableHeader(700),
        rowItems({ ref: '1.1', y: 600, name: ['Drug-A'], level: 'P,S,T', forms: ['Tablet 10 mg'] }),
        sectionHeader(2, 'Second Fake Section', 480),
        tableHeader(430),
        rowItems({
          ref: '2.1',
          y: 340,
          name: ['Drug-A'],
          level: 'S,T',
          forms: ['Tablet 10 mg', 'Tablet 20 mg'],
        }),
      ),
    ];
    const r = parse(doc);
    expect(r.stats.numberedEntries).toBe(2);
    expect(r.stats.distinctGenerics).toBe(1);
    expect(r.stats.formulationLines).toBe(3);
    expect(r.rows).toHaveLength(2);
    const ten = r.rows.find((x) => x.strength === '10 mg');
    expect(ten?.nlemRef).toBe('1.1');
    expect(ten?.alsoListedIn).toEqual(['2.1']);
    expect(ten?.therapeuticCategory).toBe('First Fake Section');
    expect(r.review.find((x) => x.reasons.includes('LEVELS_DIFFER_ON_REPEAT'))).toBeTruthy(); // different level: flagged, not merged silently
    expect(r.repeats.extraEntries).toBe(1);
    expect(r.repeats.byListings).toEqual([{ listings: 2, generics: 1 }]);
  });

  it('treats a numbered line with numbered children and no forms as a category heading, not a medicine', () => {
    const doc = page(
      2,
      sectionHeader(1, 'Fake'),
      tableHeader(700),
      [
        { str: '1.2', x: 99, y: 620, width: 20 },
        { str: 'Fake Beta Group', x: 141, y: 620, width: 90 },
      ],
      rowItems({ ref: '1.2.1', y: 540, name: ['Drug-A'], level: 'P,S,T', forms: ['Tablet 10 mg'] }),
    );
    const r = parse([doc]);
    expect(r.stats.headings).toBe(1);
    expect(r.stats.numberedEntries).toBe(1);
    expect(r.rows[0]?.therapeuticCategory).toBe('Fake > Fake Beta Group');
  });
});

describe('holding instead of guessing', () => {
  it('holds a row with no dosage-form lines and reports its generic as not placed', () => {
    const doc = page(
      2,
      sectionHeader(1, 'Fake'),
      tableHeader(700),
      rowItems({ ref: '1.1', y: 600, name: ['Drug-A'], level: 'P,S,T', forms: [] }),
      rowItems({ ref: '1.2', y: 500, name: ['Drug-B'], level: 'S,T', forms: ['Tablet 10 mg'] }),
    );
    const r = parse([doc]);
    expect(r.rows.map((x) => x.genericName)).toEqual(['Drug-B']);
    expect(r.review.find((x) => x.ref === '1.1')).toMatchObject({
      held: true,
      reasons: expect.arrayContaining(['NO_FORM_LINES']),
    });
    expect(r.unplaced).toEqual(['Drug-A']);
  });

  it('holds a lettered sub-list (a) / (b) and keeps its raw text for the person checking', () => {
    const doc = page(
      2,
      sectionHeader(1, 'Fake'),
      tableHeader(700),
      rowItems({
        ref: '1.1',
        y: 600,
        name: ['Drug-A'],
        level: 'S,T',
        forms: [
          'a) Drug-A (plain) - Injection 50',
          'mg/vial',
          'b) Drug-A (lipid) - Injection 10 mg',
        ],
      }),
    );
    const r = parse([doc]);
    expect(r.rows).toHaveLength(0);
    const held = r.review.find((x) => x.ref === '1.1');
    expect(held?.held).toBe(true);
    expect(held?.rawText).toContain('b) Drug-A (lipid)');
  });

  it('holds a row that continues onto the next page, and the lines that continue it', () => {
    const doc = [
      page(
        2,
        sectionHeader(1, 'Fake'),
        tableHeader(700),
        rowItems({ ref: '1.1', y: 600, name: ['Drug-A'], level: 'P,S,T', forms: ['Tablet 10 mg'] }),
        // last row on the page: its forms are cut off at the bottom of the page
        [
          { str: '1.2', x: 99, y: 130, width: 20 },
          { str: 'Drug-B', x: 158, y: 130, width: 40 },
          { str: 'S,T', x: 288, y: 130, width: 20 },
          { str: 'Tablet 5 mg', x: 366, y: 150, width: 50 },
          { str: 'Tablet 6 mg', x: 366, y: 131.5, width: 50 },
        ],
      ),
      page(
        3,
        tableHeader(740),
        [{ str: 'Tablet 7 mg', x: 366, y: 700, width: 50 }],
        rowItems({ ref: '1.3', y: 560, name: ['Drug-C'], level: 'P,S,T', forms: ['Tablet 1 mg'] }),
      ),
    ];
    const r = parse(doc);
    const held = r.review.find((x) => x.ref === '1.2');
    expect(held?.held).toBe(true);
    expect(held?.rawText).toContain('Tablet 7 mg');
    // only the row that is split is held; the row after it is read from its own cells and loads normally
    expect(r.review.filter((x) => x.held).map((x) => x.ref)).toEqual(['1.2']);
    expect(held?.rawText).toContain('Tablet 5 mg');
    expect(held?.rawText).toContain('Tablet 6 mg');
    expect(r.rows.map((x) => x.genericName)).toEqual(['Drug-A', 'Drug-C']);
  });

  it('holds a row on which the two independent methods disagree, and shows the extra line to the person checking', () => {
    // the file's own order puts "Tablet 99 mg" with row 1.1, but on the page it sits far from that row's number
    const doc = page(
      2,
      sectionHeader(1, 'Fake'),
      tableHeader(700),
      rowItems({ ref: '1.1', y: 600, name: ['Drug-A'], level: 'P,S,T', forms: ['Tablet 10 mg'] }),
      [{ str: 'Tablet 99 mg', x: 366, y: 560, width: 50 }],
      rowItems({ ref: '1.2', y: 450, name: ['Drug-B'], level: 'S,T', forms: ['Tablet 5 mg'] }),
    );
    const r = parse([doc]);
    const held = r.review.find((x) => x.ref === '1.1');
    expect(held?.held).toBe(true);
    expect(held?.rawText).toContain('Tablet 99 mg');
    expect(r.rows.map((x) => x.genericName)).toEqual(['Drug-B']); // the other row agrees under both methods and loads
  });

  it('holds the rows beside a paragraph of notes in the margin', () => {
    const doc = page(
      2,
      sectionHeader(1, 'Fake'),
      tableHeader(700),
      rowItems({ ref: '1.1', y: 600, name: ['Drug-A'], level: 'P,S,T', forms: ['Tablet 10 mg'] }),
      [
        {
          str: 'All forms of the following as approved by licensing authority are considered',
          x: 99,
          y: 560,
          width: 300,
        },
      ],
    );
    expect(parse([doc]).review.find((x) => x.ref === '1.1')?.held).toBe(true);
  });
});

describe("the publication's own numbered list, and the reconciliation report", () => {
  it('reads the alphabetical list with its numbers and finds gaps', () => {
    const list = parseAlphabetical([
      alphabeticalPage(5, [
        [1, 'Drug-A'],
        [2, 'Drug-B*'],
        [4, 'Drug-D'],
      ]),
    ]);
    expect(list.highest).toBe(4);
    expect(list.missing).toEqual([3]);
    expect(list.names.map((n) => n.name)).toEqual(['Drug-A', 'Drug-B', 'Drug-D']);
    expect(list.firstPage).toBe(5);
  });

  it('the table of contents line (with dots) is not mistaken for the list title', () => {
    expect(parseAlphabetical(sampleDocument().slice(0, 1)).firstPage).toBeNull();
  });

  it('reconciles by name ignoring case, spacing, stars and brackets, and lists both sides of every difference', () => {
    const rec = reconcile(
      ['Drug-A', 'Drug-B (X)', 'Drug-Only-Table'],
      [
        { no: 1, name: 'DRUG-A' },
        { no: 2, name: 'Drug-B(X)*' },
        { no: 3, name: 'Drug-Only-List' },
      ],
    );
    expect(rec.matched).toBe(2);
    expect(rec.onlyInTables).toEqual(['Drug-Only-Table']);
    expect(rec.onlyInAlphabetical).toEqual(['3. Drug-Only-List']);
  });

  it('the report shows every count separately, the discrepancy note with page references, and the unplaced generics', () => {
    const r = parse();
    const text = formatReport({
      pdfFile: 'x.pdf',
      pdfPages: 4,
      result: r,
      diff: null,
      load: null,
      files: ['a.csv'],
    });
    for (const label of [
      'numbered medicine entries',
      'formulation lines',
      'formulation ROWS after removing repeats',
      'distinct generic names',
      'rejected',
      'flagged for review',
    ])
      expect(text).toContain(label);
    expect(text).toContain('Why 3 numbered entries reduce to 3 distinct names');
    expect(text).toContain('PDF page 9');
    expect(text).toContain('PDF page 14');
    expect(text).toContain('PDF page 65');
    expect(text).toContain('386');
    expect(text).toContain('Generics that could not be placed');
    expect(text).toContain('first run');
  });
});
