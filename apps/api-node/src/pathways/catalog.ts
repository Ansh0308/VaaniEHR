// The pathway catalog: loaded ONCE at start-up from files (Phase 6A). It fails fast on any problem in a file that would
// be used, so a broken or edited-after-locking pathway never silently changes what the doctor is asked.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config/env.js';
import {
  loadAllVersions,
  loadPathwayDir,
  parseEngineConfig,
  parseSlotMap,
  type EngineConfig,
  type Pathway,
  type SlotMap,
} from './rules.js';

export interface PathwayCatalog {
  pathways: Pathway[];
  /** every usable version of every pathway (the read-only viewer's version history) */
  allVersions: Pathway[];
  slotMap: SlotMap;
  engine: EngineConfig;
}

export function loadCatalog(config: Config): PathwayCatalog {
  const { dir, allowTest, slotMapFile, engine } = config.pathways;
  const loaded = loadPathwayDir(dir, { allowTest, requireLock: config.nodeEnv === 'production' });
  if (loaded.problems.length > 0) {
    throw new Error(`pathway files are not valid:\n  - ${loaded.problems.join('\n  - ')}`);
  }
  const mapPath = slotMapFile ?? join(dir, 'slot-map.json');
  const slotMap = existsSync(mapPath)
    ? parseSlotMap(JSON.parse(readFileSync(mapPath, 'utf8')))
    : ({ version: 1, mappings: [] } as SlotMap);
  return {
    pathways: loaded.pathways,
    allVersions: loadAllVersions(dir, { allowTest }),
    slotMap,
    engine: parseEngineConfig(engine),
  };
}
