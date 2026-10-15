// CSV safety for the audit export (no database): formula injection and quoting.
import { describe, expect, it } from 'vitest';
import { csvCell, neutraliseFormula, toCsv } from '../src/audit/csv.js';

describe('formula-injection neutralisation', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+cmd', "'+cmd"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tTAB', "'\tTAB"],
    ['\rCR', "'\rCR"],
    ['\nLF', "'\nLF"],
    ['=HYPERLINK("http://evil.example","click")', '\'=HYPERLINK("http://evil.example","click")'],
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
  ])('prefixes %j', (input, expected) => {
    expect(neutraliseFormula(input)).toBe(expected);
  });

  it.each([
    'patient',
    'LOGIN_FAILED',
    '5eed0000-0000-4000-8000-000000000012',
    '2026-10-15T10:00:00.000Z',
    'a=b',
    'x+y',
    '',
  ])('leaves harmless text alone: %j', (input) => {
    expect(neutraliseFormula(input)).toBe(input);
  });

  it('does not double-prefix and only looks at the first character', () => {
    expect(neutraliseFormula("'=1")).toBe("'=1");
    expect(neutraliseFormula(' =1')).toBe(' =1'); // spreadsheets do not run a formula that starts with a space
  });
});

describe('csvCell quoting', () => {
  it('writes null/undefined as an empty cell and numbers/booleans as they are', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(false)).toBe('false');
  });

  it('quotes cells with commas, quotes or line breaks, and doubles inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('neutralises first, then quotes: a formula with a comma stays one safe cell', () => {
    expect(csvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');
  });

  it('a quote-and-formula combination cannot escape its cell', () => {
    const cell = csvCell('x","=1+1');
    expect(cell).toBe('"x"",""=1+1"');
    // parse it back: it is ONE cell whose text is the original
    expect(cell.slice(1, -1).replaceAll('""', '"')).toBe('x","=1+1');
  });
});

describe('toCsv', () => {
  it('writes a header and CRLF-terminated rows, neutralising every text cell in every column', () => {
    const csv = toCsv(
      ['seq', 'action', 'resource_id'],
      [
        [1, 'LOGIN_SUCCEEDED', 'abc'],
        [2, '=EVIL()', '+1-555'],
        [3, '@x', null],
      ],
    );
    expect(csv).toBe(
      "seq,action,resource_id\r\n1,LOGIN_SUCCEEDED,abc\r\n2,'=EVIL(),'+1-555\r\n3,'@x,\r\n",
    );
    for (const line of csv.trim().split('\r\n').slice(1)) {
      for (const cell of line.split(',')) expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
    }
  });
});
