/**
 * MCP Tools 공통 타입 - @memento/core와 동일 타입 사용 (재내보내기)
 */
export type { ToolContext, ToolResult } from '@memento/core';

// 서버 내부 도구 레지스트리용 (로컬 정의 유지)
import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  // 하위 호환성을 위해 JSON Schema 형식도 허용
  // 향후 모든 도구를 Zod 스키마로 마이그레이션 예정
  inputSchema: z.ZodTypeAny | Record<string, unknown>;
  handler: ToolHandler;
}

import type { ToolContext, ToolResult } from '@memento/core';
export type ToolHandler = (params: unknown, context: ToolContext) => Promise<ToolResult>;

export interface ToolError {
  error: string;
  message?: string;
  details?: string;
}

/**
 * 공통 스키마 정의
 */
export const CommonSchemas = {
  MemoryId: z.string().min(1, 'Memory ID cannot be empty'),
  Content: z.string().min(1, 'Content cannot be empty').optional(), // optional로 변경
  Query: z.string().min(1, 'Query cannot be empty'),
  MemoryType: z.enum(['working', 'episodic', 'semantic', 'procedural', 'core', 'vault']),
  PrivacyScope: z.enum(['private', 'team', 'public']),
  Importance: z.number().min(0).max(1),
  Limit: z.number().min(1).max(50).default(10),
  Tags: z.array(z.string()).optional(),
  Source: z.string().optional(),
  HardDelete: z.boolean().default(false),
  DryRun: z.boolean().default(false).optional(),
  Analyze: z.boolean().default(false).optional(),
  CreateIndexes: z.boolean().default(false).optional(),
  // Core Memory / Knowledge Vault용 필드
  Key: z.string().min(1, 'Key cannot be empty'),
  Value: z.string().min(1, 'Value cannot be empty'),
  AlwaysLoad: z.boolean().default(false).optional(),
  Immutable: z.boolean().default(true).optional(),
  // Procedural Memory용 필드
  TaskGoal: z.string().optional(),
  Steps: z.string().optional(), // JSON 배열 문자열
  ReflectionNotes: z.string().nullable().optional(), // JSON 객체 문자열 (null 허용)
  // Procedural Memory Enhancement (v7.0) 필드
  WorkflowName: z.string().optional(),
  SkillName: z.string().optional(),
  TriggerConditions: z.string().optional(), // JSON 객체 문자열
  UpdateMode: z.enum(['replace', 'incremental', 'versioned']).optional(),
  // AriGraph Pipeline 필드
  EnableTripleExtraction: z.boolean().default(true).optional(), // Triple 추출 활성화 여부 (기본값: true)
};

