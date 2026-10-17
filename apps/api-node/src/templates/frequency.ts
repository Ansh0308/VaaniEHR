// The controlled list of dose frequencies for prescription templates (FR-F5-04). A template item stores the CODE,
// never free text; the database refuses anything else (migration 0008) and the web app shows a label for each code in
// English and Gujarati (the Gujarati labels are PLACEHOLDERS that need review by a Gujarati speaker).
//
// The list is exactly the five codes the owner named. It is the conventional prescribing shorthand, not a clinical
// recommendation; whether the list is complete is a question for the clinician reviewer (OPEN_CLINICAL_ITEMS).
//   OD  once daily          BD  twice daily          TDS three times daily
//   QID four times daily    SOS as needed
export const FREQUENCY_CODES = ['OD', 'BD', 'TDS', 'QID', 'SOS'] as const;
export type FrequencyCode = (typeof FREQUENCY_CODES)[number];
