// Read-only evaluation benchmark run API (PG-17, Phase 11, ADR-D43).
// Researchers and admins can inspect generated benchmark outputs and manifests.
// Strictly read-only; no client edits, no patient data, no path traversal.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';

const RUN_ID_RE = /^([0-9]{8}T[0-9]{6}|sample-results)$/;
const idParams = z.object({ id: z.string().regex(RUN_ID_RE) });
type IdParams = z.infer<typeof idParams>;

const runSummaryShape = z.object({
  id: z.string(),
  runAt: z.string().nullable(),
  split: z.string().nullable(),
  datasetHash: z.string().nullable(),
  codeCommit: z.string().nullable(),
  casesCount: z.number(),
  hasErrorsCsv: z.boolean(),
});

const runDetailShape = z.object({
  id: z.string(),
  manifest: z.record(z.unknown()),
  summaryMd: z.string(),
  tableTex: z.string(),
  cellsCsv: z.string(),
  casesCsv: z.string(),
  questionsCsv: z.string(),
  errorsCsv: z.string(),
});

function findRepoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(cur, 'apps', 'api-node')) && existsSync(join(cur, 'bench'))) {
      return cur;
    }
    const parent = resolve(cur, '..');
    if (parent === cur) break;
    cur = parent;
  }
  return resolve(process.cwd(), '..', '..');
}

function getCandidateFolders(): { id: string; path: string }[] {
  const root = findRepoRoot();
  const resultsDir = join(root, 'results');
  const sampleDir = join(root, 'bench', 'sample-results');
  const folders: { id: string; path: string }[] = [];

  if (existsSync(resultsDir)) {
    try {
      const entries = readdirSync(resultsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory() && RUN_ID_RE.test(ent.name)) {
          folders.push({ id: ent.name, path: join(resultsDir, ent.name) });
        }
      }
    } catch {
      // directory read failure handled gracefully
    }
  }

  if (existsSync(sampleDir) && !folders.some((f) => f.id === 'sample-results')) {
    folders.push({ id: 'sample-results', path: sampleDir });
  }

  return folders.sort((a, b) => b.id.localeCompare(a.id));
}

function resolveRunPath(id: string): string | null {
  if (!RUN_ID_RE.test(id)) return null;
  const root = findRepoRoot();
  const resultsDir = resolve(root, 'results');
  const candidateResults = resolve(resultsDir, id);
  if (candidateResults.startsWith(resultsDir) && existsSync(candidateResults)) {
    return candidateResults;
  }
  if (id === 'sample-results') {
    const candidateSample = resolve(root, 'bench', 'sample-results');
    if (existsSync(candidateSample)) return candidateSample;
  }
  return null;
}

function safeRead(folder: string, filename: string): string {
  const filePath = resolve(folder, filename);
  if (!filePath.startsWith(folder) || !existsSync(filePath)) return '';
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export function evalRoutes(): RouteDef[] {
  return [
    permRoute('eval.read', {
      method: 'get',
      path: '/eval/runs',
      tag: 'Evaluation',
      summary: 'Admin or researcher: list available benchmark evaluation runs (read only)',
      audit: [],
      response: z.array(runSummaryShape),
      handler: async () => {
        const folders = getCandidateFolders();
        const runs = folders.map((f) => {
          let manifest: Record<string, unknown> = {};
          const manifestRaw = safeRead(f.path, 'manifest.json');
          if (manifestRaw) {
            try {
              manifest = JSON.parse(manifestRaw);
            } catch {
              manifest = {};
            }
          }
          const cases = Array.isArray(manifest.cases) ? manifest.cases.length : 0;
          const hasErrors = existsSync(join(f.path, 'errors.csv'));
          return {
            id: f.id,
            runAt: typeof manifest.run_at === 'string' ? manifest.run_at : null,
            split: typeof manifest.split === 'string' ? manifest.split : null,
            datasetHash: typeof manifest.dataset_hash === 'string' ? manifest.dataset_hash : null,
            codeCommit: typeof manifest.code_commit === 'string' ? manifest.code_commit : null,
            casesCount: cases,
            hasErrorsCsv: hasErrors,
          };
        });
        return { data: runs };
      },
    }),

    permRoute<IdParams>('eval.read', {
      method: 'get',
      path: '/eval/runs/:id',
      tag: 'Evaluation',
      summary: 'Admin or researcher: full benchmark outputs and manifest for one run (read only)',
      audit: [],
      params: idParams,
      response: runDetailShape,
      handler: async (ctx) => {
        const folder = resolveRunPath(ctx.params.id);
        if (!folder) throw errors.notFound('Evaluation run not found');

        let manifest: Record<string, unknown> = {};
        const manifestRaw = safeRead(folder, 'manifest.json');
        if (manifestRaw) {
          try {
            manifest = JSON.parse(manifestRaw);
          } catch {
            manifest = {};
          }
        }

        return {
          data: {
            id: ctx.params.id,
            manifest,
            summaryMd: safeRead(folder, 'summary.md'),
            tableTex: safeRead(folder, 'table.tex'),
            cellsCsv: safeRead(folder, 'cells.csv'),
            casesCsv: safeRead(folder, 'cases.csv'),
            questionsCsv: safeRead(folder, 'questions.csv'),
            errorsCsv: safeRead(folder, 'errors.csv'),
          },
        };
      },
    }),
  ];
}
