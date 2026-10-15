// Builds the OpenAPI 3.0 document from the route registry (the same data that drives RBAC, audit coverage and routing),
// using zod's built-in JSON Schema export. The committed file apps/api-node/openapi.json must equal this output;
// a test fails when it is stale (run `npm run openapi` to regenerate).
import { z, type ZodType } from 'zod';
import { PERMISSIONS } from '../auth/permissions.js';
import type { RouteDef } from '../http/routeRegistry.js';
import { API_PREFIX } from '../routes/index.js';

type JsonObject = Record<string, unknown>;

const schemaOf = (schema: ZodType, io: 'input' | 'output'): JsonObject => {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as JsonObject;
  delete json['$schema'];
  return json;
};

const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const errorResponse = (description: string): JsonObject => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
});

function parametersOf(def: RouteDef): JsonObject[] {
  const out: JsonObject[] = [];
  const add = (where: 'path' | 'query', schema: ZodType | undefined) => {
    if (!schema) return;
    const json = schemaOf(schema, 'input');
    const props = (json['properties'] ?? {}) as Record<string, JsonObject>;
    const required = new Set((json['required'] ?? []) as string[]);
    for (const [name, prop] of Object.entries(props)) {
      out.push({ name, in: where, required: where === 'path' || required.has(name), schema: prop });
    }
  };
  add('path', def.params);
  add('query', def.query);
  return out;
}

export function buildOpenApi(defs: readonly RouteDef[]): JsonObject {
  const paths: Record<string, JsonObject> = {};
  for (const def of defs) {
    const key = toOpenApiPath(def.path);
    const op: JsonObject = {
      tags: [def.tag],
      summary: def.summary,
      operationId: `${def.method}${key.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ?? '').toUpperCase())}`,
    };
    const params = parametersOf(def);
    if (params.length > 0) op['parameters'] = params;
    if (def.body) {
      op['requestBody'] = {
        required: true,
        content: { 'application/json': { schema: schemaOf(def.body, 'input') } },
      };
    }

    const dataSchema = def.response ? schemaOf(def.response, 'output') : {};
    const successResponse: JsonObject =
      def.responseType === 'csv'
        ? {
            description:
              'CSV file (RFC 4180). Text cells that could run as spreadsheet formulas are neutralised.',
            headers: {
              'Content-Disposition': { schema: { type: 'string' } },
              'X-Exported-Rows': { schema: { type: 'integer' } },
              'X-Export-Truncated': { schema: { type: 'boolean' } },
            },
            content: { 'text/csv': { schema: { type: 'string' } } },
          }
        : {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: { success: { type: 'boolean', enum: [true] }, data: dataSchema },
                },
              },
            },
          };
    const responses: JsonObject = { [String(def.successStatus)]: successResponse };
    if (def.body || def.query || def.params) responses['400'] = errorResponse('Validation error');
    if (def.access.kind !== 'public') responses['401'] = errorResponse('Not authenticated');
    if (def.access.kind === 'permission') responses['403'] = errorResponse('Role not permitted');
    if (def.params) responses['404'] = errorResponse('Not found (or not visible to the caller)');
    if (def.pre.length > 0) responses['429'] = errorResponse('Rate limited or account locked');
    op['responses'] = responses;

    if (def.access.kind === 'public') op['security'] = [];
    else op['security'] = [{ bearerAuth: [] }];
    if (def.access.kind === 'permission') {
      op['x-permission'] = def.access.permission;
      op['x-allowed-roles'] = [...PERMISSIONS[def.access.permission]];
    }
    if (def.audit.length > 0) op['x-audit-actions'] = [...def.audit];

    (paths[key] ??= {})[def.method] = op;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'VaaniEHR API',
      version: '0.2.0',
      description:
        'Research prototype. Simulated data only. Standalone mode: access token about 1 hour, no refresh token (ADR-D4). ' +
        'Generated from the route registry; do not edit by hand (npm run openapi).',
    },
    servers: [{ url: API_PREFIX }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        ErrorEnvelope: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { type: 'boolean', enum: [false] },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
      },
    },
  };
}

export const serialiseOpenApi = (doc: JsonObject): string => `${JSON.stringify(doc, null, 2)}\n`;
