// Pathway lint (Phase 6B): what is still missing before a pathway can be signed off. Pure. It reuses the validator for
// structure, references, reachability, localized text and forbidden wording, and adds the authoring checks:
//   - every node should carry source_quote and page (error for draft and active, warning for test pathways)
//   - terminals need the PRD 7.1 `refer` flag (same levels). Treatment content (first-line options) is Phase 7: not checked
//   - a question without a concept_id is only a warning (concept ids wait for the reviewed word list, OCI-017)
//   - placeholder text ("TODO...") left in the source block or in a quote
import { validatePathway } from './validate.js';

export interface LintFinding {
  level: 'error' | 'warning';
  message: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const placeholder = (v: unknown): boolean => typeof v === 'string' && /^\s*TODO/i.test(v);

export function lintPathway(raw: unknown): LintFinding[] {
  const found: LintFinding[] = [];
  const add = (level: LintFinding['level'], message: string) => {
    if (!found.some((f) => f.message === message)) found.push({ level, message });
  };
  for (const e of validatePathway(raw, 'pathway').errors) add('error', e);
  if (!isObj(raw)) return found;
  const exempt = raw.status === 'test'; // fake test content is allowed to be incomplete
  const gap: LintFinding['level'] = exempt ? 'warning' : 'error';
  const id = typeof raw.id === 'string' ? raw.id : '?';
  const source = isObj(raw.source) ? raw.source : {};
  for (const key of ['doc', 'page', 'reviewed_by', 'reviewed_on']) {
    if (placeholder(source[key])) {
      add(
        raw.status === 'active' ? 'error' : 'warning',
        `${id}: source.${key} is still a placeholder`,
      );
    }
  }
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (!isObj(n) || typeof n.id !== 'string') continue;
    const where = `${id} node ${n.id}`;
    if (!text(n.source_quote))
      add(gap, `${where}: no source_quote (the exact sentence from the source)`);
    else if (placeholder(n.source_quote)) add(gap, `${where}: source_quote is still a placeholder`);
    if (!(text(n.page) || typeof n.page === 'number')) add(gap, `${where}: no page`);
    if (n.type === 'terminal' && typeof n.refer !== 'boolean') {
      add(gap, `${where}: terminal is missing the refer flag (PRD 7.1)`);
    }
    if (n.type === 'question' && !text(n.concept_id)) {
      add(
        'warning',
        `${where}: no concept_id (internal concept id; waits for the reviewed word list)`,
      );
    }
  }
  return found.sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error'));
}

/** A new, empty draft: every mandatory field present, nothing clinical filled in. */
export function scaffoldPathway(id: string, doc = 'TODO(source)'): Record<string, unknown> {
  return {
    id,
    version: 1,
    status: 'draft',
    title: { en: '', gu: '', hi: '' },
    source: { doc, page: 'TODO(source)', reviewed_by: '', reviewed_on: '' },
    start: 'q1',
    nodes: [],
    rules: [],
  };
}

/** The next version of an existing pathway: same content, version + 1, draft, sign-off cleared. */
export function nextVersion(p: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
  copy.version = Number(p.version) + 1;
  copy.status = 'draft';
  const source = isObj(copy.source) ? copy.source : {};
  copy.source = { ...source, reviewed_by: '', reviewed_on: '' };
  for (const n of Array.isArray(copy.nodes) ? copy.nodes : []) {
    if (isObj(n)) delete n.reviewed_by;
  }
  return copy;
}
