/**
 * Remember Tool 스키마 및 파라미터 타입 (remember-tool.ts에서 분리, #582).
 */

import { z } from 'zod';
import { CommonSchemas } from '../../../tools/types.js';

export const RememberSchema = z.object({
  content: CommonSchemas.Content,
  type: CommonSchemas.MemoryType.optional(),
  // Core Memory / Knowledge Vault용 필드
  key: CommonSchemas.Key.optional(),
  value: CommonSchemas.Value.optional(),
  always_load: CommonSchemas.AlwaysLoad,
  immutable: CommonSchemas.Immutable,
  // Procedural Memory용 필드
  task_goal: CommonSchemas.TaskGoal,
  steps: CommonSchemas.Steps,
  reflection_notes: CommonSchemas.ReflectionNotes,
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name: CommonSchemas.WorkflowName,
  skill_name: CommonSchemas.SkillName,
  trigger_conditions: CommonSchemas.TriggerConditions,
  update_mode: CommonSchemas.UpdateMode,
  // AriGraph Pipeline 필드
  enable_triple_extraction: CommonSchemas.EnableTripleExtraction,
  // 기존 필드 유지
  tags: CommonSchemas.Tags,
  importance: CommonSchemas.Importance.default(0.5),
  source: CommonSchemas.Source,
  privacy_scope: CommonSchemas.PrivacyScope.default('private'),
  // Multi-agent ownership (Issue #57 Phase 2 D)
  owner_id: z.string().optional(),
  // Memori Attribution (Issue #87)
  process_id: z.string().optional(),
  session_id: z.string().optional(),
  // Project-scoped memory (Issue #81)
  project_id: z.string().max(200).optional()
    .describe('프로젝트 식별자. 동일 project_id로 저장한 기억끼리 recall/memory_injection 시 필터링 가능'),
  // Fact metadata (Issue #88): semantic 표준 메타
  num_times: z.number().int().min(1).optional(),
  last_mentioned_at: z.string().datetime().optional(),
  source_session_id: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).refine((data) => {
  if (data.type === 'core' || data.type === 'vault') {
    return !!(data.key && data.value);
  }
  return !!data.content;
}, {
  message: "type='core' 또는 'vault'일 때는 key, value가 필수이고, 나머지는 content가 필수입니다"
});

/** Remember 도구 파라미터 타입 */
export type RememberParams = z.infer<typeof RememberSchema>;
