// The database contract: tables exist, the runtime role vaani_app has exactly the privileges it should (and no more),
// append-only tables cannot be edited even by the owner, and VaaniEHR tables have no foreign keys to the ClinicOS stand-ins.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './db/helpers.js';

let db: TestDb;
let app: pg.Pool;

beforeAll(async () => {
  db = await createTestDb();
  app = new pg.Pool({ connectionString: db.appUrl, max: 2 });
});
afterAll(async () => {
  await app.end();
  await db.dropDb();
});

const TABLES = [
  'audit_log',
  'consent_event',
  'consultation_session',
  'doctor_profile',
  'login_lockout',
  'mock_clinicos_clinic',
  'mock_clinicos_patient',
  'mock_clinicos_user',
  'patient_clinical_profile',
  'revoked_token',
  'schema_info',
];

const priv = async (table: string, p: string): Promise<boolean> => {
  const r = await db.owner.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', [
    'vaani_app',
    table,
    p,
  ]);
  return r.rows[0]?.ok === true;
};

describe('schema', () => {
  it('has every Phase 2A table', async () => {
    const r = await db.owner.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const have = r.rows.map((x) => x.tablename);
    for (const table of TABLES) expect(have, table).toContain(table);
  });

  it('VaaniEHR tables have no foreign key to a mock_clinicos_* table (Phase 12 can drop them)', async () => {
    const r = await db.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.confrelid
        WHERE c.contype = 'f' AND t.relname LIKE 'mock_clinicos_%'`,
    );
    expect(r.rows[0]?.n).toBe(0);
  });

  it('every stand-in table defaults is_simulated to true', async () => {
    const r = await db.owner.query<{ table_name: string; column_default: string }>(
      `SELECT table_name, column_default FROM information_schema.columns
        WHERE column_name = 'is_simulated' AND table_name LIKE 'mock_clinicos_%'`,
    );
    expect(r.rows).toHaveLength(3);
    for (const row of r.rows) expect(row.column_default).toBe('true');
  });

  it('mirrors ClinicOS patient columns, with no allergy, blood-group or consent columns', async () => {
    const r = await db.owner.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'mock_clinicos_patient'",
    );
    const cols = r.rows.map((x) => x.column_name);
    for (const c of [
      'id',
      'user_id',
      'clinic_id',
      'phone',
      'email',
      'name',
      'dob',
      'gender',
      'opt_in_msg',
    ]) {
      expect(cols).toContain(c);
    }
    for (const c of ['allergies', 'blood_group', 'phone_normalized', 'consent']) {
      expect(cols).not.toContain(c);
    }
  });
});

describe('runtime role vaani_app: least privilege', () => {
  it('is not a superuser and cannot create roles or databases', async () => {
    const r = await db.owner.query<{
      rolsuper: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>("SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'vaani_app'");
    expect(r.rows[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  });

  it.each(['audit_log', 'consent_event'])(
    '%s: SELECT and INSERT only (no UPDATE, DELETE, TRUNCATE)',
    async (table) => {
      expect(await priv(table, 'SELECT')).toBe(true);
      expect(await priv(table, 'INSERT')).toBe(true);
      expect(await priv(table, 'UPDATE')).toBe(false);
      expect(await priv(table, 'DELETE')).toBe(false);
      expect(await priv(table, 'TRUNCATE')).toBe(false);
    },
  );

  it.each(['mock_clinicos_user', 'mock_clinicos_clinic'])(
    '%s is read-only for the app (the directory is ClinicOS-owned)',
    async (table) => {
      expect(await priv(table, 'SELECT')).toBe(true);
      for (const p of ['INSERT', 'UPDATE', 'DELETE']) expect(await priv(table, p), p).toBe(false);
    },
  );

  it('no table grants DELETE or TRUNCATE to the app role, except the one an erasure empties (migration 0019)', async () => {
    const ERASURE_DELETE = new Set(['patient_clinical_profile']);
    for (const table of TABLES) {
      expect(await priv(table, 'DELETE'), `${table} DELETE`).toBe(ERASURE_DELETE.has(table));
      expect(await priv(table, 'TRUNCATE'), `${table} TRUNCATE`).toBe(false);
    }
  });

  it('really is denied (SQLSTATE 42501) when it tries to edit append-only tables', async () => {
    const attempts = [
      "UPDATE audit_log SET action = 'X'",
      'DELETE FROM audit_log',
      'TRUNCATE audit_log',
      'UPDATE consent_event SET granted = false',
      'DELETE FROM consent_event',
      'TRUNCATE consent_event',
      'DELETE FROM mock_clinicos_patient',
      "UPDATE mock_clinicos_user SET role = 'admin'",
    ];
    for (const sql of attempts) {
      await expect(app.query(sql), sql).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('append-only triggers (second layer, even for the owner)', () => {
  it('TRUNCATE on audit_log and consent_event is refused for the owner too (statement-level trigger)', async () => {
    for (const table of ['audit_log', 'consent_event']) {
      await expect(db.owner.query(`TRUNCATE ${table}`), table).rejects.toThrow(/append-only/);
    }
  });

  it('refuses an UPDATE or DELETE of an existing audit row for the owner', async () => {
    await db.owner.query(
      `INSERT INTO audit_log (seq, ts, action, meta, prev_hash, row_hash)
       VALUES (1, now(), 'SEED_APPLIED', '{}', $1, $2)`,
      ['0'.repeat(64), 'a'.repeat(64)],
    );
    await expect(db.owner.query("UPDATE audit_log SET action = 'LOGOUT'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.owner.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });
});
