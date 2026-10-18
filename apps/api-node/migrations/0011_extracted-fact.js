// Migration 0011 (Phase 5A Run 1): extracted_fact (PRD 8.2, FR-F3-01..03, FR-F3-05). A fact is something the language
// model (or the doctor, for a manual fact) says was stated in the consultation: a symptom, a duration, an allergy...
// Rules enforced HERE, not only in code:
//  - an extracted fact cannot exist without its source segment, a valid span and the evidence quote (hallucination
//    control, FR-F3-03). Only a MANUAL fact (typed by the doctor) is exempt, and it is flagged source = 'manual';
//  - a fact keeps the hash of the (normalised) segment text its span refers to; when that text changes the fact turns
//    'stale' and the doctor must re-confirm it. It is never rewritten automatically;
//  - the identity of a fact (session, type, source, evidence) cannot be changed by the runtime role, and a doctor-
//    confirmed fact cannot be deleted by it. Unconfirmed facts are deleted when consent is withdrawn (ADR-D28/D29);
//    a confirmed fact whose draft segment is deleted keeps its quote and records `segment_deleted_at`.
// Fact text is clinical speech: never logged, never in the audit log (ids and counts only).

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE TABLE extracted_fact (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    type text NOT NULL CHECK (type IN ('symptom', 'duration', 'severity', 'vital', 'allergy', 'past_condition',
                                       'current_medicine', 'red_flag_mention')),
    value text NOT NULL CHECK (length(value) BETWEEN 1 AND 500),
    negated boolean NOT NULL DEFAULT false,
    uncertain boolean NOT NULL DEFAULT false,
    speaker text CHECK (speaker IS NULL OR speaker IN ('unknown', 'doctor', 'patient')),
    source text NOT NULL DEFAULT 'extracted' CHECK (source IN ('extracted', 'manual')),
    source_segment_id uuid REFERENCES transcript_segment (id),
    span_start integer CHECK (span_start IS NULL OR span_start >= 0),
    span_end integer,
    evidence_quote text CHECK (evidence_quote IS NULL OR length(evidence_quote) BETWEEN 1 AND 1000),
    match_type text CHECK (match_type IS NULL OR match_type IN ('exact', 'fuzzy')),
    segment_text_hash text CHECK (segment_text_hash IS NULL OR segment_text_hash ~ '^[0-9a-f]{64}$'),
    segment_deleted_at timestamptz,
    concept_id text,
    snomed_id text CHECK (snomed_id IS NULL OR snomed_id ~ '^[0-9]{6,18}$'),
    status text NOT NULL DEFAULT 'heard' CHECK (status IN ('heard', 'confirmed', 'rejected', 'stale')),
    edited boolean NOT NULL DEFAULT false,
    original_value text,
    original_negated boolean,
    original_uncertain boolean,
    pipeline text NOT NULL CHECK (length(pipeline) BETWEEN 1 AND 40),
    model text CHECK (model IS NULL OR length(model) <= 120),
    run_id uuid,
    confirmed_at timestamptz,
    confirmed_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT extracted_fact_needs_evidence CHECK (
      source = 'manual'
      OR (
        evidence_quote IS NOT NULL AND span_start IS NOT NULL AND span_end IS NOT NULL AND span_end > span_start
        AND segment_text_hash IS NOT NULL AND match_type IS NOT NULL
        AND (source_segment_id IS NOT NULL OR segment_deleted_at IS NOT NULL)
      )
    ),
    CONSTRAINT extracted_fact_confirmed_has_time CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
  )`);
  pgm.sql(
    'CREATE INDEX ix_extracted_fact_session ON extracted_fact (clinic_id, session_id, status)',
  );
  pgm.sql('CREATE INDEX ix_extracted_fact_segment ON extracted_fact (source_segment_id)');
  // the same extraction run twice must not duplicate a fact
  pgm.sql(`CREATE UNIQUE INDEX ux_extracted_fact_once ON extracted_fact
    (session_id, source_segment_id, type, span_start, span_end, segment_text_hash, lower(value), negated)
    WHERE source = 'extracted' AND source_segment_id IS NOT NULL`);
  pgm.sql(`CREATE FUNCTION extracted_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'confirmed' THEN
          RAISE EXCEPTION 'a confirmed fact cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id OR NEW.type <> OLD.type
         OR NEW.source <> OLD.source OR NEW.pipeline <> OLD.pipeline
         OR NEW.evidence_quote IS DISTINCT FROM OLD.evidence_quote THEN
        RAISE EXCEPTION 'the identity and the evidence of a fact cannot be changed';
      END IF;
      IF NEW.source_segment_id IS DISTINCT FROM OLD.source_segment_id
         AND NOT (NEW.source_segment_id IS NULL AND NEW.segment_deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'the source segment of a fact cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER extracted_fact_guard BEFORE UPDATE OR DELETE ON extracted_fact
    FOR EACH ROW EXECUTE FUNCTION extracted_fact_guard()`);
  // DELETE exists for one reason: unconfirmed facts are removed when consent is withdrawn.
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON extracted_fact TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS extracted_fact');
  pgm.sql('DROP FUNCTION IF EXISTS extracted_fact_guard()');
};
