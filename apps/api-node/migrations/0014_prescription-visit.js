// Migration 0014 (Phase 8 Run 1): the prescription rows of a consultation and the signed visit record (PG-08, FR-F7-01..04).
// - prescription_item: what the doctor puts on the prescription. Editable ONLY until the visit is signed: a trigger refuses
//   insert, update and delete by the runtime role once the session has a signed visit record. A row from the medicine master
//   keeps the master's id; the "Not in master list" fallback is flagged source = 'free_text'. No suggestion, no dose guidance.
// - visit_record: one row per signed session (the VisitRepository's standalone Postgres implementation; Phase 12 can swap
//   in ClinicOS). visit_record_version: the exact snapshot that was signed (facts, working condition, medicine rows, consent
//   state) with its SHA-256, and every amendment after it. Versions are append-only: the runtime role has no UPDATE or DELETE
//   on them, and a trigger says so in words. A record is never deleted by the runtime role.
// - safety: Phase 7 does not exist yet. A version records whether safety checks were configured and, if they were not, that
//   the doctor explicitly acknowledged "Safety checks were not run". The database refuses a version with neither.
// Content is clinical: never logged, never in the audit log (ids and counts only).

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE TABLE visit_record (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL UNIQUE REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    patient_ref uuid NOT NULL,
    doctor_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'signed' CHECK (status IN ('draft', 'signed')),
    current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
    signed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT visit_record_signed_has_version CHECK (
      (status = 'signed') = (current_version >= 1 AND signed_at IS NOT NULL)
    )
  )`);
  pgm.sql('CREATE INDEX ix_visit_record_clinic ON visit_record (clinic_id, doctor_id)');
  pgm.sql(`CREATE TABLE visit_record_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id uuid NOT NULL REFERENCES visit_record (id),
    session_id uuid NOT NULL,
    clinic_id uuid NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    kind text NOT NULL CHECK (kind IN ('signed', 'amendment')),
    content jsonb NOT NULL,
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    safety_configured boolean NOT NULL,
    safety_not_run_acknowledged boolean NOT NULL,
    reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500),
    signed_by uuid NOT NULL,
    signed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (visit_id, version),
    CONSTRAINT visit_version_amendment_has_reason CHECK ((kind = 'amendment') = (reason IS NOT NULL)),
    CONSTRAINT visit_version_first_is_signed CHECK (version > 1 OR kind = 'signed'),
    CONSTRAINT visit_version_safety_acknowledged CHECK (safety_configured OR safety_not_run_acknowledged)
  )`);
  pgm.sql('CREATE INDEX ix_visit_version_session ON visit_record_version (clinic_id, session_id)');

  pgm.sql(`CREATE FUNCTION visit_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      RAISE EXCEPTION 'a signed record version cannot be changed or deleted';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER visit_version_guard BEFORE UPDATE OR DELETE ON visit_record_version
    FOR EACH ROW EXECUTE FUNCTION visit_version_guard()`);

  pgm.sql(`CREATE FUNCTION visit_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a visit record cannot be deleted';
      END IF;
      IF NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id OR NEW.patient_ref <> OLD.patient_ref
         OR NEW.doctor_id <> OLD.doctor_id THEN
        RAISE EXCEPTION 'the identity of a visit record cannot be changed';
      END IF;
      IF OLD.status = 'signed' AND NEW.status <> 'signed' THEN
        RAISE EXCEPTION 'a signed visit cannot go back to draft';
      END IF;
      IF NEW.current_version < OLD.current_version OR NEW.current_version > OLD.current_version + 1 THEN
        RAISE EXCEPTION 'the version of a visit record only moves forward by one';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER visit_record_guard BEFORE UPDATE OR DELETE ON visit_record
    FOR EACH ROW EXECUTE FUNCTION visit_record_guard()`);
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON visit_record TO vaani_app');
  pgm.sql('GRANT SELECT, INSERT ON visit_record_version TO vaani_app');

  pgm.sql(`CREATE TABLE prescription_item (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    position integer NOT NULL CHECK (position >= 0),
    medicine_id uuid REFERENCES medicine_master (id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    source text NOT NULL CHECK (source IN ('master', 'free_text')),
    strength text CHECK (strength IS NULL OR length(strength) <= 100),
    dose_form text CHECK (dose_form IS NULL OR length(dose_form) <= 100),
    dose text CHECK (dose IS NULL OR length(dose) <= 100),
    frequency text CHECK (frequency IS NULL OR frequency IN ('OD', 'BD', 'TDS', 'QID', 'SOS')),
    duration text CHECK (duration IS NULL OR length(btrim(duration)) BETWEEN 1 AND 50),
    note text CHECK (note IS NULL OR length(note) <= 500),
    from_template_id uuid REFERENCES med_template (id),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT prescription_item_master_has_medicine CHECK ((source = 'master') = (medicine_id IS NOT NULL))
  )`);
  pgm.sql('CREATE INDEX ix_prescription_item_session ON prescription_item (clinic_id, session_id, position)');
  pgm.sql(`CREATE FUNCTION prescription_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE sid uuid;
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'INSERT' THEN sid := NEW.session_id; ELSE sid := OLD.session_id; END IF;
      IF EXISTS (SELECT 1 FROM visit_record WHERE session_id = sid AND status = 'signed') THEN
        RAISE EXCEPTION 'the prescription of a signed visit cannot be changed';
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id
                               OR NEW.source <> OLD.source OR NEW.medicine_id IS DISTINCT FROM OLD.medicine_id) THEN
        RAISE EXCEPTION 'the identity of a prescription row cannot be changed';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER prescription_item_guard BEFORE INSERT OR UPDATE OR DELETE ON prescription_item
    FOR EACH ROW EXECUTE FUNCTION prescription_item_guard()`);
  // DELETE exists so the doctor can remove a row while the visit is still a draft
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON prescription_item TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS prescription_item');
  pgm.sql('DROP FUNCTION IF EXISTS prescription_item_guard()');
  pgm.sql('DROP TABLE IF EXISTS visit_record_version');
  pgm.sql('DROP FUNCTION IF EXISTS visit_version_guard()');
  pgm.sql('DROP TABLE IF EXISTS visit_record');
  pgm.sql('DROP FUNCTION IF EXISTS visit_record_guard()');
};
