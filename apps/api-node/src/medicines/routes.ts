// /api/v1/medicines: read for every signed-in role, write for admins (FR-F5-01..05).
// Medicines are SHARED REFERENCE DATA, not clinic data (ADR-D23): there is no clinic filter, and in a multi-clinic
// deployment a separate platform-admin role would own the writes (Phase 12).
// Rules the routes keep:
//  - no route can set reviewed_on / reviewed_by (the request bodies are strict, and the database trigger forbids it too);
//  - an edit of the identifying or source fields clears the review (database trigger, migration 0006);
//  - rows are RETIRED, never deleted;
//  - snomed_code and atc_code are not accepted here: they come from the licensed-release loader only;
//  - audit rows carry ids and the NAMES OF CHANGED FIELDS, never values.
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { brandsFor, getMedicine, searchMedicines, toView, type MedicineRow } from './search.js';

const MAX_LIST = 50;
const text = (max: number) => z.string().trim().min(1).max(max);

const listQuery = z.object({
  /** Generic or brand name, any case, English or Gujarati. */
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  /** Admin only: also list retired rows. */
  includeRetired: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
type ListQuery = z.infer<typeof listQuery>;

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const brandParams = z.object({ id: z.uuid(), brandId: z.uuid() });
type BrandParams = z.infer<typeof brandParams>;

const fields = {
  genericName: text(200),
  strength: text(120).nullable(),
  doseForm: text(120).nullable(),
  route: text(80).nullable(),
  therapeuticCategory: text(300).nullable(),
  nlemYear: z.number().int().min(1990).max(2100).nullable(),
  source: text(300),
  sourcePage: z.number().int().min(1).max(10_000).nullable(),
  sourceNotes: text(1000).nullable(),
};
// strict(): a body that names snomedCode, atcCode, reviewedOn, reviewedBy (or anything else unknown) is a 400
const createBody = z
  .object({
    genericName: fields.genericName,
    source: fields.source,
    strength: fields.strength.optional(),
    doseForm: fields.doseForm.optional(),
    route: fields.route.optional(),
    therapeuticCategory: fields.therapeuticCategory.optional(),
    nlemYear: fields.nlemYear.optional(),
    sourcePage: fields.sourcePage.optional(),
    sourceNotes: fields.sourceNotes.optional(),
  })
  .strict();
type CreateBody = z.infer<typeof createBody>;
const updateBody = z
  .object({
    genericName: fields.genericName.optional(),
    source: fields.source.optional(),
    strength: fields.strength.optional(),
    doseForm: fields.doseForm.optional(),
    route: fields.route.optional(),
    therapeuticCategory: fields.therapeuticCategory.optional(),
    nlemYear: fields.nlemYear.optional(),
    sourcePage: fields.sourcePage.optional(),
    sourceNotes: fields.sourceNotes.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'send at least one field to change' });
type UpdateBody = z.infer<typeof updateBody>;
const brandBody = z
  .object({
    brandName: text(200),
    manufacturer: text(200).nullable().optional(),
    source: text(300),
  })
  .strict();
type BrandBody = z.infer<typeof brandBody>;

const brandView = z.object({
  id: z.uuid(),
  brandName: z.string(),
  manufacturer: z.string().nullable(),
  source: z.string(),
});
const medicineView = z.object({
  id: z.uuid(),
  genericName: z.string(),
  strength: z.string().nullable(),
  doseForm: z.string().nullable(),
  route: z.string().nullable(),
  therapeuticCategory: z.string().nullable(),
  nlemYear: z.number().nullable(),
  snomedCode: z.string().nullable(),
  atcCode: z.string().nullable(),
  source: z.string(),
  sourcePage: z.number().nullable(),
  nlemRef: z.string().nullable(),
  healthcareLevels: z.string().nullable(),
  sourceNotes: z.string().nullable(),
  alsoListedIn: z.array(z.string()),
  reviewStatus: z.enum(['reviewed', 'not_reviewed']),
  reviewedOn: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  retired: z.boolean(),
  brands: z.array(brandView),
  matchedOn: z.enum(['generic', 'brand']).optional(),
});

const COLUMN: Record<keyof CreateBody, string> = {
  genericName: 'generic_name',
  source: 'source',
  strength: 'strength',
  doseForm: 'dose_form',
  route: 'route',
  therapeuticCategory: 'therapeutic_category',
  nlemYear: 'nlem_year',
  sourcePage: 'source_page',
  sourceNotes: 'source_notes',
};

/** A unique-index violation (the same generic + dose form + strength + route already exists) is a 409, not a 500. */
const conflictOr = (err: unknown): never => {
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505')
    throw errors.conflict(
      'A medicine with this name, dose form, strength and route already exists',
    );
  throw err;
};

export function medicineRoutes(): RouteDef[] {
  return [
    permRoute<unknown, unknown, ListQuery>('medicine.read', {
      method: 'get',
      path: '/medicines',
      tag: 'Medicines',
      summary:
        'Search medicines by generic or brand name (case-insensitive, English or Gujarati); generic names rank first. Without q: alphabetical list.',
      audit: [],
      query: listQuery,
      response: z.object({
        items: z.array(medicineView),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
      }),
      handler: async (ctx) => {
        const includeRetired = ctx.query.includeRetired === true;
        if (includeRetired && ctx.auth.role !== 'admin')
          throw errors.forbidden('Only an admin can list retired medicines');
        const { items, total } = await searchMedicines(ctx.db, {
          q: ctx.query.q,
          limit: ctx.query.limit,
          offset: ctx.query.offset,
          includeRetired,
        });
        return { data: { items, total, limit: ctx.query.limit, offset: ctx.query.offset } };
      },
    }),

    permRoute<IdParams>('medicine.read', {
      method: 'get',
      path: '/medicines/:id',
      tag: 'Medicines',
      summary: 'Read one medicine with its source, review status and brands',
      audit: [],
      params: idParams,
      response: medicineView,
      handler: async (ctx) => {
        const view = await getMedicine(ctx.db, ctx.params.id);
        if (!view) throw errors.notFound('Medicine not found');
        return { data: view };
      },
    }),

    permRoute<unknown, CreateBody>('medicine.write', {
      method: 'post',
      path: '/medicines',
      tag: 'Medicines',
      summary: 'Admin: add a medicine (a source is required; it starts as not reviewed)',
      audit: ['MEDICINE_CREATED'],
      body: createBody,
      response: medicineView,
      successStatus: 201,
      handler: async (ctx) => {
        const b = ctx.body;
        const row = await ctx.db
          .query<MedicineRow>(
            `INSERT INTO medicine_master
               (generic_name, strength, dose_form, route, therapeutic_category, nlem_year, source, source_page, source_notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              b.genericName,
              b.strength ?? null,
              b.doseForm ?? null,
              b.route ?? null,
              b.therapeuticCategory ?? null,
              b.nlemYear ?? null,
              b.source,
              b.sourcePage ?? null,
              b.sourceNotes ?? null,
            ],
          )
          .catch(conflictOr);
        const created = row.rows[0];
        if (!created) throw new Error('medicine insert returned no row');
        await ctx.audit({
          action: 'MEDICINE_CREATED',
          resourceType: 'medicine',
          resourceId: created.id,
        });
        return { data: toView(created, []), status: 201 };
      },
    }),

    permRoute<IdParams, UpdateBody>('medicine.write', {
      method: 'patch',
      path: '/medicines/:id',
      tag: 'Medicines',
      summary:
        'Admin: edit a medicine. An edit clears any review (reviewed_on / reviewed_by become empty). Codes and review fields cannot be set here.',
      audit: ['MEDICINE_UPDATED'],
      params: idParams,
      body: updateBody,
      response: medicineView,
      handler: async (ctx) => {
        const entries = (Object.entries(ctx.body) as Array<[keyof CreateBody, unknown]>).filter(
          ([, v]) => v !== undefined,
        );
        const sets = entries.map(([k], i) => `${COLUMN[k]} = $${i + 2}`);
        const res = await ctx.db
          .query<MedicineRow>(
            `UPDATE medicine_master SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
            [ctx.params.id, ...entries.map(([, v]) => v)],
          )
          .catch(conflictOr);
        const row = res.rows[0];
        if (!row) throw errors.notFound('Medicine not found');
        await ctx.audit({
          action: 'MEDICINE_UPDATED',
          resourceType: 'medicine',
          resourceId: row.id,
          meta: { changedFields: entries.map(([k]) => k) },
        });
        return { data: toView(row, await brandsFor(ctx.db, [row.id])) };
      },
    }),

    ...(['retire', 'restore'] as const).map((verb) =>
      permRoute<IdParams>('medicine.write', {
        method: 'post',
        path: `/medicines/:id/${verb}`,
        tag: 'Medicines',
        summary:
          verb === 'retire'
            ? 'Admin: retire a medicine (it is hidden from search; rows are never deleted)'
            : 'Admin: restore a retired medicine',
        audit: [verb === 'retire' ? 'MEDICINE_RETIRED' : 'MEDICINE_RESTORED'],
        params: idParams,
        response: medicineView,
        handler: async (ctx) => {
          const res = await ctx.db.query<MedicineRow>(
            `UPDATE medicine_master SET retired_at = ${verb === 'retire' ? 'coalesce(retired_at, now())' : 'NULL'}
              WHERE id = $1 RETURNING *`,
            [ctx.params.id],
          );
          const row = res.rows[0];
          if (!row) throw errors.notFound('Medicine not found');
          await ctx.audit({
            action: verb === 'retire' ? 'MEDICINE_RETIRED' : 'MEDICINE_RESTORED',
            resourceType: 'medicine',
            resourceId: row.id,
          });
          return { data: toView(row, await brandsFor(ctx.db, [row.id])) };
        },
      }),
    ),

    permRoute<IdParams, BrandBody>('medicine.write', {
      method: 'post',
      path: '/medicines/:id/brands',
      tag: 'Medicines',
      summary: 'Admin: add a brand name to a medicine (optional child; a source is required)',
      audit: ['MEDICINE_BRAND_ADDED'],
      params: idParams,
      body: brandBody,
      response: medicineView,
      successStatus: 201,
      handler: async (ctx) => {
        if (!(await getMedicine(ctx.db, ctx.params.id)))
          throw errors.notFound('Medicine not found');
        const inserted = await ctx.db
          .query<{ id: string }>(
            `INSERT INTO medicine_brand (medicine_id, brand_name, manufacturer, source)
             VALUES ($1,$2,$3,$4) RETURNING id`,
            [ctx.params.id, ctx.body.brandName, ctx.body.manufacturer ?? null, ctx.body.source],
          )
          .catch(conflictOr);
        await ctx.audit({
          action: 'MEDICINE_BRAND_ADDED',
          resourceType: 'medicine_brand',
          resourceId: inserted.rows[0]?.id ?? null,
          meta: { medicineId: ctx.params.id },
        });
        const view = await getMedicine(ctx.db, ctx.params.id);
        if (!view) throw errors.notFound('Medicine not found');
        return { data: view, status: 201 };
      },
    }),

    permRoute<BrandParams>('medicine.write', {
      method: 'post',
      path: '/medicines/:id/brands/:brandId/retire',
      tag: 'Medicines',
      summary: 'Admin: retire a brand name (brands are never deleted)',
      audit: ['MEDICINE_BRAND_RETIRED'],
      params: brandParams,
      response: medicineView,
      handler: async (ctx) => {
        const res = await ctx.db.query<{ id: string }>(
          `UPDATE medicine_brand SET retired_at = coalesce(retired_at, now())
            WHERE id = $2 AND medicine_id = $1 RETURNING id`,
          [ctx.params.id, ctx.params.brandId],
        );
        if (!res.rows[0]) throw errors.notFound('Brand not found');
        await ctx.audit({
          action: 'MEDICINE_BRAND_RETIRED',
          resourceType: 'medicine_brand',
          resourceId: ctx.params.brandId,
          meta: { medicineId: ctx.params.id },
        });
        const view = await getMedicine(ctx.db, ctx.params.id);
        if (!view) throw errors.notFound('Medicine not found');
        return { data: view };
      },
    }),
  ];
}
