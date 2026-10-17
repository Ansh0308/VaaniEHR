// Migration 0006 (Phase 3A): medicine master (FR-F5-01..05), optional brands, Gujarati search mapping, prescription
// templates (schema only; the template API and UI come later, F11).
//
// Rules enforced HERE, in the database, so no code path can forget them:
//  - one row per FORMULATION (generic + dose form + strength + route). The unique index uses coalesce(..., '') so a NULL
//    route or strength cannot create duplicates (it works on every PostgreSQL version; NULLS NOT DISTINCT is 15+ only);
//  - review fields: the runtime role `vaani_app` can never set reviewed_on / reviewed_by. A trigger forces them to NULL
//    on insert, and on update keeps the old values, unless a material column changed, in which case they are cleared
//    (an edited row needs a new review). This applies to every role, so a re-import that changes a value also clears them;
//  - no DELETE grant: rows are retired (retired_at), never deleted;
//  - snomed_code and atc_code stay NULL until a licensed release is loaded (scripts/load-medicine-codes).
// pg_trgm is a "trusted" extension (PostgreSQL 13+), so the migration owner may create it without superuser rights.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  pgm.sql(`CREATE TABLE medicine_master (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generic_name         text NOT NULL CHECK (btrim(generic_name) <> ''),
  strength             text,
  dose_form            text,
  route                text,
  therapeutic_category text,
  nlem_year            integer CHECK (nlem_year IS NULL OR nlem_year BETWEEN 1990 AND 2100),
  snomed_code          text,
  atc_code             text,
  source               text NOT NULL CHECK (btrim(source) <> ''),
  source_page          integer CHECK (source_page IS NULL OR source_page > 0),
  nlem_ref             text,
  healthcare_levels    text,
  source_notes         text,
  also_listed_in       text[] NOT NULL DEFAULT '{}',
  reviewed_on          date,
  reviewed_by          text,
  retired_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((reviewed_on IS NULL) = (reviewed_by IS NULL))
)`);

  pgm.sql(`CREATE UNIQUE INDEX uq_medicine_formulation ON medicine_master (
  lower(generic_name), coalesce(dose_form, ''), coalesce(strength, ''), coalesce(route, '')
)`);
  pgm.sql(
    'CREATE INDEX ix_medicine_generic_trgm ON medicine_master USING gin (lower(generic_name) gin_trgm_ops)',
  );
  pgm.sql('CREATE INDEX ix_medicine_generic_sort ON medicine_master (lower(generic_name))');

  pgm.sql(`CREATE TABLE medicine_brand (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id  uuid NOT NULL REFERENCES medicine_master (id),
  brand_name   text NOT NULL CHECK (btrim(brand_name) <> ''),
  manufacturer text,
  source       text NOT NULL CHECK (btrim(source) <> ''),
  retired_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
)`);
  pgm.sql(
    'CREATE UNIQUE INDEX uq_medicine_brand ON medicine_brand (medicine_id, lower(brand_name))',
  );
  pgm.sql(
    'CREATE INDEX ix_brand_name_trgm ON medicine_brand USING gin (lower(brand_name) gin_trgm_ops)',
  );

  // Gujarati spelling of a query -> Latin spelling of a generic or brand name. EMPTY until a Gujarati reviewer has
  // approved a list; search works without it.
  pgm.sql(`CREATE TABLE medicine_translit_gu (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gu_text     text NOT NULL CHECK (btrim(gu_text) <> ''),
  latin_text  text NOT NULL CHECK (btrim(latin_text) <> ''),
  source      text NOT NULL CHECK (btrim(source) <> ''),
  reviewed_by text NOT NULL,
  reviewed_on date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gu_text, latin_text)
)`);
  pgm.sql('CREATE INDEX ix_translit_gu_text ON medicine_translit_gu (gu_text text_pattern_ops)');

  // Prescription templates (FR-F5-04): owner and clinic are plain ids (no foreign keys to the ClinicOS stand-ins, ADR-D20).
  pgm.sql(`CREATE TABLE med_template (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  owner_user_id uuid NOT NULL,
  clinic_id     uuid NOT NULL,
  visibility    text NOT NULL CHECK (visibility IN ('personal', 'clinic')),
  retired_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
)`);
  pgm.sql(`CREATE TABLE med_template_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES med_template (id),
  medicine_id  uuid NOT NULL REFERENCES medicine_master (id),
  position     integer NOT NULL CHECK (position >= 0),
  dose         text,
  frequency    text,
  duration     text,
  instructions text,
  UNIQUE (template_id, position)
)`);

  // Review guard (see header). current_user is the role running the statement.
  pgm.sql(`CREATE FUNCTION medicine_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user = 'vaani_app' THEN
      NEW.reviewed_on := NULL;
      NEW.reviewed_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.generic_name, NEW.strength, NEW.dose_form, NEW.route, NEW.therapeutic_category, NEW.nlem_year,
      NEW.source, NEW.source_page, NEW.nlem_ref, NEW.healthcare_levels, NEW.source_notes, NEW.also_listed_in)
     IS DISTINCT FROM
     (OLD.generic_name, OLD.strength, OLD.dose_form, OLD.route, OLD.therapeutic_category, OLD.nlem_year,
      OLD.source, OLD.source_page, OLD.nlem_ref, OLD.healthcare_levels, OLD.source_notes, OLD.also_listed_in)
  THEN
    NEW.reviewed_on := NULL;
    NEW.reviewed_by := NULL;
  ELSIF current_user = 'vaani_app' THEN
    NEW.reviewed_on := OLD.reviewed_on;
    NEW.reviewed_by := OLD.reviewed_by;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$`);
  pgm.sql(`CREATE TRIGGER trg_medicine_review_guard BEFORE INSERT OR UPDATE ON medicine_master
  FOR EACH ROW EXECUTE FUNCTION medicine_review_guard()`);

  // Least privilege: the API reads and writes medicines and brands, never deletes, and only reads the Gujarati table.
  // Templates have no API yet, so the runtime role gets no access to them in this phase.
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON medicine_master, medicine_brand TO vaani_app');
  pgm.sql('GRANT SELECT ON medicine_translit_gu TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(
    'DROP TABLE IF EXISTS med_template_item, med_template, medicine_translit_gu, medicine_brand',
  );
  pgm.sql('DROP TABLE IF EXISTS medicine_master');
  pgm.sql('DROP FUNCTION IF EXISTS medicine_review_guard()');
  // pg_trgm is left in place: other objects may use it.
};
