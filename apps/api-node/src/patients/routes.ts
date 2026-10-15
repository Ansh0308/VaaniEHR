// /api/v1/patients/*: lookup, create, read, clinical profile (allergies).
// Patient identity data lives in ClinicOS (here: its stand-in), reached only through ClinicOSAdapter. VaaniEHR owns the
// clinical profile (allergies as free text; ClinicOS has no allergy field - ADR-D11).
// PHI rules: the phone number travels in a POST body (never a URL); audit rows carry ids and counts only.
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import { normalisePhone, type DirectoryPatient } from '../clinicos/ClinicOSAdapter.js';
import type { Queryable } from '../db/tx.js';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';

const phone = z
  .string()
  .trim()
  .refine((v) => normalisePhone(v).length === 10 && v.replace(/\D/g, '').length === 10, {
    message: 'phone must contain exactly 10 digits',
  });
const dob = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dob must be YYYY-MM-DD')
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v) <= new Date(),
    'dob must be a past date',
  );

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;

const lookupBody = z.object({ phone });
const createBody = z.object({
  phone,
  name: z.string().trim().min(1).max(200).optional(),
  dob: dob.optional(),
  gender: z.string().trim().min(1).max(10).optional(),
  email: z.email().max(200).optional(),
  optInMsg: z.boolean().optional(),
});
type CreateBody = z.infer<typeof createBody>;
const profileBody = z.object({
  allergies: z.array(z.string().trim().min(1).max(200)).max(50),
});
type ProfileBody = z.infer<typeof profileBody>;

const patientView = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  phone: z.string(),
  dob: z.string().nullable(),
  gender: z.string().nullable(),
  email: z.string().nullable(),
  optInMsg: z.boolean(),
  isSimulated: z.boolean(),
  createdAt: z.string(),
  allergies: z.array(z.string()),
});

interface ProfileRow extends QueryResultRow {
  allergies: string[];
}

async function allergiesOf(db: Queryable, patientId: string): Promise<string[]> {
  const r = await db.query<ProfileRow>(
    'SELECT allergies FROM patient_clinical_profile WHERE clinicos_patient_id = $1',
    [patientId],
  );
  return r.rows[0]?.allergies ?? [];
}

export async function toPatientView(db: Queryable, p: DirectoryPatient) {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    dob: p.dob,
    gender: p.gender,
    email: p.email,
    optInMsg: p.optInMsg,
    isSimulated: p.isSimulated,
    createdAt: p.createdAt,
    allergies: await allergiesOf(db, p.id),
  };
}

const requireClinic = (clinicId: string | null): string => {
  if (!clinicId) throw errors.forbidden('This account has no clinic');
  return clinicId;
};

export function patientRoutes(): RouteDef[] {
  return [
    permRoute<unknown, z.infer<typeof lookupBody>>('patient.lookup', {
      method: 'post',
      path: '/patients/lookup',
      tag: 'Patients',
      summary: 'Find a patient by phone number (POST so the number is never in a URL)',
      audit: ['PATIENT_LOOKUP'],
      body: lookupBody,
      response: z.object({ found: z.boolean(), patient: patientView.optional() }),
      handler: async (ctx) => {
        const clinicId = requireClinic(ctx.auth.clinicId);
        const found = await ctx.services.directory.lookupPatientByPhone(clinicId, ctx.body.phone);
        await ctx.audit({
          action: 'PATIENT_LOOKUP',
          resourceType: 'patient',
          resourceId: found?.id ?? null,
          meta: { found: found !== null },
        });
        // Like ClinicOS: "not found" is a normal 200 answer, not a 404.
        return {
          data: found
            ? { found: true, patient: await toPatientView(ctx.db, found) }
            : { found: false },
        };
      },
    }),

    permRoute<unknown, CreateBody>('patient.create', {
      method: 'post',
      path: '/patients',
      tag: 'Patients',
      summary:
        'Register a patient (an existing phone number in the clinic returns the existing patient)',
      audit: ['PATIENT_CREATED', 'PATIENT_LOOKUP'],
      body: createBody,
      response: z.object({ created: z.boolean(), patient: patientView }),
      successStatus: 201,
      handler: async (ctx) => {
        const clinicId = requireClinic(ctx.auth.clinicId);
        const { patient, created } = await ctx.services.directory.createPatient(clinicId, ctx.body);
        await ctx.audit({
          action: created ? 'PATIENT_CREATED' : 'PATIENT_LOOKUP',
          resourceType: 'patient',
          resourceId: patient.id,
          meta: { created },
        });
        return {
          status: created ? 201 : 200,
          data: { created, patient: await toPatientView(ctx.db, patient) },
        };
      },
    }),

    permRoute<IdParams>('patient.read', {
      method: 'get',
      path: '/patients/:id',
      tag: 'Patients',
      summary: 'Read a patient and their allergy list',
      audit: [],
      params: idParams,
      response: patientView,
      handler: async (ctx) => {
        const clinicId = requireClinic(ctx.auth.clinicId);
        const patient = await ctx.services.directory.getPatient(clinicId, ctx.params.id);
        if (!patient) throw errors.notFound('Patient not found');
        return { data: await toPatientView(ctx.db, patient) };
      },
    }),

    permRoute<IdParams, ProfileBody>('patient.clinicalProfile.write', {
      method: 'put',
      path: '/patients/:id/clinical-profile',
      tag: 'Patients',
      summary: 'Replace the patient allergy list (free text entries)',
      audit: ['PATIENT_PROFILE_UPDATED'],
      params: idParams,
      body: profileBody,
      response: z.object({ allergies: z.array(z.string()) }),
      handler: async (ctx) => {
        const clinicId = requireClinic(ctx.auth.clinicId);
        const patient = await ctx.services.directory.getPatient(clinicId, ctx.params.id);
        if (!patient) throw errors.notFound('Patient not found');
        const allergies = [...new Set(ctx.body.allergies)];
        await ctx.db.query(
          `INSERT INTO patient_clinical_profile (clinicos_patient_id, allergies, updated_by, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (clinicos_patient_id)
           DO UPDATE SET allergies = EXCLUDED.allergies, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [patient.id, allergies, ctx.auth.sub],
        );
        await ctx.audit({
          action: 'PATIENT_PROFILE_UPDATED',
          resourceType: 'patient_clinical_profile',
          resourceId: patient.id,
          meta: { count: allergies.length },
        });
        return { data: { allergies } };
      },
    }),
  ];
}
