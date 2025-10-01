/**
 * MCP Tools 공통 타입 정의
 */
import { z } from 'zod';
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
//# sourceMappingURL=types.js.map