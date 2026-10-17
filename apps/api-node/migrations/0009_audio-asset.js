// Migration 0009 (Phase 4A): audio_asset (PRD 8.2). One row per stored recording. The audio itself is an encrypted file
// owned by asr-py; this table records that it exists, until when it may be kept, and when it was deleted.
//  - retention_until: audio is deleted after the evaluation window (NFR-PRIV-01, default 90 days);
//  - deleted_at / deleted_reason: a deletion is recorded, the row is kept (the runtime role has no DELETE grant);
//  - holds ids and numbers only: no name, no file content, no path outside the storage key.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE TABLE audio_asset (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES consultation_session (id),
    clinic_id uuid NOT NULL,
    storage_key text NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 200),
    duration_s numeric(10, 3) NOT NULL CHECK (duration_s >= 0),
    bytes bigint NOT NULL CHECK (bytes >= 0),
    retention_until timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    deleted_reason text CHECK (deleted_reason IN ('retention', 'consent_withdrawn', 'manual')),
    CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL))
  )`);
  pgm.sql('CREATE INDEX ix_audio_asset_session ON audio_asset (session_id)');
  pgm.sql(
    'CREATE INDEX ix_audio_asset_due ON audio_asset (retention_until) WHERE deleted_at IS NULL',
  );
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON audio_asset TO vaani_app');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS audio_asset');
};
