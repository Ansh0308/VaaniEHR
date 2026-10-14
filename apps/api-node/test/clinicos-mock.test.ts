// MockClinicOSAdapter must reproduce the VERIFIED ClinicOS shapes (docs/CLINICOS_INTEGRATION_FACTS.md),
// including the quirks that differ from the PRD's idealised contract (docs/PRD_ERRATA.md).
import { describe, expect, it } from 'vitest';
import { createDefaultMock, MOCK_TOKENS } from '../src/clinicos/MockClinicOSAdapter.js';

describe('MockClinicOSAdapter: GET /api/auth/me (Facts Q1)', () => {
  it('returns 200 with role, status and clinicId for a valid token', async () => {
    const res = await createDefaultMock().me(MOCK_TOKENS.doctorApproved);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { user: { role: 'doctor', status: 'approved', clinicId: expect.any(String) } },
    });
  });

  it('still returns 200 for suspended and pending users, exposing status (so callers must check it)', async () => {
    const mock = createDefaultMock();
    const suspended = await mock.me(MOCK_TOKENS.adminSuspended);
    const pending = await mock.me(MOCK_TOKENS.staffPending);
    expect(suspended.status).toBe(200);
    expect(suspended.body).toMatchObject({ data: { user: { status: 'suspended' } } });
    expect(pending.status).toBe(200);
    expect(pending.body).toMatchObject({ data: { user: { status: 'pending' } } });
  });

  it('returns 401 with a plain-string error for a bad or missing token', async () => {
    const mock = createDefaultMock();
    const bad = await mock.me('tampered');
    expect(bad).toEqual({
      status: 401,
      body: { success: false, error: 'Invalid or expired token. Please log in again.' },
    });
    const none = await mock.me(null);
    expect(none).toEqual({
      status: 401,
      body: { success: false, error: 'Not authenticated. Please log in.' },
    });
  });

  it('can reproduce the /api/auth/* rate limit (ADR-D12): the 11th call gets 429', async () => {
    const mock = createDefaultMock({ authRateLimitMax: 10 });
    for (let i = 0; i < 10; i += 1) {
      expect((await mock.me(MOCK_TOKENS.doctorApproved)).status).toBe(200);
    }
    const limited = await mock.me(MOCK_TOKENS.doctorApproved);
    expect(limited).toEqual({
      status: 429,
      body: {
        success: false,
        error: 'Too many requests from this IP, please try again after 15 minutes.',
      },
    });
  });
});

describe('MockClinicOSAdapter: POST /api/patients/lookup (Facts Q4)', () => {
  it('not found is HTTP 200 with { found: false }, never 404', async () => {
    const res = await createDefaultMock().lookupPatient(MOCK_TOKENS.doctorApproved, '9999999999');
    expect(res).toEqual({ status: 200, body: { success: true, data: { found: false } } });
  });

  it('found returns the lookup summary; dob and gender are nullable free values', async () => {
    const mock = createDefaultMock();
    const one = await mock.lookupPatient(MOCK_TOKENS.doctorApproved, '9000000001');
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({
      success: true,
      data: { found: true, patient: { phone: '9000000001', dob: '1990-01-15', gender: 'female' } },
    });
    const two = await mock.lookupPatient(MOCK_TOKENS.doctorApproved, '9000000002');
    expect(two.body).toMatchObject({
      data: { found: true, patient: { dob: null, gender: null, name: null, hasActiveToken: true } },
    });
  });

  it('normalises the phone like ClinicOS: strips non-digits and keeps the first 10 digits', async () => {
    const res = await createDefaultMock().lookupPatient(
      MOCK_TOKENS.doctorApproved,
      '+90000-00001 99',
    );
    expect(res.body).toMatchObject({ data: { found: true, patient: { phone: '9000000001' } } });
  });

  it('never returns private visit notes (the lookup shape has no notes field)', async () => {
    const res = await createDefaultMock().lookupPatient(MOCK_TOKENS.doctorApproved, '9000000001');
    expect(JSON.stringify(res.body)).not.toContain('notes');
  });

  it('enforces the same access rules as ClinicOS rbac', async () => {
    const mock = createDefaultMock();
    expect((await mock.lookupPatient(null, '9000000001')).status).toBe(401);
    expect((await mock.lookupPatient('tampered', '9000000001')).status).toBe(401);
    expect((await mock.lookupPatient(MOCK_TOKENS.adminSuspended, '9000000001')).status).toBe(403);
    expect((await mock.lookupPatient(MOCK_TOKENS.staffPending, '9000000001')).status).toBe(403);
    expect((await mock.lookupPatient(MOCK_TOKENS.patientRole, '9000000001')).status).toBe(403);
    const missing = await mock.lookupPatient(MOCK_TOKENS.doctorApproved, undefined);
    expect(missing).toEqual({
      status: 400,
      body: { success: false, error: 'Phone number is required' },
    });
  });
});
