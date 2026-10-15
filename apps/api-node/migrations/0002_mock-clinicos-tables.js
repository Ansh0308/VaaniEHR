// Migration 0002 (Phase 2A): STAND-IN tables that imitate the ClinicOS data VaaniEHR needs while it runs standalone.
// Rules (ADR-D20):
//  - Reached ONLY through the ClinicOSAdapter interface (src/clinicos/ClinicOSAdapter.ts); a test enforces this.
//  - NO foreign keys from VaaniEHR tables to these tables.
//  - Phase 12 drops them (ClinicOS becomes the source through its REST API).
//  - Columns mirror ClinicOS (docs/CLINICOS_INTEGRATION_FACTS.md Q4a): UUID `id`, `phone` 10 digits, `name`, `dob`,
//    free-text `gender`, `opt_in_msg`. No allergies, no blood group, no consent columns (those are VaaniEHR-owned).
//  - `researcher` is NOT a ClinicOS role; it is allowed here only for seeding. Phase 12 maps it from
//    doctor_profile.researcher_flag.
//  - `is_simulated` marks fake data; API start-up refuses to run if any row is false (Hard Rule 1, ADR-D16).

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  const id = { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') };
  const stamps = {
    is_simulated: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  };

  pgm.createTable('mock_clinicos_clinic', {
    id,
    name: { type: 'varchar(200)', notNull: true },
    code: { type: 'varchar(40)', notNull: true, unique: true },
    ...stamps,
  });

  pgm.createTable('mock_clinicos_user', {
    id,
    name: { type: 'varchar(100)', notNull: true },
    email: { type: 'varchar(200)', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    role: {
      type: 'text',
      notNull: true,
      check: "role IN ('patient', 'admin', 'doctor', 'staff', 'researcher')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending', 'approved', 'rejected', 'suspended')",
    },
    clinic_id: { type: 'uuid' },
    ...stamps,
  });

  pgm.createTable('mock_clinicos_patient', {
    id,
    user_id: { type: 'uuid' },
    clinic_id: { type: 'uuid' },
    phone: { type: 'varchar(15)', notNull: true },
    email: { type: 'varchar(200)' },
    name: { type: 'varchar(200)' },
    dob: { type: 'date' },
    gender: { type: 'varchar(10)' },
    opt_in_msg: { type: 'boolean', notNull: true, default: true },
    ...stamps,
  });
  pgm.addConstraint('mock_clinicos_patient', 'mock_clinicos_patient_phone_clinic_key', {
    unique: ['phone', 'clinic_id'],
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable('mock_clinicos_patient');
  pgm.dropTable('mock_clinicos_user');
  pgm.dropTable('mock_clinicos_clinic');
};
