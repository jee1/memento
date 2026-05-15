/**
 * Evolution demo API contract (Issue #341, #396)
 */

import { z } from 'zod';

export const EVOLUTION_DEMO_SCENARIO_IDS = [
  'answer-over-time',
  'episodic-to-semantic',
] as const;

export const EvolutionDemoMemorySummarySchema = z.object({
  episodic_count: z.number().int().nonnegative(),
  semantic_count: z.number().int().nonnegative(),
  forgotten_count: z.number().int().nonnegative(),
  preserved_count: z.number().int().nonnegative(),
  summary_text: z.string(),
});

export const EvolutionDemoEpisodicSourceSchema = z.object({
  id: z.string().min(1),
  summary: z.string(),
  created_at: z.string().datetime().optional(),
  importance: z.number().min(0).max(1).optional(),
});

export const EvolutionDemoSemanticResultSchema = z.object({
  id: z.string().min(1),
  summary: z.string(),
  source_count: z.number().int().nonnegative(),
  explanation: z.string(),
});

export const EvolutionDemoSearchComparisonSchema = z.object({
  before_summary: z.string(),
  after_summary: z.string(),
});

export const EvolutionDemoSnapshotSchema = z.object({
  scenario_id: z.string().min(1),
  point_id: z.string().min(1),
  point_label: z.string().min(1),
  question: z.string(),
  answer: z.string(),
  memory_summary: EvolutionDemoMemorySummarySchema,
  explanation: z.string(),
  timestamp: z.string().datetime(),
  episodic_sources: z.array(EvolutionDemoEpisodicSourceSchema).optional(),
  semantic_result: EvolutionDemoSemanticResultSchema.optional(),
  search_comparison: EvolutionDemoSearchComparisonSchema.optional(),
});

export const EvolutionDemoPointSchema = z.object({
  point_id: z.string().min(1),
  label: z.string().min(1),
});

export const EvolutionDemoScenarioSchema = z.object({
  scenario_id: z.string().min(1),
  title: z.string().min(1),
  points: z.array(EvolutionDemoPointSchema).min(1),
});

export const EvolutionDemoScenarioCatalogSchema = z.object({
  scenarios: z.array(EvolutionDemoScenarioSchema).min(1),
});
