// /api/v1/templates: clinic-scoped prescription templates (FR-F5-04, PG-13).
// Doctors and admins may read and write (permission table in permissions.ts; ADR-D24). Visibility is personal or
// clinic-wide, see service.ts for the rules. "Load" returns the items ready to drop into a prescription, flags an item
// whose medicine has been retired, and never drops or replaces one.
// Audit rows carry ids, counts, the visibility and the NAMES of changed fields, never the template's text.
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { FREQUENCY_CODES } from './frequency.js';
import {
  checkMedicines,
  clinicOf,
  itemsOf,
  itemsSignature,
  mustEdit,
  replaceItems,
  templateDetail,
  toSummaries,
  visibleTemplate,
  VISIBLE_SQL,
  type ItemInput,
  type TemplateRow,
} from './service.js';

const MAX_LIST = 50;
const text = (max: number) => z.string().trim().min(1).max(max);
/** Optional free text: an empty string means "not given". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const itemBody = z
  .object({
    medicineId: z.uuid(),
    dose: optionalText(120),
    /** A code from the controlled list; never free text. */
    frequency: z.enum(FREQUENCY_CODES).nullable().optional(),
    duration: optionalText(120),
    instructions: optionalText(500),
  })
  .strict();
const templateBody = z
  .object({
    name: text(120),
    visibility: z.enum(['personal', 'clinic']),
    items: z.array(itemBody).min(1).max(40),
  })
  .strict();
type TemplateBody = z.infer<typeof templateBody>;

const listQuery = z.object({
  /** all = everything I may see; mine = I own it; clinic = clinic-wide. */
  scope: z.enum(['all', 'mine', 'clinic']).default('all'),
  includeRetired: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
type ListQuery = z.infer<typeof listQuery>;
const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;

const medicineBrief = z.object({
  id: z.uuid(),
  genericName: z.string(),
  strength: z.string().nullable(),
  doseForm: z.string().nullable(),
  route: z.string().nullable(),
  source: z.string(),
  sourcePage: z.number().nullable(),
  sourcePagePrinted: z.number().nullable(),
  reviewStatus: z.enum(['reviewed', 'not_reviewed']),
  retired: z.boolean(),
});
const itemView = z.object({
  id: z.uuid(),
  position: z.number(),
  medicine: medicineBrief,
  dose: z.string().nullable(),
  frequency: z.enum(FREQUENCY_CODES).nullable(),
  duration: z.string().nullable(),
  instructions: z.string().nullable(),
  medicineRetired: z.boolean(),
});
const summaryView = z.object({
  id: z.uuid(),
  name: z.string(),
  visibility: z.enum(['personal', 'clinic']),
  ownerId: z.uuid(),
  ownerName: z.string().nullable(),
  ownedByMe: z.boolean(),
  itemCount: z.number(),
  retired: z.boolean(),
  updatedAt: z.string(),
  canEdit: z.boolean(),
});
const detailView = summaryView.extend({ items: z.array(itemView) });
const loadView = z.object({
  template: z.object({
    id: z.uuid(),
    name: z.string(),
    visibility: z.enum(['personal', 'clinic']),
  }),
  items: z.array(
    z.object({
      position: z.number(),
      medicine: medicineBrief,
      dose: z.string().nullable(),
      frequency: z.enum(FREQUENCY_CODES).nullable(),
      duration: z.string().nullable(),
      instructions: z.string().nullable(),
      /** null, or why this line must be looked at before it is used. */
      problem: z.enum(['MEDICINE_RETIRED']).nullable(),
    }),
  ),
  warnings: z.array(
    z.object({ position: z.number(), code: z.enum(['MEDICINE_RETIRED']), medicineId: z.uuid() }),
  ),
  hasRetiredMedicine: z.boolean(),
});

const asInputs = (items: TemplateBody['items']): ItemInput[] => items;

export function templateRoutes(): RouteDef[] {
  return [
    permRoute<unknown, unknown, ListQuery>('template.read', {
      method: 'get',
      path: '/templates',
      tag: 'Templates',
      summary:
        'List the templates the caller may see: their own and the clinic-wide ones of their clinic',
      audit: [],
      query: listQuery,
      response: z.object({
        items: z.array(summaryView),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
      }),
      handler: async (ctx) => {
        const q = ctx.query;
        const r = await ctx.db.query<TemplateRow & { item_count: number; total: string }>(
          `SELECT t.*, (SELECT count(*)::int FROM med_template_item i WHERE i.template_id = t.id) AS item_count,
                  count(*) OVER () AS total
             FROM med_template t
            WHERE ${VISIBLE_SQL}
              AND ($3 OR t.retired_at IS NULL)
              AND ($4 = 'all' OR ($4 = 'mine' AND t.owner_user_id = $2) OR ($4 = 'clinic' AND t.visibility = 'clinic'))
            ORDER BY lower(t.name), t.id LIMIT $5 OFFSET $6`,
          [clinicOf(ctx.auth), ctx.auth.sub, q.includeRetired === true, q.scope, q.limit, q.offset],
        );
        return {
          data: {
            items: await toSummaries(ctx.db, ctx.services.directory, ctx.auth, r.rows),
            total: Number(r.rows[0]?.total ?? 0),
            limit: q.limit,
            offset: q.offset,
          },
        };
      },
    }),

    permRoute<IdParams>('template.read', {
      method: 'get',
      path: '/templates/:id',
      tag: 'Templates',
      summary: 'Read one template with its ordered items',
      audit: [],
      params: idParams,
      response: detailView,
      handler: async (ctx) => {
        const row = await visibleTemplate(ctx.db, ctx.auth, ctx.params.id);
        if (!row) throw errors.notFound('Template not found');
        return { data: await templateDetail(ctx.db, ctx.services.directory, ctx.auth, row) };
      },
    }),

    permRoute<IdParams>('template.read', {
      method: 'get',
      path: '/templates/:id/load',
      tag: 'Templates',
      summary:
        'Load a template: its items in order, ready to drop into a prescription. An item whose medicine has been retired is returned and flagged (MEDICINE_RETIRED), never dropped or replaced.',
      audit: [],
      params: idParams,
      response: loadView,
      handler: async (ctx) => {
        const row = await visibleTemplate(ctx.db, ctx.auth, ctx.params.id);
        if (!row) throw errors.notFound('Template not found');
        if (row.retired_at !== null) throw errors.conflict('This template is retired');
        const items = await itemsOf(ctx.db, row.id);
        const lines = items.map((i) => ({
          position: i.position,
          medicine: i.medicine,
          dose: i.dose,
          frequency: i.frequency,
          duration: i.duration,
          instructions: i.instructions,
          problem: i.medicineRetired ? ('MEDICINE_RETIRED' as const) : null,
        }));
        const warnings = items
          .filter((i) => i.medicineRetired)
          .map((i) => ({
            position: i.position,
            code: 'MEDICINE_RETIRED' as const,
            medicineId: i.medicine.id,
          }));
        return {
          data: {
            template: { id: row.id, name: row.name, visibility: row.visibility },
            items: lines,
            warnings,
            hasRetiredMedicine: warnings.length > 0,
          },
        };
      },
    }),

    permRoute<unknown, TemplateBody>('template.write', {
      method: 'post',
      path: '/templates',
      tag: 'Templates',
      summary: 'Create a template (personal or clinic-wide) with at least one item',
      audit: ['TEMPLATE_CREATED'],
      body: templateBody,
      response: detailView,
      successStatus: 201,
      handler: async (ctx) => {
        const b = ctx.body;
        const clinicId = clinicOf(ctx.auth);
        await checkMedicines(
          ctx.db,
          b.items.map((i) => i.medicineId),
          new Set(),
        );
        const created = await ctx.db.query<TemplateRow>(
          `INSERT INTO med_template (name, owner_user_id, clinic_id, visibility)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [b.name, ctx.auth.sub, clinicId, b.visibility],
        );
        const row = created.rows[0];
        if (!row) throw new Error('template insert returned no row');
        await replaceItems(ctx.db, row.id, asInputs(b.items));
        await ctx.audit({
          action: 'TEMPLATE_CREATED',
          resourceType: 'template',
          resourceId: row.id,
          meta: { itemCount: b.items.length, visibility: b.visibility },
        });
        return {
          data: await templateDetail(ctx.db, ctx.services.directory, ctx.auth, row),
          status: 201,
        };
      },
    }),

    permRoute<IdParams, TemplateBody>('template.write', {
      method: 'put',
      path: '/templates/:id',
      tag: 'Templates',
      summary:
        'Replace a template (name, visibility, items). Its owner may edit it; an admin may edit a clinic-wide one; only the owner can change its visibility.',
      audit: ['TEMPLATE_UPDATED'],
      params: idParams,
      body: templateBody,
      response: detailView,
      handler: async (ctx) => {
        const b = ctx.body;
        const row = await visibleTemplate(ctx.db, ctx.auth, ctx.params.id);
        if (!row) throw errors.notFound('Template not found');
        mustEdit(row, ctx.auth);
        if (b.visibility !== row.visibility && row.owner_user_id !== ctx.auth.sub)
          throw errors.forbidden('Only the owner can change who can see a template');
        const before = await itemsOf(ctx.db, row.id);
        await checkMedicines(
          ctx.db,
          b.items.map((i) => i.medicineId),
          new Set(before.map((i) => i.medicine.id)),
        );
        const changedFields = [
          ...(b.name !== row.name ? ['name'] : []),
          ...(b.visibility !== row.visibility ? ['visibility'] : []),
          ...(itemsSignature(asInputs(b.items)) !==
          itemsSignature(
            before.map((i) => ({
              medicineId: i.medicine.id,
              dose: i.dose,
              frequency: i.frequency,
              duration: i.duration,
              instructions: i.instructions,
            })),
          )
            ? ['items']
            : []),
        ];
        const updated = await ctx.db.query<TemplateRow>(
          `UPDATE med_template SET name = $2, visibility = $3, updated_at = now() WHERE id = $1 RETURNING *`,
          [row.id, b.name, b.visibility],
        );
        await replaceItems(ctx.db, row.id, asInputs(b.items));
        await ctx.audit({
          action: 'TEMPLATE_UPDATED',
          resourceType: 'template',
          resourceId: row.id,
          meta: { changedFields, itemCount: b.items.length, visibility: b.visibility },
        });
        const fresh = updated.rows[0] ?? row;
        return { data: await templateDetail(ctx.db, ctx.services.directory, ctx.auth, fresh) };
      },
    }),

    ...(['retire', 'restore'] as const).map((verb) =>
      permRoute<IdParams>('template.write', {
        method: 'post',
        path: `/templates/:id/${verb}`,
        tag: 'Templates',
        summary:
          verb === 'retire'
            ? 'Retire a template (hidden from the default list and not loadable; never deleted)'
            : 'Restore a retired template',
        audit: [verb === 'retire' ? 'TEMPLATE_RETIRED' : 'TEMPLATE_RESTORED'],
        params: idParams,
        response: detailView,
        handler: async (ctx) => {
          const row = await visibleTemplate(ctx.db, ctx.auth, ctx.params.id);
          if (!row) throw errors.notFound('Template not found');
          mustEdit(row, ctx.auth);
          const updated = await ctx.db.query<TemplateRow>(
            `UPDATE med_template SET retired_at = ${verb === 'retire' ? 'coalesce(retired_at, now())' : 'NULL'},
                    updated_at = now() WHERE id = $1 RETURNING *`,
            [row.id],
          );
          await ctx.audit({
            action: verb === 'retire' ? 'TEMPLATE_RETIRED' : 'TEMPLATE_RESTORED',
            resourceType: 'template',
            resourceId: row.id,
          });
          return {
            data: await templateDetail(
              ctx.db,
              ctx.services.directory,
              ctx.auth,
              updated.rows[0] ?? row,
            ),
          };
        },
      }),
    ),
  ];
}
