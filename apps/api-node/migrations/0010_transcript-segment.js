// Migration 0010 (Phase 4B Run 2): transcript_segment (PRD 8.2, FR-F2-06, FR-F2-07). One row per recognised segment of a
// consultation: the engine's ORIGINAL text, the doctor's edited text, who spoke, and a status. A segment is a DRAFT until
// the doctor confirms the transcript; a confirmed segment is part of the record and can no longer be changed or deleted
// by the runtime role (a trigger enforces it). Draft text is deleted when consent is withdrawn (ADR-D28).
// The text columns hold clinical speech: they are never written to logs or to the audit log (ids and counts only).

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE TABLE transcript_segment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    seq integer NOT NULL CHECK (seq >= 0),
    speaker text NOT NULL DEFAULT 'unknown' CHECK (speaker IN ('unknown', 'doctor', 'patient')),
    original_text text NOT NULL CHECK (length(original_text) BETWEEN 1 AND 4000),
    edited_text text CHECK (edited_text IS NULL OR length(edited_text) BETWEEN 1 AND 4000),
    language text CHECK (language IS NULL OR length(language) <= 12),
    start_ms integer CHECK (start_ms IS NULL OR start_ms >= 0),
    end_ms integer CHECK (end_ms IS NULL OR end_ms >= 0),
    engine text NOT NULL CHECK (length(engine) BETWEEN 1 AND 40),
    engine_version text CHECK (engine_version IS NULL OR length(engine_version) <= 60),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
    confirmed_at timestamptz,
    confirmed_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, seq),
    CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
  )`);
  pgm.sql(
    'CREATE INDEX ix_transcript_segment_clinic ON transcript_segment (clinic_id, session_id)',
  );
  pgm.sql(`CREATE FUNCTION transcript_segment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF OLD.status = 'confirmed' THEN
        RAISE EXCEPTION 'a confirmed transcript segment cannot be changed or deleted';
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.original_text <> OLD.original_text OR NEW.engine <> OLD.engine
         OR NEW.seq <> OLD.seq OR NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id) THEN
        RAISE EXCEPTION 'the engine text, engine, sequence and session of a segment cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER transcript_segment_guard BEFORE UPDATE OR DELETE ON transcript_segment
    FOR EACH ROW EXECUTE FUNCTION transcript_segment_guard()`);
  // DELETE is granted for ONE reason: unconfirmed draft text is removed when consent is withdrawn. The trigger above
  // refuses the delete of a confirmed segment.
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON transcript_segment TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS transcript_segment');
  pgm.sql('DROP FUNCTION IF EXISTS transcript_segment_guard()');
};
