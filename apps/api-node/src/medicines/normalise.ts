// Text normalisation for the NLEM import. Deliberately conservative: it only removes layout noise (spaces, footnote
// markers, the paediatric "(p)" flag) and splits "dose form" from "strength". It never rewrites a clinical value.

export function normaliseSpaces(text: string): string {
  return text
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();
}

export interface CleanName {
  name: string;
  /** The footnote marker(s) that were stuck to the name, for example "**". */
  markers: string;
}

/** "Oxygen*" -> { name: "Oxygen", markers: "*" }; " + " spacing is made uniform for combinations. */
export function cleanName(raw: string): CleanName {
  let text = normaliseSpaces(raw);
  // footnote stars and daggers can sit anywhere ("Co-trimoxazole* [Sulphamethoxazole ...]"); "#" only at the edges
  const markers =
    [...text.matchAll(/[*†‡]+/g)].map((m) => m[0]).join('') +
    (/^#+/.exec(text)?.[0] ?? '') +
    (/#+$/.exec(text)?.[0] ?? '');
  text = text
    .replace(/[*†‡]+/g, '')
    .replace(/^#+\s*/, '')
    .replace(/#+$/, '');
  text = text
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s+/g, ' ')
    .replace(/[,;:\s]+$/, '')
    .trim();
  return { name: text, markers };
}

/** Matching key for comparing two lists of names: letters, digits and "+" only, lower case. Used for reconciliation. */
export function looseKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9+]/g, '');
}

/** Two entries are the same generic when this key is equal (case and spacing are ignored, nothing else). */
export function distinctKey(name: string): string {
  return normaliseSpaces(name).toLowerCase();
}

/** The natural key of a formulation row; it mirrors the unique index uq_medicine_formulation in migration 0006. */
export function formulationKey(row: {
  genericName: string;
  doseForm: string | null;
  strength: string | null;
  route: string | null;
}): string {
  return [
    distinctKey(row.genericName),
    row.doseForm ?? '',
    row.strength ?? '',
    row.route ?? '',
  ].join('\u0001');
}

export interface ParsedForm {
  doseForm: string | null;
  strength: string | null;
  paediatric: boolean;
  /** Source text kept as a note when it is neither a form nor a strength ("As licensed for medical purpose"). */
  noteText: string | null;
  /** Set when the line cannot be split safely; the entry is then held for review. */
  problem: string | null;
}

/**
 * "Injection 10 mg/mL" -> form "Injection", strength "10 mg/mL".
 * The strength starts at the first word that begins with a digit; everything before it is the dose form.
 * "Liquid for inhalation" -> form only. "As licensed for medical purpose" -> neither (kept as a note).
 */
export function parseFormLine(line: string): ParsedForm {
  let text = normaliseSpaces(line);
  let paediatric = false;
  const flag = /\s*\(p\)\s*$/i.exec(text);
  if (flag) {
    paediatric = true;
    text = text.slice(0, flag.index).trim();
  }
  text = text.replace(/[*#†‡]+$/, '').trim();

  if (text === '')
    return { doseForm: null, strength: null, paediatric, noteText: null, problem: 'empty line' };
  if (/^as licensed\b/i.test(text))
    return { doseForm: null, strength: null, paediatric, noteText: text, problem: null };

  if (/^[a-z]\)\s/.test(text))
    return {
      doseForm: null,
      strength: null,
      paediatric,
      noteText: null,
      problem: 'lettered sub-list',
    };

  const words = text.split(' ');
  const at = words.findIndex((w) => /^\(?\d/.test(w));
  if (at === 0)
    return {
      doseForm: null,
      strength: null,
      paediatric,
      noteText: null,
      problem: 'starts with a number',
    };
  if (at === -1)
    return { doseForm: text, strength: null, paediatric, noteText: null, problem: null };

  const doseForm = words
    .slice(0, at)
    .join(' ')
    .replace(/[,;:\-\s]+$/, '');
  const strength = words.slice(at).join(' ');
  if (doseForm === '' || strength === '')
    return {
      doseForm: null,
      strength: null,
      paediatric,
      noteText: null,
      problem: 'cannot split form and strength',
    };
  return { doseForm, strength, paediatric, noteText: null, problem: null };
}
