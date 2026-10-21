// Facts -> slots (Phase 6A). Only a CONFIRMED fact that carries an internal concept id found in the slot map can set a
// slot. Unconfirmed (heard / rejected / stale) and uncertain facts never do: an unsure remark leaves the slot unknown.
// The map is a small JSON file: {"version":1,"mappings":[{"concept_id","slot","type":"boolean"}]}. For a boolean slot the
// value is "the thing is present" (a negated fact gives false). Two confirmed facts that disagree leave the slot unknown
// and are reported as a conflict. In this phase only toy concept ids exist; real ones wait for the reviewed word list.
import type { SlotValue } from './types.js';

export interface SlotMapping {
  concept_id: string;
  slot: string;
  type: 'boolean';
}
export interface SlotMap {
  version: 1;
  mappings: SlotMapping[];
}

export interface FactForSlots {
  id: string;
  status: string;
  concept_id: string | null;
  negated: boolean;
  uncertain: boolean;
}

export interface SlotResult {
  slots: Record<string, SlotValue>;
  /** slots left unknown because confirmed facts disagreed */
  conflicts: string[];
  /** how many facts set a slot */
  used: number;
  /** slot -> the (first, by id) confirmed fact that set it; for showing the supporting fact */
  factIds: Record<string, string>;
}

export function parseSlotMap(raw: unknown): SlotMap {
  const o = raw as Partial<SlotMap> | null;
  if (!o || o.version !== 1 || !Array.isArray(o.mappings))
    throw new Error('slot map: expected {version: 1, mappings: [...]}');
  for (const m of o.mappings) {
    if (typeof m?.concept_id !== 'string' || typeof m.slot !== 'string' || m.type !== 'boolean') {
      throw new Error('slot map: every mapping needs concept_id, slot and type "boolean"');
    }
  }
  return o as SlotMap;
}

export function factsToSlots(facts: FactForSlots[], map: SlotMap): SlotResult {
  const byConcept = new Map(map.mappings.map((m) => [m.concept_id, m]));
  const seen = new Map<string, boolean>();
  const by = new Map<string, string>();
  const conflicted = new Set<string>();
  let used = 0;
  for (const f of [...facts].sort((a, b) => a.id.localeCompare(b.id))) {
    if (f.status !== 'confirmed' || f.uncertain || f.concept_id === null) continue;
    const m = byConcept.get(f.concept_id);
    if (!m) continue;
    const value = !f.negated;
    const prior = seen.get(m.slot);
    if (prior !== undefined && prior !== value) conflicted.add(m.slot);
    seen.set(m.slot, value);
    if (!by.has(m.slot)) by.set(m.slot, f.id);
    used += 1;
  }
  const slots: Record<string, SlotValue> = {};
  for (const [slot, value] of seen) if (!conflicted.has(slot)) slots[slot] = value;
  const factIds: Record<string, string> = {};
  for (const slot of Object.keys(slots)) factIds[slot] = by.get(slot) as string;
  return { slots, conflicts: [...conflicted].sort(), used, factIds };
}
