// Migration 0003 (Phase 2A): tables VaaniEHR owns (ADR-D11, PRD section 8.2).
// ClinicOS-owned ids (patient, doctor, clinic) are plain uuid columns named `clinicos_*`, with NO foreign keys, so the
// mock stand-in tables can be dropped in Phase 12 without touching these tables.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  const now = pgm.func('now()');

  // Doctor profile: registration number, HPR id (ClinicOS has no doctor table).
  pgm.createTable('doctor_profile', {
    clinicos_user_id: { type: 'uuid', primaryKey: true },
    registration_no: { type: 'text' },
    hpr_id: { type: 'text' },
    signature_ref: { type: 'text' },
    researcher_flag: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: now },
    updated_at: { type: 'timestamptz', notNull: true, default: now },
  });

  // Patient clinical profile: allergies as free text entries (ClinicOS has no allergy field).
  pgm.createTable('patient_clinical_profile', {
    clinicos_patient_id: { type: 'uuid', primaryKey: true },
    allergies: { type: 'text[]', notNull: true, default: '{}' },
    updated_by: { type: 'uuid' },
    updated_at: { type: 'timestamptz', notNull: true, default: now },
  });

  pgm.createTable('consultation_session', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    clinicos_visit_id: { type: 'uuid' },
    clinicos_token_id: { type: 'uuid' },
    clinicos_patient_id: { type: 'uuid', notNull: true },
    clinicos_doctor_id: { type: 'uuid', notNull: true },
    clinicos_clinic_id: { type: 'uuid', notNull: true },
    started_at: { type: 'timestamptz', notNull: true, default: now },
    ended_at: { type: 'timestamptz' },
    language_mix: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'created',
      check: "status IN ('created', 'in_progress', 'ended')",
    },
  });
  pgm.createIndex('consultation_session', ['clinicos_clinic_id', 'started_at']);
  pgm.createIndex('consultation_session', 'clinicos_patient_id');

  // Login lockout (per hashed email, survives restarts). Not PHI: the email is stored only as a SHA-256 hash.
  pgm.createTable('login_lockout', {
    email_hash: { type: 'char(64)', primaryKey: true },
    failed_count: { type: 'integer', notNull: true, default: 0 },
    locked_until: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz', notNull: true, default: now },
  });

  // Logout / revocation list for access tokens (no refresh tokens in standalone mode, ADR-D4 amendment).
  pgm.createTable('revoked_token', {
    jti: { type: 'uuid', primaryKey: true },
    user_id: { type: 'uuid', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz', notNull: true, default: now },
  });
  pgm.createIndex('revoked_token', 'expires_at');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable('revoked_token');
  pgm.dropTable('login_lockout');
  pgm.dropTable('consultation_session');
  pgm.dropTable('patient_clinical_profile');
  pgm.dropTable('doctor_profile');
};
