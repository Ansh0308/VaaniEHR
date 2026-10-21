// Migration 0013 (remaining Phase 5 items): the doctor-confirmed concept link of a fact (FR-F3-04, ADR-D37).
// `concept_id` has existed since 0011 and was always empty. It is now set ONLY by the doctor pressing Confirm on a
// suggestion (never by the system), together with who and when. Rules enforced here, not only in code:
//  - concept_id is empty exactly when concept_status is 'none';
//  - a confirmed link records the doctor and the time;
//  - 'stale' means the link was confirmed for words that have since changed (the fact's value was edited, or the fact's
//    source text changed): the link is kept visible but the question engine ignores it until the doctor confirms it again.
// The concept ids are INTERNAL ids from the owner's unreviewed draft list. snomed_id stays NULL (no SNOMED yet).

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE extracted_fact
    ADD COLUMN concept_status text NOT NULL DEFAULT 'none' CHECK (concept_status IN ('none', 'confirmed', 'stale')),
    ADD COLUMN concept_confirmed_by uuid,
    ADD COLUMN concept_confirmed_at timestamptz,
    ADD CONSTRAINT extracted_fact_concept_consistent CHECK ((concept_id IS NULL) = (concept_status = 'none')),
    ADD CONSTRAINT extracted_fact_concept_who CHECK (
      concept_status <> 'confirmed' OR (concept_confirmed_by IS NOT NULL AND concept_confirmed_at IS NOT NULL)
    ),
    ADD CONSTRAINT extracted_fact_concept_text CHECK (concept_id IS NULL OR length(concept_id) BETWEEN 1 AND 64)`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE extracted_fact
    DROP CONSTRAINT IF EXISTS extracted_fact_concept_text,
    DROP CONSTRAINT IF EXISTS extracted_fact_concept_who,
    DROP CONSTRAINT IF EXISTS extracted_fact_concept_consistent,
    DROP COLUMN IF EXISTS concept_confirmed_at,
    DROP COLUMN IF EXISTS concept_confirmed_by,
    DROP COLUMN IF EXISTS concept_status`);
};
