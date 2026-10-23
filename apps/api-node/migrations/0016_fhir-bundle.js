// Migration 0016 (Phase 9A, ADR-D40): the FHIR bundles built from a signed visit and what the HL7 validator said about them.
// One row per (session, visit version, bundle kind). The bundle itself never changes after it is stored (trigger); only the
// validation result may be filled in again by an explicit request. A signed visit stays signed whatever the bundle's
// status: 'invalid' and 'not_validated' only switch export off. The raw validator output is kept as it came.
// The bundle holds clinical content: it is returned to the doctor, never logged and never put in the audit log.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE TABLE fhir_bundle (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    kind text NOT NULL CHECK (kind IN ('op_consult', 'prescription')),
    bundle jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('valid', 'invalid', 'not_validated')),
    error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
    info_count integer NOT NULL DEFAULT 0 CHECK (info_count >= 0),
    issues jsonb NOT NULL DEFAULT '[]'::jsonb,
    validator_output jsonb,
    validator_version text,
    ig_version text NOT NULL,
    not_validated_reason text,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    validated_at timestamptz,
    UNIQUE (session_id, version, kind),
    CONSTRAINT fhir_bundle_valid_has_output CHECK (status <> 'valid' OR (validator_output IS NOT NULL AND error_count = 0)),
    CONSTRAINT fhir_bundle_invalid_has_errors CHECK (status <> 'invalid' OR (validator_output IS NOT NULL AND error_count > 0)),
    CONSTRAINT fhir_bundle_not_validated_has_reason CHECK (status <> 'not_validated' OR not_validated_reason IS NOT NULL)
  )`);
  pgm.sql('CREATE INDEX ix_fhir_bundle_session ON fhir_bundle (clinic_id, session_id, version)');
  pgm.sql(`CREATE FUNCTION fhir_bundle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'vaani_app' THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a stored FHIR bundle cannot be deleted';
      END IF;
      IF NEW.bundle IS DISTINCT FROM OLD.bundle OR NEW.session_id <> OLD.session_id OR NEW.clinic_id <> OLD.clinic_id
         OR NEW.version <> OLD.version OR NEW.kind <> OLD.kind OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'a stored FHIR bundle cannot be changed, only its validation result';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`);
  pgm.sql(`CREATE TRIGGER fhir_bundle_guard BEFORE UPDATE OR DELETE ON fhir_bundle
    FOR EACH ROW EXECUTE FUNCTION fhir_bundle_guard()`);
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON fhir_bundle TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS fhir_bundle');
  pgm.sql('DROP FUNCTION IF EXISTS fhir_bundle_guard()');
};
