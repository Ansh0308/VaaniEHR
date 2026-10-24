// The FIXED phrase table of the Gujarati patient summary (Phase 10 Run 1, ADR-D41). Every Gujarati string below is
// UNREVIEWED: a Gujarati speaker must check it before anything is sent to a real person (docs/WHATSAPP_SUBMISSION.md lists
// them; the screen labels the preview "needs Gujarati review"). Each phrase has an English side, used only for the
// approximate back-translation shown to the doctor. The table holds LABELS and frequency words, not advice: the system never
// writes a warning sign or a follow-up instruction; those are typed by the doctor.
export const PHRASE_TABLE_VERSION = '0.1';
export const TEMPLATE_NAME = 'vaaniehr_visit_summary_gu';
export const TEMPLATE_LANGUAGE = 'gu';

export interface Phrase {
  gu: string;
  en: string;
}

export const P = {
  title: { gu: 'તમારી મુલાકાતનો સારાંશ', en: 'Summary of your visit' },
  findings: { gu: 'તારણો', en: 'Findings' },
  medicines: { gu: 'દવાઓ', en: 'Medicines' },
  warning: { gu: 'ચેતવણીનાં ચિહ્નો', en: 'Warning signs' },
  followUp: { gu: 'ફોલો-અપ', en: 'Follow-up' },
  /** used where a field is empty (a template variable cannot be empty) */
  none: { gu: 'કોઈ નોંધ નથી', en: 'No note' },
  negated: { gu: 'નથી', en: 'not present' },
  uncertain: { gu: 'ચોક્કસ નથી', en: 'not certain' },
} as const satisfies Record<string, Phrase>;

/** Fact types that appear in the summary, with their label. A red-flag mention is NOT sent to the patient (see ADR-D41). */
export const FACT_LABEL: Record<string, Phrase> = {
  symptom: { gu: 'લક્ષણ', en: 'Symptom' },
  duration: { gu: 'સમયગાળો', en: 'Duration' },
  severity: { gu: 'તીવ્રતા', en: 'Severity' },
  vital: { gu: 'માપ', en: 'Measurement' },
  allergy: { gu: 'એલર્જી', en: 'Allergy' },
  past_condition: { gu: 'અગાઉની બીમારી', en: 'Past illness' },
  current_medicine: { gu: 'હાલની દવા', en: 'Current medicine' },
};

/** The frequency codes of the medicine templates (OD, BD, TDS, QID, SOS) in words. */
export const FREQUENCY: Record<string, Phrase> = {
  OD: { gu: 'દિવસમાં એક વાર', en: 'once a day' },
  BD: { gu: 'દિવસમાં બે વાર', en: 'twice a day' },
  TDS: { gu: 'દિવસમાં ત્રણ વાર', en: 'three times a day' },
  QID: { gu: 'દિવસમાં ચાર વાર', en: 'four times a day' },
  SOS: { gu: 'જરૂર પડે ત્યારે', en: 'when needed' },
};

/** A reply that withdraws consent. The English word is the standard one; the Gujarati word is unreviewed. */
export const STOP_WORDS = ['stop', 'બંધ'] as const;

/** The fixed body of the template: what the owner submits to Meta (docs/WHATSAPP_SUBMISSION.md). {{1}}..{{4}} are variables. */
export const TEMPLATE_BODY_GU = `${P.title.gu}\n\n${P.findings.gu}: {{1}}\n\n${P.medicines.gu}: {{2}}\n\n${P.warning.gu}: {{3}}\n\n${P.followUp.gu}: {{4}}`;
export const TEMPLATE_BODY_EN = `${P.title.en}\n\n${P.findings.en}: {{1}}\n\n${P.medicines.en}: {{2}}\n\n${P.warning.en}: {{3}}\n\n${P.followUp.en}: {{4}}`;

/** Every Gujarati phrase, for the review list (and a test that the document lists exactly these). */
export function allGujaratiPhrases(): string[] {
  return [
    ...Object.values(P).map((p) => p.gu),
    ...Object.values(FACT_LABEL).map((p) => p.gu),
    ...Object.values(FREQUENCY).map((p) => p.gu),
    ...STOP_WORDS.filter((w) => /[^\u0000-\u007f]/.test(w)),
  ];
}
