/**
 * Evolution demo snapshot types (Issue #341, #396)
 * Stable response shape for frontend #342 / #397
 */

export interface EvolutionDemoMemorySummary {
  episodic_count: number;
  semantic_count: number;
  forgotten_count: number;
  preserved_count: number;
  summary_text: string;
}

/** Episodic source contributing to consolidation (Issue #396) */
export interface EvolutionDemoEpisodicSource {
  id: string;
  summary: string;
  created_at?: string;
  importance?: number;
}

/** Semantic memory produced by consolidation (Issue #396) */
export interface EvolutionDemoSemanticResult {
  id: string;
  summary: string;
  source_count: number;
  explanation: string;
}

/** Search recall comparison before/after consolidation (Issue #396) */
export interface EvolutionDemoSearchComparison {
  before_summary: string;
  after_summary: string;
}

export interface EvolutionDemoSnapshot {
  scenario_id: string;
  point_id: string;
  point_label: string;
  question: string;
  answer: string;
  memory_summary: EvolutionDemoMemorySummary;
  explanation: string;
  timestamp: string;
  episodic_sources?: EvolutionDemoEpisodicSource[];
  semantic_result?: EvolutionDemoSemanticResult;
  search_comparison?: EvolutionDemoSearchComparison;
}

export interface EvolutionDemoPoint {
  point_id: string;
  label: string;
}

export interface EvolutionDemoScenario {
  scenario_id: string;
  title: string;
  points: EvolutionDemoPoint[];
}

export interface EvolutionDemoScenarioCatalog {
  scenarios: EvolutionDemoScenario[];
}
