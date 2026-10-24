// Migration 0018 (Phase 9B, ADR-D42): the result of an ABHA verification (MOCK or SANDBOX only) and the short-lived OTP transactions.
//  - abha_link: ONE row per patient and clinic holding only what the PRD allows (section 8.2 abha_link): the ABHA ADDRESS, the time
//    of the verification, the mode (mock or sandbox) and a SALTED HASH of the ABHA number (HMAC with a server key and the patient
//    id), so a number can be matched but never read back. The number itself and every OTP are NEVER stored. Who attested the
//    patient's agreement and who verified are kept.
//  - abha_txn: one row per started OTP check. It holds our own opaque id (the only thing the browser sees), the provider's
//    transaction reference, the attempt counter (three wrong OTPs lock it), and an expiry. No identifier, no OTP.
// patient_id and clinic_id are plain ids (no foreign keys to the ClinicOS stand-ins, ADR-D20).

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE TABLE abha_link (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL,
    clinic_id uuid NOT NULL,
    abha_address text CHECK (abha_address IS NULL OR length(abha_address) <= 100),
    abha_number_hash text CHECK (abha_number_hash IS NULL OR abha_number_hash ~ '^[0-9a-f]{64}$'),
    mode text NOT NULL CHECK (mode IN ('mock', 'sandbox')),
    verified_at timestamptz NOT NULL,
    verified_by uuid NOT NULL,
    attested_by uuid NOT NULL,
    attested_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (clinic_id, patient_id)
  )`);
  pgm.sql(`CREATE TABLE abha_txn (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL,
    clinic_id uuid NOT NULL,
    provider_txn text NOT NULL CHECK (length(provider_txn) <= 200),
    mode text NOT NULL CHECK (mode IN ('mock', 'sandbox')),
    kind text NOT NULL CHECK (kind IN ('abha_number', 'abha_address')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'verified', 'failed', 'locked')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    attested_by uuid NOT NULL,
    attested_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`);
  pgm.sql('CREATE INDEX ix_abha_txn_patient ON abha_txn (clinic_id, patient_id, created_at)');
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON abha_link TO vaani_app');
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON abha_txn TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS abha_txn');
  pgm.sql('DROP TABLE IF EXISTS abha_link');
};
