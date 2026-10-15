// CSV output for the audit export. Two separate protections:
//  1. RFC 4180 quoting, so a value containing a comma, quote or line break cannot break out of its cell.
//  2. Spreadsheet formula-injection defence: a text cell that starts with = + - @ TAB or CR (or LF) would be run as a
//     formula by Excel / LibreOffice / Sheets. Such cells get a leading single quote, which spreadsheets show as plain
//     text (OWASP "CSV Injection"). Applied to EVERY text cell, whatever column it is in.

const FORMULA_START = /^[=+\-@\t\r\n]/;

/** Makes one text value safe to open in a spreadsheet. */
export function neutraliseFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** One CSV cell: null becomes empty, numbers and booleans are written as is, text is neutralised then quoted if needed. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const safe = neutraliseFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}
