// Read-only evaluation benchmark run API (PG-17, Phase 11, ADR-D43).
// Researchers and admins can inspect generated benchmark outputs and manifests.
// Strictly read-only; no client edits, no patient data, no path traversal.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AppError, errors } from '../http/errors.js';
import { permRoute, type RouteDef } from '../http/routeRegistry.js';
import { loadPathwayDir, compareQuestionBaselines, type SlotValue } from '../pathways/rules.js';

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
  manifest: z.record(z.string(), z.unknown()),
  summaryMd: z.string(),
  tableTex: z.string(),
  cellsCsv: z.string(),
  casesCsv: z.string(),
  questionsCsv: z.string(),
  errorsCsv: z.string(),
});

const questionBaselinesShape = z.object({
  engines: z.array(z.string()),
  provider_mode: z.string(),
  synthetic_mock: z.boolean(),
  provider: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      condition_label: z.string(),
      description: z.string(),
      dialogue: z.array(
        z.object({ speaker: z.string(), text: z.string(), lang: z.string().optional() }),
      ),
      confirmed_slots: z.record(z.string(), z.unknown()),
      oracle_slots: z.record(z.string(), z.unknown()),
    }),
  ),
  available_slots: z.array(
    z.object({
      slot: z.string(),
      type: z.string(),
      choices: z.array(z.string()).optional(),
      label: z.string(),
    }),
  ),
});

const inspectQuestionsQueryShape = z.object({
  case_id: z.string().optional(),
  slots: z.string().optional(),
  lang: z.enum(['en', 'gu', 'hi']).default('en'),
});

type InspectQuestionsQuery = z.infer<typeof inspectQuestionsQueryShape>;

const questionBaselineComparisonShape = z.object({
  case_id: z.string(),
  context: z.record(z.string(), z.unknown()),
  rules_only: z.record(z.string(), z.unknown()),
  plain_llm: z.record(z.string(), z.unknown()),
  hybrid: z.record(z.string(), z.unknown()),
  provider_mode: z.string(),
  notes: z.string(),
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

const SYNTHETIC_RESEARCH_CASES = [
  {
    id: 'toy_synthetic01',
    title: 'Toy Condition A (Synthetic Case 1)',
    condition_label: 'toy_condition_a',
    description: 'Patient with toy symptom 1, mild choice, no red flags',
    dialogue: [
      { speaker: 'doctor' as const, text: 'Hello, what is the problem?' },
      { speaker: 'patient' as const, text: 'I have toy symptom one since two days.' },
      { speaker: 'patient' as const, text: 'I have no toy symptom five.' },
    ],
    confirmed_slots: { toy_symptom_1: true, toy_symptom_5: false },
    oracle_slots: {
      toy_symptom_1: true,
      toy_symptom_2: true,
      toy_symptom_5: false,
      toy_choice_1: 'z',
    },
  },
  {
    id: 'toy_synthetic02',
    title: 'Toy Condition B (Red Flag)',
    condition_label: 'toy_condition_b',
    description: 'Patient presenting with severe toy red flag 1',
    dialogue: [
      { speaker: 'doctor' as const, text: 'Do you have any severe warning signs?' },
      { speaker: 'patient' as const, text: 'Yes, I am experiencing toy redflag one severely!' },
    ],
    confirmed_slots: { toy_redflag_1: true },
    oracle_slots: { toy_redflag_1: true },
  },
  {
    id: 'toy_synthetic03',
    title: 'Toy Condition C (Choice / Abstain Check)',
    condition_label: 'toy_condition_c',
    description: 'Patient with symptom 3 and alternative choice',
    dialogue: [
      { speaker: 'doctor' as const, text: 'Any other symptoms?' },
      { speaker: 'patient' as const, text: 'I have toy symptom three.' },
    ],
    confirmed_slots: { toy_symptom_3: true },
    oracle_slots: { toy_symptom_3: true, toy_choice_1: 'x' },
  },
];

const AVAILABLE_RESEARCH_SLOTS = [
  { slot: 'toy_symptom_1', type: 'boolean', label: 'Toy Symptom 1' },
  { slot: 'toy_symptom_2', type: 'boolean', label: 'Toy Symptom 2' },
  { slot: 'toy_symptom_3', type: 'boolean', label: 'Toy Symptom 3' },
  { slot: 'toy_symptom_4', type: 'boolean', label: 'Toy Symptom 4' },
  { slot: 'toy_symptom_5', type: 'boolean', label: 'Toy Symptom 5' },
  { slot: 'toy_redflag_1', type: 'boolean', label: 'Toy Red Flag 1' },
  { slot: 'toy_choice_1', type: 'choice', choices: ['x', 'y', 'z'], label: 'Toy Choice 1' },
];

function getToyPathwaysDir(): string {
  const root = findRepoRoot();
  return join(root, 'packages', 'rules', 'fixtures', 'pathways', '_toy');
}

export function evalRoutes(): RouteDef[] {
  return [
    permRoute('eval.read', {
      method: 'get',
      path: '/eval/questions/baselines',
      tag: 'Evaluation',
      summary:
        'Admin or researcher: list available research question baseline cases and provider status (read only)',
      audit: [],
      response: questionBaselinesShape,
      handler: async () => {
        return {
          data: {
            engines: ['rules-only', 'llm-only', 'hybrid'],
            provider_mode: 'mock',
            synthetic_mock: true,
            provider: 'deterministic-mock',
            cases: SYNTHETIC_RESEARCH_CASES,
            available_slots: AVAILABLE_RESEARCH_SLOTS,
          },
        };
      },
    }),

    permRoute<Record<string, never>, unknown, InspectQuestionsQuery>('eval.read', {
      method: 'get',
      path: '/eval/questions/inspect',
      tag: 'Evaluation',
      summary:
        'Admin or researcher: compare question engine baselines side-by-side for a case (read only, research only)',
      audit: [],
      query: inspectQuestionsQueryShape,
      response: questionBaselineComparisonShape,
      handler: async (ctx) => {
        const toyDir = getToyPathwaysDir();
        const loaded = loadPathwayDir(toyDir, { allowTest: true, requireLock: false });
        if (loaded.problems.length > 0) {
          throw new AppError(
            'INTERNAL',
            `Toy research pathways failed to load: ${loaded.problems.join(', ')}`,
            500,
          );
        }

        const caseId = ctx.query.case_id || 'toy_synthetic01';
        const matched = SYNTHETIC_RESEARCH_CASES.find((c) => c.id === caseId);

        let confirmedSlots: Record<string, SlotValue> = matched
          ? { ...(matched.confirmed_slots as unknown as Record<string, SlotValue>) }
          : {};
        if (ctx.query.slots) {
          try {
            const parsed = JSON.parse(ctx.query.slots);
            if (typeof parsed === 'object' && parsed !== null) {
              confirmedSlots = {
                ...confirmedSlots,
                ...(parsed as unknown as Record<string, SlotValue>),
              };
            }
          } catch {
            // retain default slots
          }
        }

        const comparison = await compareQuestionBaselines(
          {
            case_id: caseId,
            confirmed_slots: confirmedSlots,
            dialogue: matched?.dialogue ?? [],
            lang: ctx.query.lang || 'en',
          },
          loaded.pathways,
        );
        return { data: comparison as unknown as z.infer<typeof questionBaselineComparisonShape> };
      },
    }),
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
