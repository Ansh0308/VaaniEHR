// NLEM 2022 table parser (FR-F5-01). A PURE function: positioned text items in, rows and a review list out. It never
// reads the PDF itself (see pdfItems.ts), so tests feed it synthetic items and the private PDF is never needed.
//
// PRIMARY METHOD: pdf.js hands the text over in the file's own content-stream order, and this PDF writes every row's cells
// together (number, name, level, forms) before the next number. So everything between two item numbers belongs to the
// first. The geometric matcher described next is kept as an INDEPENDENT CROSS-CHECK: a row on which the two methods
// disagree is held for a person.
//
// The NLEM tables have four columns: item number ("1.1.3"), medicine, level of healthcare ("P,S,T") and one or more
// "dosage form + strength" lines. The text of a row is vertically CENTRED on its item number, and every line in a cell
// is the same distance from the next, so wrapped lines look exactly like separate lines, and the gap inside one row
// (between "Tablet" lines and "Oral liquid" lines) can be as large as the gap between two rows. The parser therefore:
//   1. cuts the name and form columns into one run of lines per item number, top to bottom (see matchRuns): a run is
//      accepted only if it is centred on its number and contains no other number. A row that fits no run is held;
//   2. matches each level item ("P,S,T") to the row whose lines surround it (a row can carry two levels, one per group
//      of forms; each form line then takes the nearest level and the row is listed for review);
//   3. joins a wrapped form line back onto the line before it only on strict cues (it starts in lower case, with a
//      digit, "+" or "(", or the line before ends with "+"), and counts how many it joined.
//
// RULE: never guess. Anything the parser is not sure about is HELD (no row is made; it goes to the review list) or, for
// harmless facts such as "no strength is stated", loaded with a note and listed for a human to glance at.
import {
  cleanName,
  distinctKey,
  formulationKey,
  normaliseSpaces,
  parseFormLine,
  type ParsedForm,
} from './normalise.js';

export interface TextItem {
  str: string;
  /** Left edge in PDF points. */
  x: number;
  /** Baseline height in PDF points (larger = higher on the page). */
  y: number;
  width: number;
}
export interface PageItems {
  page: number;
  items: TextItem[];
}

export interface FormulationRow {
  genericName: string;
  doseForm: string | null;
  strength: string | null;
  /** Always null in Phase 3A: the NLEM does not state a route; the prescribing doctor chooses it. TODO(source): OCI-001 */
  route: null;
  therapeuticCategory: string | null;
  nlemYear: number;
  nlemRef: string;
  healthcareLevels: string | null;
  sourcePage: number;
  sourceNotes: string | null;
  alsoListedIn: string[];
}

export type ReviewReason =
  | 'AMBIGUOUS_ROW'
  | 'NO_FORM_LINES'
  | 'UNPARSED_FORM_LINE'
  | 'CONTINUED_FROM_PREVIOUS_PAGE'
  | 'CONTINUES_ON_NEXT_PAGE'
  | 'NO_STRENGTH_STATED'
  | 'NO_FORM_OR_STRENGTH'
  | 'ODD_LEVEL'
  | 'LEVELS_DIFFER_ON_REPEAT'
  | 'PREFIX_LINES_ATTACHED'
  | 'FOOTNOTE_NOT_FOUND'
  | 'MULTI_LEVEL'
  | 'UNUSUAL_LAYOUT'
  | 'NO_LEVEL';

/** Reasons that stop a row being loaded until a person has looked at it. */
export const HOLD_REASONS: ReadonlySet<ReviewReason> = new Set([
  'AMBIGUOUS_ROW',
  'NO_FORM_LINES',
  'UNPARSED_FORM_LINE',
  'CONTINUED_FROM_PREVIOUS_PAGE',
  'CONTINUES_ON_NEXT_PAGE',
]);

/** One line of a row's cells exactly as the PDF holds it (y = height on the page, larger = higher). */
export interface RawLine {
  column: 'name' | 'level' | 'form';
  y: number;
  text: string;
}

export interface ReviewItem {
  page: number;
  ref: string;
  name: string;
  /** The text as extracted (name, level and form lines), for the person checking it. */
  rawText: string;
  /** The same text line by line, in the order the PDF holds it, with each line's column and height. */
  rawLines: RawLine[];
  /** Where the geometric cross-check would have put the lines, when it disagreed with the reading above. */
  geometryReading?: { name: string; forms: string[] };
  reasons: ReviewReason[];
  /** true = no row was made from it (it is not loaded). */
  held: boolean;
  /** Set by the importer when a manual transcription replaced this item. */
  resolvedBy?: 'override';
}
export interface Rejected {
  page: number;
  ref: string | null;
  reason: string;
  rawText: string;
}

export interface ParsedEntry {
  page: number;
  ref: string;
  name: string;
  category: string | null;
  formLines: string[];
  /** The dose-form lines as they were read (form, strength, level), one per formulation line. */
  parsedLines: Array<{ doseForm: string | null; strength: string | null; level: string | null }>;
  /** The row's cells as the PDF holds them, line by line (for spot-checks). */
  rawLines: RawLine[];
  /** How the row's text sat against its item number: how far off-centre, and how many large gaps inside it. */
  fit: { offset: number; gaps: number };
}

export interface Footnote {
  page: number;
  marker: string;
  text: string;
}

/** Where one raw dose-form cell of the PDF ended up. Every cell must end in exactly one of these. */
export type CellDisposition =
  | 'LOADED' // became (or merged into another item's identical) loaded row
  | 'WRAP_JOINED' // the continuation of a wrapped line, joined to the cell before it
  | 'NOTE' // a note inside the cell (starts with # or *): goes to source_notes, not to a row
  | 'PREFIX_ATTACHED' // a prefix cell ("Modified Release -") attached to the dose-form lines after it
  | 'HELD' // its item is held and listed for a person
  | 'COLLAPSED_IN_ENTRY'; // merged into a row of the SAME item: two cells of one item became one row (a defect)
export type CellDefect = 'PREFIX_LINE' | 'HEADER_FRAGMENT';
export interface CellRecord {
  page: number;
  ref: string;
  text: string;
  disposition: CellDisposition;
  defects: CellDefect[];
}

export interface ParseResult {
  entries: ParsedEntry[];
  /** Unique formulation rows, ready to load. */
  rows: FormulationRow[];
  review: ReviewItem[];
  rejected: Rejected[];
  stats: {
    /** Every item number found in the tables (medicines plus numbered category headings). */
    numberedLines: number;
    /** Numbered lines that are category headings with numbered children (6.2.1 Beta-lactam Medicines). */
    headings: number;
    /** Numbered lines that are medicines. */
    numberedEntries: number;
    /** Wrapped form lines that were joined back into one. */
    wrappedLinesJoined: number;
    pagesRead: number;
    pagesSkipped: number;
    /** Form lines that became a row before removing repeats. */
    formulationLines: number;
    formulationRows: number;
    distinctGenerics: number;
    rejected: number;
    flagged: number;
    flaggedHeld: number;
    /** Repeated table-header fragments ("Dosage form( s) and strength(s)") taken out of the cells. */
    headerFragmentsDropped: number;
  };
  /** Why the numbered entries reduce to fewer distinct names. */
  repeats: {
    extraEntries: number;
    byListings: Array<{ listings: number; generics: number }>;
    mostRepeated: Array<{ name: string; listings: number; refs: string[] }>;
  };
  /** Generic names that appear in the PDF but have no loaded row (all their entries were held or rejected). */
  unplaced: string[];
  /** One record per raw dose-form cell of every item (for the systematic check). */
  cells: CellRecord[];
  /** The footnote paragraphs at the foot of each table page, keyed by their marker ("*", "**", "#" ...). */
  footnotes: Footnote[];
  /** The publication's own numbered "Alphabetical List of Medicines": the official count, for reconciliation. */
  alphabetical: {
    names: Array<{ no: number; name: string }>;
    highest: number;
    missing: number[];
    firstPage: number | null;
  };
}

export interface ParserOptions {
  nlemYear: number;
  /** Column boundaries in PDF points. The defaults fit the NLEM 2022 PDF. */
  columns?: { refMax: number; nameMax: number; levelMax: number };
  /** How far (points) the vertical centre of a cell may sit from its item number. */
  centreTolerance?: number;
}

const DEFAULT_COLUMNS = { refMax: 135, nameMax: 280, levelMax: 352 };
const REF = /^\d{1,2}(?:\.\d{1,3}){1,4}$/;
const SECTION = /^Section\s+(\d{1,2})$/;
/** "1.1- General Anaesthetics", "Section 5.1-Anticonvulsants", "4.2 Specific": a sub-section heading with text. */
const SUBSECTION = /^(?:Section\s+)?(\d{1,2}(?:\.\d{1,3})+)\s*-?\s*(\S.*)$/;
const HEADER_TEXT =
  /^(?:Medicine|Level of|Healthcare|Dosage form\(\s*s\)(?:\s*and)?(?:\s*strength\(\s*s\))?|strength\(\s*s\))$/i;
const LEVEL = /^[PST](?:,[PST])*$/;

interface Line {
  y: number;
  text: string;
}

/** Items on (almost) the same height become one line, left to right. */
function toLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; parts: TextItem[] }> = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) <= 2.5) last.parts.push(item);
    else lines.push({ y: item.y, parts: [item] });
  }
  return lines.map((l) => ({
    y: l.y,
    text: normaliseSpaces(
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(' '),
    ),
  }));
}

/**
 * Splits the lines of one column into consecutive runs, one per item number, from top to bottom, by dynamic programming
 * over the whole page (a greedy choice drops the last line of a cell that is not exactly centred).
 *   - a run is allowed for a number when its vertical centre is within `tolerance` of the number and no OTHER number lies
 *     inside the run; its cost is how far off-centre it is;
 *   - a number may take no run (cost EMPTY) and a line may be skipped (cost SKIP, an "orphan"), so one bad row cannot
 *     shift every row after it; the total is minimised;
 *   - lines skipped before the FIRST number are cheap and returned as `leading` when `allowLeading` is set: they
 *     continue a row from the previous page.
 */
const SKIP_COST = 40;
const EMPTY_COST = 60;
const LEADING_COST = 3;
/** A big gap INSIDE one run is unusual (sub-lists of one row do it, but so do two rows): it costs a little. */
const GAP_COST = 6;
const BIG_GAP = 30;

function matchRuns(
  lines: Line[],
  refYs: number[],
  tolerance: number,
  allowLeading: boolean,
): { runs: Array<Line[] | null>; leading: Line[]; orphans: Line[] } {
  const R = refYs.length;
  const L = lines.length;
  type Step =
    | { kind: 'start' }
    | { kind: 'skip'; i: number; j: number }
    | { kind: 'empty'; i: number; j: number }
    | { kind: 'run'; i: number; j: number };
  const cost: number[][] = Array.from({ length: R + 1 }, () => Array<number>(L + 1).fill(Infinity));
  const from: Step[][] = Array.from({ length: R + 1 }, () =>
    Array.from({ length: L + 1 }, (): Step => ({ kind: 'start' })),
  );
  const set = (i: number, j: number, c: number, step: Step) => {
    const row = cost[i];
    const back = from[i];
    if (row && back && c < (row[j] ?? Infinity)) {
      row[j] = c;
      back[j] = step;
    }
  };
  set(0, 0, 0, { kind: 'start' });
  for (let i = 0; i <= R; i += 1) {
    for (let j = 0; j <= L; j += 1) {
      const here = cost[i]?.[j] ?? Infinity;
      if (here === Infinity) continue;
      if (j < L) {
        const leading = i === 0 && allowLeading && j === (L === 0 ? 0 : j);
        set(i, j + 1, here + (leading ? LEADING_COST : SKIP_COST), { kind: 'skip', i, j });
      }
      if (i === R) continue;
      const refY = refYs[i] ?? 0;
      set(i + 1, j, here + EMPTY_COST, { kind: 'empty', i, j });
      const others = refYs.filter((_, k) => k !== i);
      for (let end = j + 1; end <= L; end += 1) {
        const top = lines[j]?.y ?? 0;
        const bottom = lines[end - 1]?.y ?? 0;
        if (others.some((o) => o <= top + 3 && o >= bottom - 3)) break; // would swallow another number
        const d = Math.abs((top + bottom) / 2 - refY);
        let gaps = 0;
        for (let k = j + 1; k < end; k += 1)
          if ((lines[k - 1]?.y ?? 0) - (lines[k]?.y ?? 0) > BIG_GAP) gaps += 1;
        if (d <= tolerance) set(i + 1, end, here + d + gaps * GAP_COST, { kind: 'run', i, j });
      }
    }
  }
  // backtrack from the cheapest way to have handled every number
  let j = L;
  let i = R;
  const runs: Array<Line[] | null> = Array<Line[] | null>(R).fill(null);
  const skippedAt: number[] = [];
  const bounds: Array<[number, number]> = [];
  while (i > 0 || j > 0) {
    const step = from[i]?.[j];
    if (!step || step.kind === 'start') break;
    if (step.kind === 'skip') skippedAt.push(step.j);
    else if (step.kind === 'run') {
      runs[step.i] = lines.slice(step.j, j);
      bounds.push([step.j, j]);
    }
    i = step.i;
    j = step.j;
  }
  const taken = new Set<number>();
  for (const [from0, to] of bounds) for (let k = from0; k < to; k += 1) taken.add(k);
  const firstStart = Math.min(...runs.flatMap((r) => (r && r[0] ? [lines.indexOf(r[0])] : [])), L);
  const leading: Line[] = [];
  const orphans: Line[] = [];
  lines.forEach((line, k) => {
    if (taken.has(k)) return;
    if (allowLeading && k < firstStart) leading.push(line);
    else orphans.push(line);
  });
  return { runs, leading, orphans };
}

function fitOf(run: Line[], refY: number): { offset: number; gaps: number } {
  if (run.length === 0) return { offset: 0, gaps: 0 };
  const top = run[0]?.y ?? refY;
  const bottom = run[run.length - 1]?.y ?? refY;
  let gaps = 0;
  for (let k = 1; k < run.length; k += 1)
    if ((run[k - 1]?.y ?? 0) - (run[k]?.y ?? 0) > BIG_GAP) gaps += 1;
  return { offset: Math.abs((top + bottom) / 2 - refY), gaps };
}

interface Context {
  section: string | null;
  subsection: string | null;
}

type Event =
  | { kind: 'section'; y: number; title: string }
  | { kind: 'subsection'; y: number; title: string }
  | { kind: 'ref'; y: number; ref: string };

interface Raw {
  page: number;
  ref: string;
  y: number;
  name: string;
  nameLines: Line[];
  levels: Array<{ y: number; text: string }>;
  forms: Line[];
  /** What the geometric cross-check read for this row, kept when it disagreed. */
  geometry?: { name: string; forms: string[] };
  context: Context;
  reasons: Set<ReviewReason>;
  /** Vertical extent of the row's own text (names and forms), used to place level items. */
  top: number;
  bottom: number;
  fit: { offset: number; gaps: number };
}

// exact title (the table of contents on page 3 has a longer line with dots and a page number)
const ALPHA_TITLE = /^Alphabetical List of Medicines in NLEM 2022$/i;

/** The numbered alphabetical list ("279." then the name). Pages before it hold the tables; pages after it are annexes. */
export function parseAlphabetical(pages: PageItems[]): ParseResult['alphabetical'] {
  const names: Array<{ no: number; name: string }> = [];
  let firstPage: number | null = null;
  for (const { page, items } of pages) {
    if (!items.some((i) => ALPHA_TITLE.test(i.str.trim()))) continue;
    firstPage ??= page;
    const numbers = items.filter((i) => /^\d{1,3}\.$/.test(i.str.trim()) && i.x < 120);
    for (const n of numbers) {
      const nameItems = items.filter(
        (i) => i.x >= 120 && Math.abs(i.y - n.y) <= 2.5 && !/^\d{1,3}\.$/.test(i.str.trim()),
      );
      const name = cleanName(
        nameItems
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join(' '),
      ).name;
      if (name !== '') names.push({ no: Number.parseInt(n.str, 10), name });
    }
  }
  const highest = Math.max(0, ...names.map((n) => n.no));
  const have = new Set(names.map((n) => n.no));
  const missing = Array.from({ length: highest }, (_, k) => k + 1).filter((k) => !have.has(k));
  return { names, highest, missing, firstPage };
}

export function parseNlem(pages: PageItems[], options: ParserOptions): ParseResult {
  const columns = options.columns ?? DEFAULT_COLUMNS;
  const tolerance = options.centreTolerance ?? 16;
  const raws: Raw[] = [];
  const rejected: Rejected[] = [];
  const footnotes: Footnote[] = [];
  let headerFragmentsDropped = 0;
  const context: Context = { section: null, subsection: null };
  let previous: Raw | undefined;
  let pagesRead = 0;
  let pagesSkipped = 0;

  const alphabetical = parseAlphabetical(pages);
  // the tables end where the alphabetical list begins (what follows are annexes with their own numbering)
  const tablesEnd = alphabetical.firstPage ?? Infinity;

  for (const { page, items: allItems } of pages) {
    if (page >= tablesEnd) {
      pagesSkipped += 1;
      continue;
    }
    const items = allItems.map((i) => ({ ...i, str: i.str.trim() })).filter((i) => i.str !== '');
    // a page belongs to the tables if it has the table header or an item number; otherwise it is front matter
    const isTable = items.some(
      (i) =>
        i.str === 'Dosage form(s) and strength(s)' || (i.x < columns.refMax && REF.test(i.str)),
    );
    if (!isTable) {
      pagesSkipped += 1;
      continue;
    }
    pagesRead += 1;
    const live = items.filter((i) => !HEADER_TEXT.test(i.str));

    // ---- footnote zone: everything at or below the first left-column item that starts with a footnote marker
    const left = live.filter((i) => i.x < columns.refMax);
    const footnoteTop = Math.max(
      -Infinity,
      ...left.filter((i) => /^[*#†]+/.test(i.str)).map((i) => i.y),
    );
    const body = live.filter((i) => i.y > footnoteTop + 0.5);

    // ---- footnote paragraphs: a line that starts with a marker begins one; the lines after it continue it
    if (Number.isFinite(footnoteTop)) {
      let open: Footnote | null = null;
      for (const line of toLines(live.filter((i) => i.y <= footnoteTop + 0.5))) {
        const m = /^([*#†]+)\s*(.*)$/.exec(line.text);
        if (m) {
          open = { page, marker: m[1] ?? '', text: m[2] ?? '' };
          footnotes.push(open);
        } else if (open) open.text = normaliseSpaces(`${open.text} ${line.text}`);
      }
    }

    // ---- section titles, sub-section headings and item numbers, in reading order
    const events: Event[] = [];
    const used = new Set<TextItem>();
    const refKeyOf = new Map<TextItem, string>();
    for (const item of body) {
      if (!SECTION.test(item.str)) continue;
      const under = body.filter(
        (t) => t.y < item.y && t.y > item.y - 70 && t.x > 100 && t.x < 520 && !REF.test(t.str),
      );
      const title: string[] = [];
      let lastY = item.y;
      for (const line of toLines(under)) {
        if (lastY - line.y > 28 || SUBSECTION.test(line.text)) break;
        title.push(line.text);
        lastY = line.y;
      }
      for (const t of under) if (title.some((line) => line.includes(t.str))) used.add(t);
      used.add(item);
      events.push({ kind: 'section', y: item.y, title: cleanName(title.join(' ')).name });
    }
    for (const item of body) {
      if (used.has(item) || item.x >= columns.levelMax) continue;
      const sub = SUBSECTION.exec(item.str);
      if (sub && !REF.test(item.str)) {
        // the rest of a wrapped heading sits on the lines just below it
        const wrap = body.filter(
          (t) =>
            t.y < item.y &&
            t.y > item.y - 24 &&
            t.x < columns.levelMax &&
            Math.abs(t.x - item.x) < 60 &&
            !REF.test(t.str) &&
            !SUBSECTION.test(t.str) &&
            !SECTION.test(t.str) &&
            !used.has(t),
        );
        used.add(item);
        for (const t of wrap) used.add(t);
        events.push({
          kind: 'subsection',
          y: item.y,
          title: cleanName([sub[2] ?? '', ...wrap.map((t) => t.str)].join(' ')).name,
        });
      } else if (item.x < columns.refMax && REF.test(item.str)) {
        used.add(item);
        refKeyOf.set(item, `${item.str}@${item.y}`);
        events.push({ kind: 'ref', y: item.y, ref: item.str });
      }
    }
    events.sort((a, b) => b.y - a.y);

    // ---- the text cells, grouped by the order they have in the PDF's own content stream.
    // The file writes each row's cells together (number, name, level, forms) before the next number, so everything
    // between two item numbers belongs to the first of them. The geometric matcher below is an independent cross-check.
    const cells = body.filter((i) => !used.has(i) && i.x >= columns.refMax);
    const strays = body.filter((i) => !used.has(i) && i.x < columns.refMax);
    for (const stray of strays)
      rejected.push({
        page,
        ref: null,
        reason: 'Unclassified text in the item-number column',
        rawText: stray.str,
      });
    interface Bucket {
      names: TextItem[];
      levels: TextItem[];
      forms: TextItem[];
    }
    const emptyBucket = (): Bucket => ({ names: [], levels: [], forms: [] });
    const buckets = new Map<string, Bucket>();
    const leadingBucket = emptyBucket(); // cells before the first number of the page
    let current = leadingBucket;
    for (const item of body) {
      const key = refKeyOf.get(item);
      if (key !== undefined) {
        current = emptyBucket();
        buckets.set(key, current);
        continue;
      }
      if (used.has(item) || item.x < columns.refMax) continue;
      if (item.x < columns.nameMax) current.names.push(item);
      else if (item.x < columns.levelMax) current.levels.push(item);
      else current.forms.push(item);
    }

    // independent cross-check: where would the geometry alone put each line?
    const refs = events.filter((e): e is Extract<Event, { kind: 'ref' }> => e.kind === 'ref');
    const refYs = refs.map((r) => r.y);
    const nameMatch = matchRuns(
      toLines(cells.filter((i) => i.x < columns.nameMax)),
      refYs,
      tolerance,
      false,
    );
    const formMatch = matchRuns(
      toLines(cells.filter((i) => i.x >= columns.levelMax)),
      refYs,
      tolerance,
      true,
    );

    // ---- build rows in reading order, tracking the section and sub-section above each one
    const pageRows: Raw[] = [];
    for (const event of events) {
      if (event.kind === 'section') {
        context.section = event.title;
        context.subsection = null;
      } else if (event.kind === 'subsection') {
        context.subsection = event.title;
      } else {
        const index = pageRows.length;
        const bucket = buckets.get(`${event.ref}@${event.y}`) ?? emptyBucket();
        const notHeader = (lines: Line[]) =>
          lines.filter((l) => {
            const header = isHeaderFragment(l.text);
            if (header) headerFragmentsDropped += 1;
            return !header;
          });
        const nameLines = notHeader(toLines(bucket.names));
        const formLines = notHeader(toLines(bucket.forms));
        const same = (a: Line[], b: Line[] | null | undefined) =>
          a.map((l) => l.text).join('|') === (b ?? []).map((l) => l.text).join('|');
        const own = [...nameLines, ...formLines];
        const raw: Raw = {
          page,
          ref: event.ref,
          y: event.y,
          name: nameLines.map((l) => l.text).join(' '),
          nameLines,
          geometry:
            same(nameLines, nameMatch.runs[index]) && same(formLines, formMatch.runs[index])
              ? undefined
              : {
                  name: (nameMatch.runs[index] ?? []).map((l) => l.text).join(' '),
                  forms: (formMatch.runs[index] ?? []).map((l) => l.text),
                },
          levels: bucket.levels.map((i) => ({
            y: i.y,
            text: normaliseSpaces(i.str).replace(/\s*,\s*/g, ','),
          })),
          forms: formLines,
          context: { ...context },
          // the two methods must agree on this row's lines; if they do not, a person decides
          reasons: new Set(
            same(nameLines, nameMatch.runs[index]) && same(formLines, formMatch.runs[index])
              ? []
              : (['AMBIGUOUS_ROW'] as ReviewReason[]),
          ),
          top: own.length > 0 ? Math.max(...own.map((l) => l.y)) : event.y,
          bottom: own.length > 0 ? Math.min(...own.map((l) => l.y)) : event.y,
          fit: fitOf(formLines, event.y),
        };
        pageRows.push(raw);
        raws.push(raw);
      }
    }

    // ---- cells before the first number: dosage-form lines continue the last row of the previous page
    const leadingForms = toLines(leadingBucket.forms).filter((l) => {
      const header = isHeaderFragment(l.text);
      if (header) headerFragmentsDropped += 1;
      return !header;
    });
    if (leadingForms.length > 0) {
      if (previous && previous.page === page - 1) {
        previous.forms.push(...leadingForms);
        previous.reasons.add('CONTINUED_FROM_PREVIOUS_PAGE');
      } else
        rejected.push({
          page,
          ref: null,
          reason: 'Dosage-form lines at the top of the page with no row to continue',
          rawText: leadingForms.map((l) => l.text).join(' | '),
        });
    }
    const leadingOther = [...toLines(leadingBucket.names), ...toLines(leadingBucket.levels)];
    if (leadingOther.length > 0)
      rejected.push({
        page,
        ref: null,
        reason: 'Medicine or level text before the first item number of the page',
        rawText: leadingOther.map((l) => l.text).join(' | '),
      });
    // a paragraph of notes in the margin runs across the columns and pollutes the rows beside it
    for (const stray of strays)
      if (stray.str.length > 40)
        for (const row of pageRows)
          if (Math.abs(row.y - stray.y) <= 70) row.reasons.add('AMBIGUOUS_ROW');

    if (pageRows.length > 0) previous = pageRows[pageRows.length - 1];
  }

  const result = finish(raws, rejected, options.nlemYear, { pagesRead, pagesSkipped }, footnotes);
  result.stats.headerFragmentsDropped = headerFragmentsDropped;
  return { ...result, alphabetical, footnotes };
}

/** Joins a wrapped form line onto the one before it, only on the strict cues in the header comment. */
export function joinWrapped(lines: Line[]): { lines: Line[]; joined: number; groups: number[][] } {
  const out: Line[] = [];
  const groups: number[][] = [];
  let joined = 0;
  for (const [index, line] of lines.entries()) {
    const last = out[out.length - 1];
    const continuation =
      last !== undefined &&
      !/^[a-z]\)\s/.test(line.text) &&
      (/^[a-z0-9+(),.\-/%]/.test(line.text) || /\+$/.test(last.text));
    // a joined line keeps the height of its first physical line (used to pick the nearest level)
    if (continuation) {
      out[out.length - 1] = { y: last.y, text: `${last.text} ${line.text}` };
      groups[groups.length - 1]?.push(index);
      joined += 1;
    } else {
      out.push({ y: line.y, text: line.text });
      groups.push([index]);
    }
  }
  return { lines: out, joined, groups };
}

/** One dose-form entry after prefixes have been attached. `first` = index of the physical line that carries it. */
interface FinalLine {
  text: string;
  y: number;
  first: number;
  /** Set when the line is already split (a prefix followed by "As licensed"), or cannot be split. */
  forced?: ParsedForm;
}

const hasDigit = (t: string) => /\d/.test(t);
/** A prefix cell: no digit, ends in "-" or "/" ("Modified Release -", "Conventional/Effervescent/"). Lettered a) b) lists are not. */
const isPrefixLine = (t: string) => !hasDigit(t) && /[-/]\s*$/.test(t) && !/^[a-z]\)\s/.test(t);
const firstWord = (t: string) => t.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/**
 * Prefix cells belong to the dose-form lines that follow them, so "Modified Release -" + "Tablet 200 mg" is the form
 * "Modified Release Tablet" (as the inline "Modified Release Tablet 750 mg" of Levetiracetam). A "-" prefix covers the next
 * line and the lines after it that start with the same word; a "/" prefix covers only the next line with a number.
 * A prefix followed by "As licensed ..." gives the form (the prefix) and the strength text "As licensed ...".
 */
function attachPrefixes(
  lines: Line[],
  groups: number[][],
): { lines: FinalLine[]; attached: number; prefixPhysical: number[] } {
  const out: FinalLine[] = [];
  const prefixPhysical: number[] = [];
  let attached = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as Line;
    const first = groups[i]?.[0] ?? i;
    if (!isPrefixLine(line.text)) {
      out.push({ text: line.text, y: line.y, first });
      i += 1;
      continue;
    }
    // the prefix can run over several lines ("Conventional/Effervescent/" then "Dispersible/ Enteric coated")
    const parts = [line.text];
    let j = i + 1;
    while (j < lines.length) {
      const t = (lines[j] as Line).text;
      if (hasDigit(t) || isPrefixLine(t) || /^as licensed/i.test(t) || /^[a-z]\)\s/.test(t)) break;
      parts.push(t);
      j += 1;
    }
    for (let m = i; m < j; m += 1) prefixPhysical.push(...(groups[m] ?? []));
    const dash = /-\s*$/.test(line.text);
    const prefix = parts
      .join(' ')
      .replace(/\s*-\s*$/, '')
      .trim();
    const target = lines[j];
    if (target === undefined) {
      out.push({
        text: parts.join(' '),
        y: line.y,
        first,
        forced: {
          doseForm: null,
          strength: null,
          paediatric: false,
          noteText: null,
          problem: 'a prefix line with nothing after it',
        },
      });
      i = j;
      continue;
    }
    if (/^as licensed/i.test(target.text)) {
      out.push({
        text: `${prefix} ${target.text}`,
        y: line.y,
        first,
        forced: {
          doseForm: prefix,
          strength: target.text,
          paediatric: false,
          noteText: null,
          problem: null,
        },
      });
      attached += 1;
      prefixPhysical.push(...(groups[j] ?? []));
      i = j + 1;
      continue;
    }
    const word = firstWord(target.text);
    let k = j;
    do {
      const t = lines[k] as Line;
      out.push({ text: `${prefix} ${t.text}`, y: t.y, first: groups[k]?.[0] ?? k });
      attached += 1;
      k += 1;
    } while (
      dash &&
      k < lines.length &&
      !isPrefixLine((lines[k] as Line).text) &&
      firstWord((lines[k] as Line).text) === word
    );
    i = k;
  }
  return { lines: out, attached, prefixPhysical };
}

/**
 * Gives each physical form line a level. A row with one level gives it to every line. A row with several levels
 * (P,S,T for the tablets, S,T for the injection) is cut into consecutive groups, one per level, so that each group is
 * centred on its level; that is how the PDF lays them out, and "nearest level" gets the lines in between wrong.
 */
function assignLevels(
  ys: number[],
  levels: Array<{ y: number; text: string }>,
): Array<string | null> {
  const sorted = [...levels].sort((a, b) => b.y - a.y);
  const nearest = (y: number) =>
    sorted.reduce(
      (best, l) => (Math.abs(l.y - y) < Math.abs(best.y - y) ? l : best),
      sorted[0] as { y: number; text: string },
    ).text;
  if (sorted.length === 0) return ys.map(() => null);
  if (sorted.length === 1) return ys.map(() => (sorted[0] as { text: string }).text);
  const n = ys.length;
  const k = sorted.length;
  if (n < k) return ys.map((y) => nearest(y));
  const centre = (a: number, b: number) => ((ys[a] as number) + (ys[b - 1] as number)) / 2;
  let best = { cost: Infinity, cuts: [] as number[] };
  const cuts: number[] = [];
  const walk = (start: number, group: number, cost: number) => {
    const level = sorted[group] as { y: number };
    if (group === k - 1) {
      const total = cost + Math.abs(centre(start, n) - level.y);
      if (total < best.cost) best = { cost: total, cuts: [...cuts] };
      return;
    }
    for (let end = start + 1; end <= n - (k - group - 1); end += 1) {
      cuts.push(end);
      walk(end, group + 1, cost + Math.abs(centre(start, end) - level.y));
      cuts.pop();
    }
  };
  walk(0, 0, 0);
  return ys.map((_, i) => {
    let g = 0;
    while (g < k - 1 && i >= (best.cuts[g] as number)) g += 1;
    return (sorted[g] as { text: string }).text;
  });
}

interface CellNote {
  marker: string;
  text: string;
}

/**
 * A note that sits INSIDE the dose-form cell starts with a marker ("#", "*", "(*") and runs to the end of the cell:
 * "#" then "for prophylaxis of P. vivax". It is not a dose form; it goes to source_notes, verbatim.
 */
function splitCellNotes(forms: Line[]): { forms: Line[]; notes: CellNote[]; noteLines: number } {
  const at = forms.findIndex((l) => /^(?:\(\s*)?[*#†]+/.test(l.text));
  if (at < 0) return { forms, notes: [], noteLines: 0 };
  const rest = forms.slice(at);
  const head = rest[0] as Line;
  const marker = (/^(?:\(\s*)?([*#†]+)/.exec(head.text) as RegExpExecArray)[1] as string;
  const lone = /^[*#†]+$/.test(head.text);
  const text = lone
    ? `${marker}${rest
        .slice(1)
        .map((l) => l.text)
        .join(' ')}`
    : rest.map((l) => l.text).join(' ');
  return {
    forms: forms.slice(0, at),
    notes: [{ marker, text: normaliseSpaces(text) }],
    noteLines: rest.length,
  };
}

function finish(
  raws: Raw[],
  rejected: Rejected[],
  nlemYear: number,
  pageCounts: { pagesRead: number; pagesSkipped: number },
  footnotes: Footnote[],
): Omit<ParseResult, 'alphabetical' | 'footnotes'> {
  const review: ReviewItem[] = [];
  const entries: ParsedEntry[] = [];
  const rows: FormulationRow[] = [];
  const byKey = new Map<string, FormulationRow>();
  const levelOf = new Map<string, string | null>();
  let formulationLines = 0;
  let wrappedLinesJoined = 0;
  const placedGenerics = new Set<string>();
  const allGenerics = new Map<string, { name: string; refs: string[] }>();
  const cells: CellRecord[] = [];

  // numbered category headings: a number and a name, no level, no forms, and numbered children below it
  const headingNames = new Map<string, string>();
  raws.forEach((raw, index) => {
    const next = raws[index + 1];
    if (
      raw.levels.length === 0 &&
      raw.forms.length === 0 &&
      next !== undefined &&
      next.ref.startsWith(`${raw.ref}.`)
    )
      // the name can be empty when the heading text sat outside the name column; the numbered children still prove it
      headingNames.set(raw.ref, cleanName(raw.name).name);
  });
  const categoryOf = (raw: Raw): string | null => {
    const parts = raw.ref.split('.');
    const ancestors: string[] = [];
    for (let n = 2; n < parts.length; n += 1) {
      const name = headingNames.get(parts.slice(0, n).join('.'));
      if (name) ancestors.push(name);
    }
    return (
      [raw.context.section, raw.context.subsection, ...ancestors].filter(Boolean).join(' > ') ||
      null
    );
  };
  const footnoteOf = (page: number, marker: string) =>
    footnotes.find((f) => f.page === page && f.marker === marker);

  for (const raw of raws) {
    if (headingNames.has(raw.ref)) continue;
    const cleaned = cleanName(raw.name);
    const category = categoryOf(raw);
    const noteSplit = splitCellNotes(raw.forms);
    const wrapped = joinWrapped(noteSplit.forms);
    wrappedLinesJoined += wrapped.joined;
    const prefixed = attachPrefixes(wrapped.lines, wrapped.groups);
    const levelAt = assignLevels(
      noteSplit.forms.map((l) => l.y),
      raw.levels,
    );
    const levelText = raw.levels.map((l) => l.text).join(' / ');
    const rawText = [raw.name, levelText, ...raw.forms.map((l) => l.text)]
      .filter(Boolean)
      .join(' | ');
    const rawLines: RawLine[] = [
      ...raw.nameLines.map((l) => ({ column: 'name' as const, y: l.y, text: l.text })),
      ...raw.levels.map((l) => ({ column: 'level' as const, y: l.y, text: l.text })),
      ...raw.forms.map((l) => ({ column: 'form' as const, y: l.y, text: l.text })),
    ];

    if (cleaned.name === '') {
      rejected.push({
        page: raw.page,
        ref: raw.ref,
        reason: 'No medicine name found beside the item number',
        rawText,
      });
      continue;
    }
    const gKey = distinctKey(cleaned.name);
    const known = allGenerics.get(gKey);
    if (known) known.refs.push(raw.ref);
    else allGenerics.set(gKey, { name: cleaned.name, refs: [raw.ref] });

    const reasons = new Set<ReviewReason>(raw.reasons);
    if (raw.levels.length === 0) reasons.add('NO_LEVEL');
    if (raw.levels.length > 1) reasons.add('MULTI_LEVEL');
    if (raw.levels.some((l) => !LEVEL.test(l.text))) reasons.add('ODD_LEVEL');
    if (prefixed.lines.length === 0) reasons.add('NO_FORM_LINES');
    if (prefixed.attached > 0) reasons.add('PREFIX_LINES_ATTACHED');
    // text that sits off-centre or has a large gap inside it is matched correctly in practice, but a person should glance at it
    if (raw.fit.offset > 6 || raw.fit.gaps > 0) reasons.add('UNUSUAL_LAYOUT');

    const parsed = prefixed.lines.map((line) => ({
      line,
      form: line.forced ?? parseFormLine(line.text),
      level: levelAt[line.first] ?? null,
    }));
    for (const { form } of parsed) {
      if (form.problem) reasons.add('UNPARSED_FORM_LINE');
      else if (form.doseForm === null && form.strength === null) reasons.add('NO_FORM_OR_STRENGTH');
      else if (form.strength === null) reasons.add('NO_STRENGTH_STATED');
    }

    // notes that belong to the whole item: the table's own note, and the footnote of each marker beside the name
    const itemNotes: string[] = [];
    for (const n of noteSplit.notes) itemNotes.push(`table note: ${n.text}`);
    for (const marker of cleaned.markerGroups) {
      if (noteSplit.notes.some((n) => n.marker === marker)) continue; // that marker's note is the table note above
      const fn = footnoteOf(raw.page, marker);
      if (fn) itemNotes.push(`footnote ${marker}: ${fn.text}`);
      else {
        itemNotes.push(
          `footnote marker ${marker} beside the name; its text was not found on the page`,
        );
        reasons.add('FOOTNOTE_NOT_FOUND');
      }
    }

    entries.push({
      page: raw.page,
      ref: raw.ref,
      name: cleaned.name,
      category,
      formLines: prefixed.lines.map((l) => l.text),
      parsedLines: parsed.map(({ form, level }) => ({
        doseForm: form.doseForm,
        strength: form.strength,
        level,
      })),
      rawLines,
      fit: raw.fit,
    });

    // account for every raw dose-form cell of this item (filled in below when the item is not held)
    const cellOf: CellRecord[] = raw.forms.map((l) => ({
      page: raw.page,
      ref: raw.ref,
      text: l.text,
      disposition: 'HELD' as CellDisposition,
      defects: cellDefects(l.text),
    }));
    cells.push(...cellOf);
    wrapped.groups.forEach((group) =>
      group.slice(1).forEach((k) => {
        const c = cellOf[k];
        if (c) c.disposition = 'WRAP_JOINED';
      }),
    );
    for (let k = noteSplit.forms.length; k < cellOf.length; k += 1) {
      const c = cellOf[k];
      if (c) c.disposition = 'NOTE';
    }
    // a prefix cell (and the "As licensed" cell after it) is accounted for once it has been attached to its form
    for (const k of prefixed.prefixPhysical) {
      const c = cellOf[k];
      if (c) c.disposition = 'PREFIX_ATTACHED';
    }
    const flagItem = (heldNow: boolean) => {
      review.push({
        page: raw.page,
        ref: raw.ref,
        name: cleaned.name,
        rawText,
        rawLines,
        ...(raw.geometry ? { geometryReading: raw.geometry } : {}),
        reasons: [...reasons],
        held: heldNow,
      });
    };
    const heldNow = [...reasons].some((r) => HOLD_REASONS.has(r));
    if (reasons.size > 0) flagItem(heldNow);
    if (heldNow) continue;

    placedGenerics.add(gKey);
    for (const { line, form, level } of parsed) {
      formulationLines += 1;
      const firstCell = cellOf[line.first];
      const notes: string[] = [];
      if (form.paediatric) notes.push('paediatric formulation, marked (p) in the source');
      if (form.noteText) notes.push(`source text: ${form.noteText}`);
      notes.push(...itemNotes);
      // a marker inside this row's own text (for example "MDI/DPI*") brings its footnote to this row only
      for (const marker of line.text.match(/[*#†]+/g) ?? []) {
        const fn = footnoteOf(raw.page, marker);
        const text = fn ? `footnote ${marker}: ${fn.text}` : '';
        if (text && !notes.includes(text)) notes.push(text);
      }
      const row: FormulationRow = {
        genericName: cleaned.name,
        doseForm: form.doseForm,
        strength: form.strength,
        route: null,
        therapeuticCategory: category,
        nlemYear,
        nlemRef: raw.ref,
        healthcareLevels: level,
        sourcePage: raw.page,
        sourceNotes: notes.length > 0 ? notes.join('; ') : null,
        alsoListedIn: [],
      };
      const key = formulationKey(row);
      const firstRow = byKey.get(key);
      if (!firstRow) {
        byKey.set(key, row);
        levelOf.set(key, row.healthcareLevels);
        rows.push(row);
        if (firstCell && firstCell.disposition !== 'PREFIX_ATTACHED')
          firstCell.disposition = 'LOADED';
      } else {
        firstRow.alsoListedIn.push(raw.ref);
        // the notes of this item's own markers must not be lost because an earlier item holds the row
        const extra = itemNotes.filter((n) => !(firstRow.sourceNotes ?? '').includes(n));
        if (extra.length > 0)
          firstRow.sourceNotes = [firstRow.sourceNotes, ...extra].filter(Boolean).join('; ');
        if (firstCell)
          firstCell.disposition =
            firstRow.nlemRef === raw.ref && firstRow.sourcePage === raw.page
              ? 'COLLAPSED_IN_ENTRY'
              : 'LOADED';
        if (levelOf.get(key) !== row.healthcareLevels)
          review.push({
            page: raw.page,
            ref: raw.ref,
            name: cleaned.name,
            rawText,
            rawLines,
            reasons: ['LEVELS_DIFFER_ON_REPEAT'],
            held: false,
          });
      }
    }
  }

  // ---- why the numbered entries reduce to fewer distinct names
  const listings = [...allGenerics.values()];
  const counts = new Map<number, number>();
  for (const g of listings) counts.set(g.refs.length, (counts.get(g.refs.length) ?? 0) + 1);
  const unplaced = listings
    .filter((g) => !placedGenerics.has(distinctKey(g.name)))
    .map((g) => g.name);
  const numberedEntries = raws.length - headingNames.size;

  return {
    entries,
    rows,
    review,
    rejected,
    stats: {
      numberedLines: raws.length,
      headings: headingNames.size,
      numberedEntries,
      wrappedLinesJoined,
      ...pageCounts,
      formulationLines,
      formulationRows: rows.length,
      distinctGenerics: allGenerics.size,
      rejected: rejected.length,
      flagged: review.length,
      flaggedHeld: review.filter((r) => r.held).length,
      headerFragmentsDropped: 0,
    },
    repeats: {
      extraEntries: numberedEntries - allGenerics.size,
      byListings: [...counts.entries()]
        .map(([n, generics]) => ({ listings: n, generics }))
        .sort((a, b) => a.listings - b.listings),
      mostRepeated: listings
        .filter((g) => g.refs.length > 2)
        .sort((a, b) => b.refs.length - a.refs.length || a.name.localeCompare(b.name))
        .map((g) => ({ name: g.name, listings: g.refs.length, refs: g.refs })),
    },
    unplaced,
    cells,
  };
}

const HEADER_LINE =
  /^(?:medicine|level of|healthcare|level of healthcare|dosage form\(\s*s\)(?:\s*and)?(?:\s*strength\(\s*s\))?|strength\(\s*s\))$/i;
/** A repeated table-header fragment ("Dosage form( s) and strength(s)") that landed in a cell. */
export const isHeaderFragment = (text: string): boolean => HEADER_LINE.test(normaliseSpaces(text));

/** A prefix cell, or a stray page-header fragment. */
function cellDefects(text: string): CellDefect[] {
  const defects: CellDefect[] = [];
  if (isPrefixLine(text)) defects.push('PREFIX_LINE');
  if (isHeaderFragment(text)) defects.push('HEADER_FRAGMENT');
  return defects;
}
