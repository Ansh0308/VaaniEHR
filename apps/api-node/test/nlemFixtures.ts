// SYNTHETIC pages in the layout of the NLEM 2022 tables (item number, medicine, level, forms), with made-up drug names.
// Tests never read the real PDF: it is private (ADR-D18) and absent in CI.
import type { PageItems, TextItem } from '../src/medicines/nlemParser.js';

const X = { ref: 99, name: 158, level: 288, forms: 366 };
const PITCH = 18.5;

const item = (str: string, x: number, y: number): TextItem => ({
  str,
  x,
  y,
  width: str.length * 5,
});

export interface RowSpec {
  ref: string;
  /** vertical position of the item number */
  y: number;
  name: string[];
  level: string;
  forms: string[];
}

/** A row's lines are centred on its item number, like the real tables. */
const centred = (lines: string[], y: number, x: number): TextItem[] =>
  lines.map((text, i) => item(text, x, y + ((lines.length - 1) / 2 - i) * PITCH));

export function rowItems(r: RowSpec): TextItem[] {
  return [
    item(r.ref, X.ref, r.y),
    ...centred(r.name, r.y, X.name),
    ...(r.level ? [item(r.level, X.level, r.y)] : []),
    ...centred(r.forms, r.y, X.forms),
  ];
}

export const tableHeader = (y: number): TextItem[] => [
  item('Medicine', 163, y),
  item('Level of', X.level, y + 9),
  item('Healthcare', X.level, y - 9),
  item('Dosage form(s) and strength(s)', X.forms, y),
];

export const sectionHeader = (no: number, title: string, y = 720): TextItem[] => [
  item(`Section ${no}`, 295, y),
  item(title, 223, y - 21),
];

export const subsectionHeader = (text: string, y: number): TextItem[] => [item(text, X.ref, y)];

export const footnote = (text: string, y = 110): TextItem[] => [
  item('*', X.ref, y),
  item(text, 112, y),
];

export function page(n: number, ...groups: TextItem[][]): PageItems {
  return { page: n, items: groups.flat() };
}

/** The alphabetical list page: "<n>." at x=92 and the name at x=122, under the exact title. */
export function alphabeticalPage(n: number, names: Array<[number, string]>): PageItems {
  return {
    page: n,
    items: [
      item('Alphabetical List of Medicines in NLEM 2022', 158, 733),
      ...names.flatMap(([no, name], i) => [
        item(`${no}.`, 92, 688 - i * 24),
        item(name, 122, 688 - i * 24),
      ]),
    ],
  };
}

/** A small, clean document: front matter, one table page with three rows, the alphabetical list, an annex. */
export function sampleDocument(): PageItems[] {
  return [
    page(1, [
      item('Table of Contents', 200, 700),
      item('Alphabetical List of Medicines in NLEM 2022 ..... 4', 99, 600),
    ]),
    page(
      2,
      sectionHeader(1, 'Fake Medicines Used in Testing'),
      subsectionHeader('1.1- Fake Subgroup', 664),
      tableHeader(633),
      rowItems({
        ref: '1.1.1',
        y: 548,
        name: ['Drug-A'],
        level: 'P,S,T',
        forms: ['Tablet 10 mg', 'Injection 5 mg/mL'],
      }),
      rowItems({
        ref: '1.1.2',
        y: 450,
        name: ['Drug-B*'],
        level: 'S,T',
        forms: ['Liquid for inhalation'],
      }),
      rowItems({
        ref: '1.1.3',
        y: 352,
        name: ['Drug-C'],
        level: 'P,S,T',
        forms: ['As licensed for medical purpose'],
      }),
      footnote('Drug-B formulations are also listed elsewhere.'),
    ),
    alphabeticalPage(3, [
      [1, 'Drug-A'],
      [2, 'Drug-B*'],
      [3, 'Drug-C'],
    ]),
    // an annex after the alphabetical list: must NOT be read as the list
    page(
      4,
      [item('Medicines Added Therapeutic category wise in NLEM 2022', 100, 740)],
      rowItems({ ref: '1.1.1', y: 548, name: ['Drug-Z'], level: 'T', forms: ['Tablet 1 mg'] }),
    ),
  ];
}
