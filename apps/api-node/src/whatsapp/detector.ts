// The mismatch detector (Phase 10 Run 1, ADR-D41). It PARSES the Gujarati output (the four variables and the final text) and
// compares what it finds with the signed snapshot: every medicine name, strength, form, dose, frequency phrase, duration and
// note, in order, and the count; every fact value. Any difference refuses the summary. It does not call the generator, so a
// bug or a tampered text in the generator cannot hide from it.
import type { SignedContent } from '../visits/repository.js';
import { FREQUENCY, P, TEMPLATE_BODY_GU } from './phrases.js';
import { ITEM_SEPARATOR, medicineHead, patientFacts, type SummaryParams } from './summary.js';

export interface Mismatch {
  code:
    | 'text'
    | 'medicine_count'
    | 'medicine_number'
    | 'name'
    | 'strength'
    | 'form'
    | 'dose'
    | 'frequency'
    | 'duration'
    | 'note'
    | 'trailing'
    | 'fact_count'
    | 'fact';
  /** 1-based number of the medicine or fact; 0 when it is about the whole text */
  item: number;
  detail: string;
}

const fillBody = (p: SummaryParams): string =>
  TEMPLATE_BODY_GU.replace('{{1}}', p.p1)
    .replace('{{2}}', p.p2)
    .replace('{{3}}', p.p3)
    .replace('{{4}}', p.p4);

export function findMismatches(
  params: SummaryParams,
  textGu: string,
  content: SignedContent,
): Mismatch[] {
  const out: Mismatch[] = [];
  if (textGu !== fillBody(params)) {
    out.push({
      code: 'text',
      item: 0,
      detail: 'The text is not the fixed template with these variables.',
    });
  }

  // medicines
  const meds = content.medicines;
  if (meds.length === 0) {
    if (params.p2 !== P.none.gu)
      out.push({
        code: 'medicine_count',
        item: 0,
        detail: 'Medicines are listed but the visit has none.',
      });
  } else {
    const items = params.p2.split(ITEM_SEPARATOR);
    if (items.length !== meds.length) {
      out.push({
        code: 'medicine_count',
        item: 0,
        detail: `The summary lists ${items.length} medicines, the signed visit has ${meds.length}.`,
      });
    }
    meds.forEach((m, i) => {
      const n = i + 1;
      const item = items[i];
      if (item === undefined) return;
      const prefix = `${n}. `;
      if (!item.startsWith(prefix)) {
        out.push({
          code: 'medicine_number',
          item: n,
          detail: 'The item does not start with its number.',
        });
        return;
      }
      let rest = item.slice(prefix.length);
      const eat = (token: string, code: Mismatch['code'], label: string): boolean => {
        if (rest.startsWith(token)) {
          rest = rest.slice(token.length);
          return true;
        }
        out.push({ code, item: n, detail: `${label} differs from the signed visit.` });
        return false;
      };
      if (!eat(m.name, 'name', 'The medicine name')) return;
      if (
        m.strength &&
        !(eat(' ', 'strength', 'The strength') && eat(m.strength, 'strength', 'The strength'))
      )
        return;
      if (m.doseForm && !(eat(' ', 'form', 'The form') && eat(m.doseForm, 'form', 'The form')))
        return;
      if (!eat(' - ', 'dose', 'The separator after the medicine')) return;
      const tail: Array<[string | null, Mismatch['code'], string]> = [
        [m.dose, 'dose', 'The dose'],
        [FREQUENCY[m.frequency]?.gu ?? m.frequency, 'frequency', 'The frequency'],
        [m.duration, 'duration', 'The duration'],
        [m.note, 'note', 'The note'],
      ];
      const wanted = tail.filter(([v]) => v);
      for (const [idx, [v, code, label]] of wanted.entries()) {
        if (!eat(v as string, code, label)) return;
        if (idx < wanted.length - 1 && !eat(', ', code, label)) return;
      }
      if (rest.length > 0)
        out.push({ code: 'trailing', item: n, detail: 'Extra text after the medicine.' });
      // the head as a whole must also equal the snapshot's (guards against a name that merely starts the same)
      if (!item.slice(prefix.length).startsWith(medicineHead(m))) {
        out.push({
          code: 'name',
          item: n,
          detail: 'The medicine head differs from the signed visit.',
        });
      }
    });
  }

  // facts
  const facts = patientFacts(content);
  if (facts.length === 0) {
    if (params.p1 !== P.none.gu)
      out.push({
        code: 'fact_count',
        item: 0,
        detail: 'Findings are listed but the visit has none.',
      });
  } else {
    const items = params.p1.split(ITEM_SEPARATOR);
    if (items.length !== facts.length) {
      out.push({
        code: 'fact_count',
        item: 0,
        detail: `The summary lists ${items.length} findings, the signed visit has ${facts.length}.`,
      });
    }
    facts.forEach((f, i) => {
      if (!(items[i] ?? '').includes(f.value))
        out.push({ code: 'fact', item: i + 1, detail: 'A finding differs from the signed visit.' });
    });
  }
  return out;
}
