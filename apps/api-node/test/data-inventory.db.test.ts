// docs/DATA_INVENTORY.md must list every table of the database (Phase 12B Run 2, ADR-D45). A new table without an inventory row
// fails this test; so does a row for a table that does not exist, a row that omits its fields, and a column added to a table
// without being named in its row.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './db/helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

const doc = readFileSync(
  fileURLToPath(new URL('../../../docs/DATA_INVENTORY.md', import.meta.url)),
  'utf8',
);
const section = (from: string, to: string): string => {
  const a = doc.indexOf(from);
  const b = doc.indexOf(to, a + 1);
  expect(a, `section ${from}`).toBeGreaterThanOrEqual(0);
  return doc.slice(a, b === -1 ? undefined : b);
};
const rows = section('## 2. Tables', '## 3.')
  .split('\n')
  .filter((l) => /^\|\s*`[a-z_]+`\s*\|/.test(l))
  .map((l) => l.split('|').map((c) => c.trim()))
  .map((cells) => ({
    table: (cells[1] ?? '').replaceAll('`', ''),
    purpose: cells[2] ?? '',
    fields: cells[3] ?? '',
    readBy: cells[4] ?? '',
    retention: cells[5] ?? '',
    leaves: cells[6] ?? '',
  }));

describe('the data inventory', () => {
  it('has a row for every table and no row for a table that does not exist', async () => {
    const real = (
      await h.db.owner.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'pgmigrations'`,
      )
    ).rows.map((r) => r.table_name as string);
    const listed = rows.map((r) => r.table);
    expect(
      real.filter((t) => !listed.includes(t)),
      'tables without an inventory row',
    ).toEqual([]);
    expect(
      listed.filter((t) => !real.includes(t)),
      'rows for tables that do not exist',
    ).toEqual([]);
    expect(new Set(listed).size, 'a table listed twice').toBe(listed.length);
  });

  it('names every column of every table in its row', async () => {
    const cols = (
      await h.db.owner.query(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> 'pgmigrations'`,
      )
    ).rows as { table_name: string; column_name: string }[];
    const missing: string[] = [];
    for (const row of rows) {
      const named = new Set(row.fields.split(',').map((f) => f.trim()));
      for (const c of cols.filter((x) => x.table_name === row.table)) {
        if (!named.has(c.column_name)) missing.push(`${row.table}.${c.column_name}`);
      }
    }
    expect(missing, 'columns missing from the inventory').toEqual([]);
  });

  it('every row says what it is for, who reads it, how long it stays and whether it leaves the system', () => {
    expect(rows.length).toBeGreaterThanOrEqual(30);
    for (const r of rows) {
      for (const [name, value] of Object.entries(r))
        expect(value.length, `${r.table} ${name}`).toBeGreaterThan(1);
    }
  });

  it('marks the legal bases as unchecked and states the audio retention rule', () => {
    expect(doc).toMatch(/to be checked by my guide \/ institution/);
    expect(doc).toMatch(/\*\*90 days\*\*/);
    expect(section('## 3.', '## 4.')).toMatch(
      /Sarvam[\s\S]*LLM provider[\s\S]*WhatsApp[\s\S]*ABDM[\s\S]*HL7 FHIR validator/,
    );
  });
});
