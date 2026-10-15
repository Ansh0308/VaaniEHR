// Migration 0005 (Phase 2A): the runtime database role `vaani_app` and its least-privilege grants.
// The role is created WITHOUT a password here (node-pg-migrate echoes SQL to the console, which would leak it).
// `npm run db:migrate` sets the password afterwards from APP_DB_PASSWORD (src/db/provision.ts).
// Key rule (NFR-REL-01): vaani_app can only SELECT and INSERT on audit_log and consent_event - no UPDATE, DELETE,
// TRUNCATE. Migrations and seeding run as the owner role, never as vaani_app.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vaani_app') THEN
    CREATE ROLE vaani_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;`);

  pgm.sql('GRANT USAGE ON SCHEMA public TO vaani_app');
  pgm.sql('GRANT SELECT ON schema_info TO vaani_app');

  // Append-only: read and insert only.
  pgm.sql('GRANT SELECT, INSERT ON audit_log, consent_event TO vaani_app');

  // VaaniEHR-owned mutable tables.
  pgm.sql(
    'GRANT SELECT, INSERT, UPDATE ON doctor_profile, patient_clinical_profile, consultation_session, login_lockout TO vaani_app',
  );
  pgm.sql('GRANT SELECT, INSERT ON revoked_token TO vaani_app');

  // Mock ClinicOS stand-ins (reached through the adapter): directory data is read-only except patients.
  pgm.sql('GRANT SELECT ON mock_clinicos_clinic, mock_clinicos_user TO vaani_app');
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON mock_clinicos_patient TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vaani_app');
  pgm.sql('REVOKE USAGE ON SCHEMA public FROM vaani_app');
  // The role itself is cluster-wide and may be used by other databases; it is left in place.
};
