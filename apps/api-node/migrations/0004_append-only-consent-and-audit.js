// Migration 0004 (Phase 2A): append-only tables - consent_event (FR-F1-05) and the hash-chained audit_log (FR-F7-04,
// NFR-REL-01). Two layers stop edits: (1) the app role gets no UPDATE/DELETE (migration 0005);
// (2) triggers raise an error for UPDATE, DELETE and TRUNCATE even for the table owner. A deliberate tamper test
// disables the triggers as the owner and proves the hash chain still detects the change.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createFunction(
    'forbid_modification',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `BEGIN
  RAISE EXCEPTION 'table % is append-only (% is not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;`,
  );

  pgm.createTable('consent_event', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    // Monotonic order: the effective consent is the row with the highest seq per scope (ts alone can tie).
    seq: {
      type: 'bigint',
      notNull: true,
      unique: true,
      sequenceGenerated: { precedence: 'ALWAYS' },
    },
    session_id: { type: 'uuid', notNull: true, references: 'consultation_session(id)' },
    clinic_id: { type: 'uuid', notNull: true },
    scope: {
      type: 'text',
      notNull: true,
      check: "scope IN ('audio', 'ai_processing', 'whatsapp')",
    },
    granted: { type: 'boolean', notNull: true },
    notice_version: { type: 'text', notNull: true },
    notice_language: { type: 'text', notNull: true, check: "notice_language IN ('en', 'gu')" },
    // Who the consent came through: 'patient' = the patient confirmed it themselves, 'staff' = entered on their behalf.
    source: { type: 'text', notNull: true, check: "source IN ('patient', 'staff')" },
    recorded_by_user_id: { type: 'uuid', notNull: true },
    recorded_by_role: { type: 'text', notNull: true },
    ts: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('consent_event', ['session_id', 'scope', 'seq']);

  pgm.createTable('audit_log', {
    // seq is assigned by the application under an advisory lock (not an identity column) so it is part of the hash.
    seq: { type: 'bigint', primaryKey: true },
    ts: { type: 'timestamptz', notNull: true },
    actor_user_id: { type: 'uuid' },
    actor_role: { type: 'text' },
    clinic_id: { type: 'uuid' },
    action: { type: 'text', notNull: true },
    resource_type: { type: 'text' },
    resource_id: { type: 'text' },
    session_id: { type: 'uuid' },
    ip: { type: 'text' },
    request_id: { type: 'text' },
    meta: { type: 'jsonb', notNull: true, default: '{}' },
    prev_hash: { type: 'char(64)', notNull: true, unique: true },
    row_hash: { type: 'char(64)', notNull: true, unique: true },
  });
  pgm.createIndex('audit_log', 'ts');
  pgm.createIndex('audit_log', 'action');

  for (const table of ['consent_event', 'audit_log']) {
    pgm.sql(`CREATE TRIGGER ${table}_no_update_delete
      BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION forbid_modification()`);
    pgm.sql(`CREATE TRIGGER ${table}_no_truncate
      BEFORE TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification()`);
  }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable('audit_log');
  pgm.dropTable('consent_event');
  pgm.dropFunction('forbid_modification', []);
};
