// Types for the read-only pathway viewer (PG-14). The API sends the pathway files as they are: nothing is computed here.
export type PathwayStatus = 'test' | 'draft' | 'active';
export type Scalar = boolean | number | string;
export interface Localized {
  en: string;
  gu: string;
  hi: string;
}
export interface Condition {
  op: string;
  value: Scalar | Scalar[];
}
export interface VersionInfo {
  version: number;
  status: PathwayStatus;
  reviewedBy: string | null;
  reviewedOn: string | null;
  signedOff: boolean;
}
export interface PathwaySummary {
  id: string;
  title: Localized;
  latestVersion: number;
  status: PathwayStatus;
  signedOff: boolean;
  notActive: boolean;
  nodeCount: number;
  versions: VersionInfo[];
}
export interface PathwayList {
  pathways: PathwaySummary[];
  testPathwaysAllowed: boolean;
}
export interface NodeView {
  id: string;
  type: 'question' | 'terminal';
  slot: string | null;
  answer: string | null;
  choices: string[] | null;
  ask: Localized | null;
  reason: Localized | null;
  label: Localized | null;
  infoWeight: number | null;
  redFlagIf: Condition | null;
  sourceQuote: string | null;
  page: string | number | null;
  reviewedBy: string | null;
  conceptId: string | null;
  refer: boolean | null;
  edges: (Condition & { to: string })[];
}
export interface RuleView {
  id: string;
  slot: string;
  op: string;
  value: Scalar | Scalar[];
  weight: number;
}
export interface PathwayDetail extends PathwaySummary {
  version: number;
  source: { doc: string; page: string | number };
  reviewedBy: string | null;
  reviewedOn: string | null;
  start: string;
  nodes: NodeView[];
  rules: RuleView[];
}
