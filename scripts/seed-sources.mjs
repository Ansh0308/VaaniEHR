// Rules for committed seed content under seed/ (ADR-D18): every row/record carries a non-empty `source`.
//   .csv   -> header must include a "source" column; every data row must have a non-empty source cell
//   .json  -> root array: every element is an object with a non-empty `source`
//             root object: must have a non-empty `source` (string or object); elements of the arrays
//             "rows", "items", "rules", "medicines" must each have a non-empty `source` too
//   .md .mjs .js .ts .py -> allowed as documentation or seed-building scripts, not checked
// Any other file type (pdf, docx, xlsx, zip, audio, ...) is rejected: raw/licensed downloads belong in the
// git-ignored data/ folder, never in seed/.
const SCRIPT_OR_DOC = new Set(['md', 'mjs', 'js', 'ts', 'py']);
const ROW_ARRAY_KEYS = ['rows', 'items', 'rules', 'medicines'];

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, newlines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  // Strip a UTF-8 byte-order mark if present (compared by code point to keep the source ASCII-clean).
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const hasSource = (value) => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
};

function checkCsv(path, content, problems) {
  const rows = parseCsv(content).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) {
    problems.push(`${path}: empty CSV (needs a header with a "source" column)`);
    return;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = header.indexOf('source');
  if (col === -1) {
    problems.push(`${path}: header has no "source" column`);
    return;
  }
  rows.slice(1).forEach((row, index) => {
    if (!hasSource(row[col])) problems.push(`${path}: data row ${index + 1} has an empty source`);
  });
}

function checkJson(path, content, problems) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    problems.push(`${path}: invalid JSON (${err.message})`);
    return;
  }
  const checkRecords = (records, label) => {
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object' || !hasSource(record.source)) {
        problems.push(`${path}: ${label}[${index}] has no non-empty "source"`);
      }
    });
  };
  if (Array.isArray(data)) {
    checkRecords(data, 'element');
  } else if (data && typeof data === 'object') {
    if (!hasSource(data.source)) problems.push(`${path}: root object has no non-empty "source"`);
    for (const key of ROW_ARRAY_KEYS) {
      if (Array.isArray(data[key])) checkRecords(data[key], key);
    }
  } else {
    problems.push(`${path}: JSON root must be an array or an object with "source"`);
  }
}

/** entries: [{ path: 'seed/...', content: string }]. Returns a list of problem strings (empty = OK). */
export function checkSeed(entries) {
  const problems = [];
  for (const { path, content } of entries) {
    const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
    if (ext === 'csv') checkCsv(path, content, problems);
    else if (ext === 'json') checkJson(path, content, problems);
    else if (!SCRIPT_OR_DOC.has(ext)) {
      problems.push(
        `${path}: file type ".${ext}" is not allowed in seed/ (raw or licensed downloads go in the ignored data/ folder)`,
      );
    }
  }
  return problems;
}
