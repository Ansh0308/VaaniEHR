// Migration 0008 (Phase 3B): prescription templates (FR-F5-04, PG-13).
//  - the frequency of a template item is a CODE from a controlled list, enforced by the database, never free text
//    (OD once daily, BD twice daily, TDS three times daily, QID four times daily, SOS as needed);
//  - the runtime role may read and write templates and replace a template's items (items are a list owned by the
//    template; the template itself is retired, never deleted);
//  - indexes for the clinic-scoped list.
// Templates are clinic data: every query is filtered by clinic_id, and a personal template is visible only to its owner.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE med_template_item ADD CONSTRAINT med_template_item_frequency_code
  CHECK (frequency IS NULL OR frequency IN ('OD', 'BD', 'TDS', 'QID', 'SOS'))`);
  pgm.sql(
    'CREATE INDEX ix_med_template_clinic ON med_template (clinic_id, visibility, owner_user_id) WHERE retired_at IS NULL',
  );
  pgm.sql('CREATE INDEX ix_med_template_item_medicine ON med_template_item (medicine_id)');

  pgm.sql('GRANT SELECT, INSERT, UPDATE ON med_template TO vaani_app');
  pgm.sql('GRANT SELECT, INSERT, UPDATE, DELETE ON med_template_item TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(
    'ALTER TABLE med_template_item DROP CONSTRAINT IF EXISTS med_template_item_frequency_code',
  );
  pgm.sql('DROP INDEX IF EXISTS ix_med_template_clinic');
  pgm.sql('DROP INDEX IF EXISTS ix_med_template_item_medicine');
};
