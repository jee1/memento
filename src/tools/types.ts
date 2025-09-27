/**
 * MCP Tools 공통 타입 정의
 */

import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
  handler: ToolHandler;
}

export interface ToolContext {
  db: any;
  services: {
    searchEngine?: any;
    hybridSearchEngine?: any;
    embeddingService?: any;
    forgettingPolicyService?: any;
    performanceMonitor?: any;
    databaseOptimizer?: any;
    errorLoggingService?: any;
    performanceAlertService?: any;
    performanceMonitoringIntegration?: any;
  };
}

export type ToolHandler = (params: any, context: ToolContext) => Promise<any>;

export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

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
  Content: z.string().min(1, 'Content cannot be empty'),
  Query: z.string().min(1, 'Query cannot be empty'),
  MemoryType: z.enum(['working', 'episodic', 'semantic', 'procedural']),
  PrivacyScope: z.enum(['private', 'team', 'public']),
  Importance: z.number().min(0).max(1),
  Limit: z.number().min(1).max(50).default(10),
  Tags: z.array(z.string()).optional(),
  Source: z.string().optional(),
  HardDelete: z.boolean().default(false),
  DryRun: z.boolean().default(false).optional(),
  Analyze: z.boolean().default(false).optional(),
  CreateIndexes: z.boolean().default(false).optional(),
};

