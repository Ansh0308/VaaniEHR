// Prescription endpoints (PG-08, Phase 8 Run 1). Doctor only, the session's own doctor, clinic-scoped, audited (ids and
// counts only). Editable until the visit is signed: the registry refuses changes to a signed session (`lockedWhenSigned`)
// and a database trigger refuses them as well. No suggestion, no check, no dose guidance.
// Consent: prescribing needs no AI processing, so a withdrawn audio/AI consent does NOT stop the doctor from prescribing
// (PRD NFR-REL-02: the manual path always works). Consent matters at signing, where AI content is part of the record.
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadSession } from '../sessions/service.js';
import { itemsOf, visibleTemplate } from '../templates/service.js';
import {
  insertRow,
  listRows,
  oneRow,
  resolveRow,
  rowInput,
  rowPatch,
  rowView,
  type RowInput,
  type RowPatch,
} from './service.js';

const idParams = z.object({ id: z.uuid() });
type IdParams = z.infer<typeof idParams>;
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });
type ItemParams = z.infer<typeof itemParams>;
const templateBody = z.object({ templateId: z.uuid() }).strict();
type TemplateBody = z.infer<typeof templateBody>;
const listShape = z.object({ rows: z.array(rowView), locked: z.boolean() });

export function prescriptionRoutes(): RouteDef[] {
  return [
    permRoute<IdParams>('prescription.read', {
      method: 'get',
      path: '/sessions/:id/prescription',
      tag: 'Prescription',
      summary: "Doctor: the prescription rows of one of the doctor's own sessions",
      audit: [],
      params: idParams,
      response: listShape,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const signed = await ctx.db.query(
          "SELECT 1 FROM visit_record WHERE session_id = $1 AND status = 'signed'",
          [session.id],
        );
        return {
          data: { rows: await listRows(ctx.db, session.id), locked: (signed.rowCount ?? 0) > 0 },
        };
      },
    }),

    permRoute<IdParams, RowInput>('prescription.write', {
      method: 'post',
      path: '/sessions/:id/prescription/items',
      tag: 'Prescription',
      summary:
        'Doctor: add a medicine row from the master list, or a flagged free-text row ("Not in master list")',
      audit: ['PRESCRIPTION_ITEM_ADDED'],
      lockedWhenSigned: true,
      params: idParams,
      body: rowInput,
      response: rowView,
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const row = await resolveRow(ctx.db, ctx.body);
        const id = await insertRow(ctx.db, {
          sessionId: session.id,
          clinicId: session.clinicId,
          doctorId: ctx.auth.sub,
          row,
        });
        await ctx.audit({
          action: 'PRESCRIPTION_ITEM_ADDED',
          resourceType: 'prescription_item',
          resourceId: id,
          sessionId: session.id,
          meta: { source: row.source },
        });
        const view = await oneRow(ctx.db, session.id, id);
        if (!view) throw new Error('row missing after insert');
        return { data: view, status: 201 };
      },
    }),

    permRoute<ItemParams, RowPatch>('prescription.write', {
      method: 'patch',
      path: '/sessions/:id/prescription/items/:itemId',
      tag: 'Prescription',
      summary: 'Doctor: change a field of a row (every field can be edited until signing)',
      audit: ['PRESCRIPTION_ITEM_EDITED'],
      lockedWhenSigned: true,
      params: itemParams,
      body: rowPatch,
      response: rowView,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const current = await oneRow(ctx.db, session.id, ctx.params.itemId);
        if (!current) throw errors.notFound('Row not found');
        const b = ctx.body;
        if (b.name !== undefined && current.source === 'master') {
          throw errors.validation(
            'The name of a master-list medicine cannot be changed; remove the row instead',
          );
        }
        const pick = <K extends keyof RowPatch>(k: K, old: string | null): string | null =>
          b[k] === undefined ? old : (b[k] as string | null)?.trim() || null;
        await ctx.db.query(
          `UPDATE prescription_item SET name = $3, strength = $4, dose_form = $5, dose = $6, frequency = $7,
                  duration = $8, note = $9, updated_at = now() WHERE id = $1 AND session_id = $2`,
          [
            current.id,
            session.id,
            b.name === undefined ? current.name : b.name.trim(),
            pick('strength', current.strength),
            pick('doseForm', current.doseForm),
            pick('dose', current.dose),
            b.frequency ?? current.frequency,
            b.duration === undefined ? current.duration : b.duration.trim(),
            pick('note', current.note),
          ],
        );
        await ctx.audit({
          action: 'PRESCRIPTION_ITEM_EDITED',
          resourceType: 'prescription_item',
          resourceId: current.id,
          sessionId: session.id,
          meta: { fieldCount: Object.keys(b).length },
        });
        const view = await oneRow(ctx.db, session.id, current.id);
        if (!view) throw new Error('row missing after update');
        return { data: view };
      },
    }),

    permRoute<ItemParams>('prescription.write', {
      method: 'delete',
      path: '/sessions/:id/prescription/items/:itemId',
      tag: 'Prescription',
      summary: 'Doctor: remove a row (until the visit is signed)',
      audit: ['PRESCRIPTION_ITEM_REMOVED'],
      lockedWhenSigned: true,
      params: itemParams,
      response: z.object({ removed: z.literal(true) }),
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const gone = await ctx.db.query(
          'DELETE FROM prescription_item WHERE id = $1 AND session_id = $2',
          [ctx.params.itemId, session.id],
        );
        if ((gone.rowCount ?? 0) === 0) throw errors.notFound('Row not found');
        await ctx.audit({
          action: 'PRESCRIPTION_ITEM_REMOVED',
          resourceType: 'prescription_item',
          resourceId: ctx.params.itemId,
          sessionId: session.id,
          meta: {},
        });
        return { data: { removed: true as const } };
      },
    }),

    permRoute<IdParams, TemplateBody>('prescription.write', {
      method: 'post',
      path: '/sessions/:id/prescription/apply-template',
      tag: 'Prescription',
      summary:
        'Doctor: add the lines of a template the doctor may see as rows (then edit any field). Retired medicines are skipped and counted',
      audit: ['PRESCRIPTION_TEMPLATE_APPLIED'],
      lockedWhenSigned: true,
      params: idParams,
      body: templateBody,
      response: z.object({ rows: z.array(rowView), added: z.number(), skippedRetired: z.number() }),
      successStatus: 201,
      handler: async (ctx) => {
        const session = await loadSession(ctx.db, ctx.auth, ctx.params.id);
        if (!session) throw errors.notFound('Session not found');
        const template = await visibleTemplate(ctx.db, ctx.auth, ctx.body.templateId);
        if (!template) throw errors.notFound('Template not found');
        if (template.retired_at) throw errors.conflict('That template is retired');
        const items = await itemsOf(ctx.db, template.id);
        let added = 0;
        let skipped = 0;
        for (const item of items) {
          if (item.medicineRetired) {
            skipped += 1;
            continue;
          }
          // what the template holds is copied as it is; a missing frequency or duration stays empty and is flagged
          await insertRow(ctx.db, {
            sessionId: session.id,
            clinicId: session.clinicId,
            doctorId: ctx.auth.sub,
            fromTemplateId: template.id,
            row: {
              medicineId: item.medicine.id,
              name: item.medicine.genericName,
              source: 'master',
              strength: item.medicine.strength,
              doseForm: item.medicine.doseForm,
              dose: item.dose,
              frequency: item.frequency as never,
              duration: item.duration as never,
              note: item.instructions,
            },
          });
          added += 1;
        }
        await ctx.audit({
          action: 'PRESCRIPTION_TEMPLATE_APPLIED',
          resourceType: 'med_template',
          resourceId: template.id,
          sessionId: session.id,
          meta: { addedCount: added, skippedRetiredCount: skipped },
        });
        return {
          data: { rows: await listRows(ctx.db, session.id), added, skippedRetired: skipped },
          status: 201,
        };
      },
    }),
  ];
}
