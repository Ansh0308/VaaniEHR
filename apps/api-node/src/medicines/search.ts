// Medicine search and views (FR-F5-02, FR-F5-03). Generic names always rank above brand names:
//   tier  generic: exact 1000, starts-with 900, a word starts with it 800, contains 700, similar (pg_trgm) 500-600
//   tier  brand:   exact  400, starts-with 300, contains 200, similar 100-150          (so a generic match always wins)
// A Gujarati query is expanded through medicine_translit_gu (empty until a Gujarati reviewer approves a list); search
// works without it. Reference data: not clinic-scoped (ADR-D23).
import type { QueryResultRow } from 'pg';
import type { Queryable } from '../db/tx.js';

const GUJARATI = /[઀-૿]/;

export interface MedicineRow extends QueryResultRow {
  id: string;
  generic_name: string;
  strength: string | null;
  dose_form: string | null;
  route: string | null;
  therapeutic_category: string | null;
  nlem_year: number | null;
  snomed_code: string | null;
  atc_code: string | null;
  source: string;
  source_page: number | null;
  nlem_ref: string | null;
  healthcare_levels: string | null;
  source_notes: string | null;
  also_listed_in: string[];
  reviewed_on: string | null;
  reviewed_by: string | null;
  retired_at: Date | null;
}

interface BrandRow extends QueryResultRow {
  id: string;
  medicine_id: string;
  brand_name: string;
  manufacturer: string | null;
  source: string;
}

export interface MedicineView {
  id: string;
  genericName: string;
  strength: string | null;
  doseForm: string | null;
  /** Empty for NLEM rows: the prescribing doctor chooses the route (OPEN_CLINICAL_ITEMS). */
  route: string | null;
  therapeuticCategory: string | null;
  nlemYear: number | null;
  snomedCode: string | null;
  atcCode: string | null;
  /** Where the row came from; present on every item. */
  source: string;
  /** The PDF page (the page index in the file). */
  sourcePage: number | null;
  /** The page number printed on the page: one lower than the PDF page. Show both ("PDF p. 27, printed 26"). */
  sourcePagePrinted: number | null;
  nlemRef: string | null;
  healthcareLevels: string | null;
  sourceNotes: string | null;
  alsoListedIn: string[];
  reviewStatus: 'reviewed' | 'not_reviewed';
  reviewedOn: string | null;
  reviewedBy: string | null;
  retired: boolean;
  brands: Array<{ id: string; brandName: string; manufacturer: string | null; source: string }>;
  matchedOn?: 'generic' | 'brand';
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

export function toView(row: MedicineRow, brands: BrandRow[]): MedicineView {
  const reviewedOn =
    row.reviewed_on === null
      ? null
      : (row.reviewed_on as unknown as Date) instanceof Date
        ? (row.reviewed_on as unknown as Date).toISOString().slice(0, 10)
        : String(row.reviewed_on).slice(0, 10);
  return {
    id: row.id,
    genericName: row.generic_name,
    strength: row.strength,
    doseForm: row.dose_form,
    route: row.route,
    therapeuticCategory: row.therapeutic_category,
    nlemYear: row.nlem_year,
    snomedCode: row.snomed_code,
    atcCode: row.atc_code,
    source: row.source,
    sourcePage: row.source_page,
    sourcePagePrinted: row.source_page === null ? null : row.source_page - 1,
    nlemRef: row.nlem_ref,
    healthcareLevels: row.healthcare_levels,
    sourceNotes: row.source_notes,
    alsoListedIn: row.also_listed_in,
    reviewStatus: reviewedOn === null ? 'not_reviewed' : 'reviewed',
    reviewedOn,
    reviewedBy: row.reviewed_by,
    retired: row.retired_at !== null,
    brands: brands
      .filter((b) => b.medicine_id === row.id)
      .map((b) => ({
        id: b.id,
        brandName: b.brand_name,
        manufacturer: b.manufacturer,
        source: b.source,
      })),
  };
}

export async function brandsFor(db: Queryable, ids: string[]): Promise<BrandRow[]> {
  if (ids.length === 0) return [];
  const r = await db.query<BrandRow>(
    `SELECT id, medicine_id, brand_name, manufacturer, source FROM medicine_brand
      WHERE medicine_id = ANY($1::uuid[]) AND retired_at IS NULL ORDER BY lower(brand_name)`,
    [ids],
  );
  return r.rows;
}

export async function getMedicine(db: Queryable, id: string): Promise<MedicineView | null> {
  const r = await db.query<MedicineRow>('SELECT * FROM medicine_master WHERE id = $1', [id]);
  const row = r.rows[0];
  if (!row) return null;
  return toView(row, await brandsFor(db, [id]));
}

/** The query as typed, plus Latin spellings for any Gujarati words that have an approved mapping. */
async function expandTerms(db: Queryable, q: string): Promise<string[]> {
  const terms = new Set<string>([q.toLowerCase()]);
  for (const token of q.split(/\s+/).filter((t) => GUJARATI.test(t))) {
    const r = await db.query<{ latin_text: string }>(
      `SELECT DISTINCT latin_text FROM medicine_translit_gu
        WHERE gu_text = $1 OR gu_text LIKE $2 ESCAPE '\\' LIMIT 20`,
      [token, `${escapeLike(token)}%`],
    );
    for (const row of r.rows) terms.add(row.latin_text.toLowerCase());
  }
  return [...terms];
}

export type MedicineSort = 'name' | 'strength' | 'form' | 'category' | 'page' | 'reviewed';

/** Whitelisted ORDER BY expressions: the request only ever picks a key from this table. */
const SORT_SQL: Record<MedicineSort, string> = {
  name: 'lower(m.generic_name)',
  strength: "coalesce(m.strength, '')",
  form: "coalesce(m.dose_form, '')",
  category: "coalesce(m.therapeutic_category, '')",
  page: 'm.source_page',
  reviewed: 'm.reviewed_on',
};

export interface SearchOptions {
  q?: string | undefined;
  limit: number;
  offset: number;
  includeRetired: boolean;
  /** Top-level category (the section title) to keep. */
  category?: string | undefined;
  /** Used for the plain list only; a search is ordered by relevance (generic names first). */
  sort?: MedicineSort | undefined;
  order?: 'asc' | 'desc' | undefined;
}

/** The top-level categories with the number of active medicine rows in each. */
export async function listCategories(
  db: Queryable,
  includeRetired: boolean,
): Promise<Array<{ name: string; count: number }>> {
  const r = await db.query<{ name: string; count: number }>(
    `SELECT split_part(therapeutic_category, ' > ', 1) AS name, count(*)::int AS count
       FROM medicine_master
      WHERE therapeutic_category IS NOT NULL AND ($1 OR retired_at IS NULL)
      GROUP BY 1 ORDER BY 1`,
    [includeRetired],
  );
  return r.rows;
}

export async function searchMedicines(
  db: Queryable,
  options: SearchOptions,
): Promise<{ items: MedicineView[]; total: number }> {
  const q = options.q?.trim() ?? '';
  type Hit = MedicineRow & { total: string | number; by_generic?: boolean };
  let rows: Hit[];

  if (q === '') {
    rows = (
      await db.query<Hit>(
        `SELECT m.*, count(*) OVER () AS total FROM medicine_master m
          WHERE ($1 OR m.retired_at IS NULL)
            AND ($4::text IS NULL OR split_part(m.therapeutic_category, ' > ', 1) = $4)
          ORDER BY ${SORT_SQL[options.sort ?? 'name']} ${options.order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST,
                   lower(m.generic_name), coalesce(m.dose_form, ''), coalesce(m.strength, ''), m.id
          LIMIT $2 OFFSET $3`,
        [options.includeRetired, options.limit, options.offset, options.category ?? null],
      )
    ).rows;
  } else {
    const terms = await expandTerms(db, q);
    rows = (
      await db.query<Hit>(
        `WITH terms(t, e) AS (SELECT * FROM unnest($1::text[], $2::text[])),
         gen AS (
           SELECT m.id, max(CASE
               WHEN lower(m.generic_name) = t THEN 1000
               WHEN lower(m.generic_name) LIKE e || '%' ESCAPE '\\' THEN 900
               WHEN (' ' || lower(m.generic_name)) LIKE '% ' || e || '%' ESCAPE '\\' THEN 800
               WHEN lower(m.generic_name) LIKE '%' || e || '%' ESCAPE '\\' THEN 700
               ELSE 500 + 100 * similarity(lower(m.generic_name), t) END)::float AS tier
             FROM medicine_master m, terms
            WHERE ($3 OR m.retired_at IS NULL)
              AND (lower(m.generic_name) LIKE '%' || e || '%' ESCAPE '\\' OR lower(m.generic_name) % t)
            GROUP BY m.id),
         br AS (
           SELECT b.medicine_id AS id, max(CASE
               WHEN lower(b.brand_name) = t THEN 400
               WHEN lower(b.brand_name) LIKE e || '%' ESCAPE '\\' THEN 300
               WHEN lower(b.brand_name) LIKE '%' || e || '%' ESCAPE '\\' THEN 200
               ELSE 100 + 50 * similarity(lower(b.brand_name), t) END)::float AS tier
             FROM medicine_brand b JOIN medicine_master m ON m.id = b.medicine_id, terms
            WHERE b.retired_at IS NULL AND ($3 OR m.retired_at IS NULL)
              AND (lower(b.brand_name) LIKE '%' || e || '%' ESCAPE '\\' OR lower(b.brand_name) % t)
            GROUP BY b.medicine_id),
         hits AS (
           SELECT coalesce(gen.id, br.id) AS id,
                  greatest(coalesce(gen.tier, 0), coalesce(br.tier, 0)) AS tier,
                  coalesce(gen.tier, 0) >= coalesce(br.tier, 0) AS by_generic
             FROM gen FULL JOIN br ON br.id = gen.id)
         SELECT m.*, h.by_generic, count(*) OVER () AS total
           FROM hits h JOIN medicine_master m ON m.id = h.id
          WHERE ($6::text IS NULL OR split_part(m.therapeutic_category, ' > ', 1) = $6)
          ORDER BY h.tier DESC, lower(m.generic_name), coalesce(m.dose_form, ''), coalesce(m.strength, ''), m.id
          LIMIT $4 OFFSET $5`,
        [
          terms,
          terms.map(escapeLike),
          options.includeRetired,
          options.limit,
          options.offset,
          options.category ?? null,
        ],
      )
    ).rows;
  }

  const brands = await brandsFor(
    db,
    rows.map((r) => r.id),
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map((r) => {
      const view = toView(r, brands);
      if (q !== '') view.matchedOn = r.by_generic === false ? 'brand' : 'generic';
      return view;
    }),
  };
}
