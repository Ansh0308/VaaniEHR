// Types for concept suggestions (remaining Phase 5 items). A suggestion is only a suggestion; no score is sent or shown.
export interface ConceptSuggestion {
  conceptId: string;
  label: string;
  reviewStatus: 'unreviewed' | 'reviewed';
}
export interface ConceptSuggestions {
  /** false when the draft list file is not there: the screen says so and offers nothing */
  listLoaded: boolean;
  byFact: Record<string, ConceptSuggestion[]>;
  conceptLabels: Record<string, string>;
}
