// Migration 0012 (Phase 6A Run 1): question_event and candidate (PRD F4, FR-F4-02..04, FR-F4-08, FR-F4-09).
// The pathway engine SUGGESTS questions and candidate conditions to the doctor; it never decides. Both tables record
// which pathway id + version produced a row, so an evaluation can always say which rules were in force.
//  - question_event: one row per suggested question or raised red flag, and what the doctor did with it
//    (asked / dismissed / snoozed, or acknowledged for a red flag). Derived data.
//  - candidate: 'derived' rows are the computed shortlist (a snapshot, replaced on each read); 'selected' rows are the
//    doctor's own choice of a WORKING CONDITION (or "not listed" with a short free note). Selected rows are a doctor
//    decision and are kept when consent is withdrawn; derived rows and unacknowledged suggestions are deleted then
//    (ADR-D34, same idea as unconfirmed facts in ADR-D29). An acknowledged red flag is also kept: the doctor acted on it.
// The names say "candidate" and "working condition" on purpose: nothing here is a diagnosis (PRD_ERRATA 54).
// Free text (the "not listed" note) is clinical speech: never logged, never in the audit log.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE TABLE question_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    pathway_id text NOT NULL CHECK (pathway_id ~ '^[a-z][a-z0-9_]{0,63}$'),
    pathway_version integer NOT NULL CHECK (pathway_version >= 1),
    node_id text NOT NULL CHECK (node_id ~ '^[a-z][a-z0-9_]{0,63}$'),
    slot text NOT NULL CHECK (slot ~ '^[a-z][a-z0-9_]{0,63}$'),
    kind text NOT NULL CHECK (kind IN ('question', 'red_flag')),
    status text NOT NULL DEFAULT 'suggested'
      CHECK (status IN ('suggested', 'asked', 'dismissed', 'snoozed', 'acknowledged')),
    acted_at timestamptz,
    acted_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT question_event_status_fits_kind CHECK (
      (kind = 'question' AND status IN ('suggested', 'asked', 'dismissed', 'snoozed'))
      OR (kind = 'red_flag' AND status IN ('suggested', 'acknowledged'))
    ),
    CONSTRAINT question_event_acted_has_time CHECK ((status = 'suggested') = (acted_at IS NULL))
  )`);
  pgm.sql(
    'CREATE INDEX ix_question_event_session ON question_event (clinic_id, session_id, status)',
  );
  // at most one open suggestion per node per session
  pgm.sql(`CREATE UNIQUE INDEX ux_question_event_open ON question_event (session_id, pathway_id, node_id)
    WHERE status = 'suggested'`);
  pgm.sql(`CREATE FUNCTION question_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'acknowledged' THEN
          RAISE EXCEPTION 'an acknowledged red flag cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id
         OR NEW.pathway_id <> OLD.pathway_id OR NEW.pathway_version <> OLD.pathway_version
         OR NEW.node_id <> OLD.node_id OR NEW.slot <> OLD.slot OR NEW.kind <> OLD.kind THEN
        RAISE EXCEPTION 'the identity of a question event cannot be changed';
      END IF;
      IF OLD.status <> 'suggested' THEN
        RAISE EXCEPTION 'an acted-on question event cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER question_event_guard BEFORE UPDATE OR DELETE ON question_event
    FOR EACH ROW EXECUTE FUNCTION question_event_guard()`);
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON question_event TO vaani_app');

  pgm.sql(`CREATE TABLE candidate (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('derived', 'selected')),
    pathway_id text CHECK (pathway_id IS NULL OR pathway_id ~ '^[a-z][a-z0-9_]{0,63}$'),
    pathway_version integer CHECK (pathway_version IS NULL OR pathway_version >= 1),
    rank smallint CHECK (rank IS NULL OR rank BETWEEN 1 AND 10),
    score numeric(5, 4) CHECK (score IS NULL OR score BETWEEN 0 AND 1),
    not_listed boolean NOT NULL DEFAULT false,
    not_listed_text text CHECK (not_listed_text IS NULL OR length(not_listed_text) BETWEEN 1 AND 200),
    selected_by uuid,
    selected_at timestamptz,
    superseded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT candidate_derived_shape CHECK (
      kind <> 'derived' OR (pathway_id IS NOT NULL AND pathway_version IS NOT NULL AND rank IS NOT NULL
                            AND score IS NOT NULL AND NOT not_listed AND not_listed_text IS NULL
                            AND selected_by IS NULL)
    ),
    CONSTRAINT candidate_selected_shape CHECK (
      kind <> 'selected' OR (
        selected_by IS NOT NULL AND selected_at IS NOT NULL AND rank IS NULL AND score IS NULL
        AND ((not_listed AND pathway_id IS NULL AND pathway_version IS NULL)
             OR (NOT not_listed AND pathway_id IS NOT NULL AND pathway_version IS NOT NULL
                 AND not_listed_text IS NULL))
      )
    )
  )`);
  pgm.sql('CREATE INDEX ix_candidate_session ON candidate (clinic_id, session_id, kind)');
  // one live working-condition choice per session; an earlier choice is marked superseded
  pgm.sql(`CREATE UNIQUE INDEX ux_candidate_selected_live ON candidate (session_id)
    WHERE kind = 'selected' AND superseded_at IS NULL`);
  pgm.sql(`CREATE FUNCTION candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        IF OLD.kind = 'selected' THEN
          RAISE EXCEPTION 'a doctor-selected working condition cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id OR NEW.kind <> OLD.kind
         OR NEW.pathway_id IS DISTINCT FROM OLD.pathway_id
         OR NEW.pathway_version IS DISTINCT FROM OLD.pathway_version
         OR NEW.not_listed <> OLD.not_listed OR NEW.not_listed_text IS DISTINCT FROM OLD.not_listed_text
         OR NEW.selected_by IS DISTINCT FROM OLD.selected_by THEN
        RAISE EXCEPTION 'a candidate row cannot be rewritten';
      END IF;
      IF OLD.kind = 'derived' THEN
        RAISE EXCEPTION 'a derived candidate cannot be changed, only replaced';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER candidate_guard BEFORE UPDATE OR DELETE ON candidate
    FOR EACH ROW EXECUTE FUNCTION candidate_guard()`);
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON candidate TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS candidate');
  pgm.sql('DROP FUNCTION IF EXISTS candidate_guard()');
  pgm.sql('DROP TABLE IF EXISTS question_event');
  pgm.sql('DROP FUNCTION IF EXISTS question_event_guard()');
};
