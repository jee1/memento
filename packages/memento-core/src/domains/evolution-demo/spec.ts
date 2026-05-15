/**
 * Evolution demo API contract (Issue #341)
 */

import { z } from 'zod';

export const EVOLUTION_DEMO_SCENARIO_IDS = ['answer-over-time'] as const;

export const EvolutionDemoMemorySummarySchema = z.object({
  episodic_count: z.number().int().nonnegative(),
  semantic_count: z.number().int().nonnegative(),
  forgotten_count: z.number().int().nonnegative(),
  preserved_count: z.number().int().nonnegative(),
  summary_text: z.string(),
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
