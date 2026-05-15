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

/** Per-memory fate comparison (#344 forgetting-policy scenario) */
export interface EvolutionDemoMemoryGroup {
  label: string;
  importance: number;
  status: string;
  outcome: 'forget' | 'preserve' | 'pin';
  pinned: boolean;
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
  /** Present for forgetting-policy and similar comparison scenarios */
  memory_groups?: EvolutionDemoMemoryGroup[];
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
