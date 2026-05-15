/**
 * Evolution demo snapshot types (Issue #341)
 * Stable response shape for frontend #342
 */

export interface EvolutionDemoMemorySummary {
  episodic_count: number;
  semantic_count: number;
  forgotten_count: number;
  preserved_count: number;
  summary_text: string;
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
