import Database from 'better-sqlite3';
import type {
  ChatLlmPort,
  ChatLlmRequest,
} from '../../../../shared/services/chat-llm/chat-llm-port.js';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { setLlmUsageRepository } from '../../../../shared/services/llm-usage/llm-usage-recorder.js';
import { LlmUsageRepository } from '../../../../shared/services/llm-usage/llm-usage-repository.js';
import { LlmUsageTelemetryMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/058-llm-usage-telemetry.js';
import { MemorySupersedeCandidateMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/059-memory-supersede-candidate.js';
import { MemorySupersedePointerMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/060-memory-supersede-pointer.js';
import { applyConsolidationTestSchema } from '../../../consolidation/__tests__/consolidation-test-schema.js';

export async function createSupersedeTestDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  applyConsolidationTestSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await new LlmUsageTelemetryMigration().up(db);
  await new MemorySupersedeCandidateMigration().up(db);
  await new MemorySupersedePointerMigration().up(db);
  setLlmUsageRepository(new LlmUsageRepository(db));
  return db;
}

export function closeSupersedeTestDb(db: Database.Database): void {
  setLlmUsageRepository(null);
  db.close();
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export interface SeedMemory {
  id: string;
  content: string;
  createdAt: string;
  type?: 'semantic' | 'episodic';
  ownerId?: string | null;
  projectId?: string | null;
  privacyScope?: string;
  vec?: number[] | null;
  model?: string;
}

export function insertSeedMemory(db: Database.Database, memory: SeedMemory): void {
  db.prepare(
    `INSERT INTO memory_item (id, type, content, privacy_scope, created_at, owner_id, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    memory.id,
    memory.type ?? 'semantic',
    memory.content,
    memory.privacyScope ?? 'private',
    memory.createdAt,
    memory.ownerId ?? null,
    memory.projectId ?? null,
  );
  const vec = memory.vec === undefined ? [1, 0, 0] : memory.vec;
  if (vec) {
    db.prepare(
      `INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions, model)
       VALUES (?, 'minilm', 'native', ?, ?, ?, ?)`,
    ).run(memory.id, encodeFloat32Embedding(vec), vec.length, vec.length, memory.model ?? 'm1');
  }
}

export type FakeChatPort = ChatLlmPort & { calls: ChatLlmRequest[] };

export function fakeChatPort(
  reply: (request: ChatLlmRequest, callIndex: number) => string | Error,
): FakeChatPort {
  const calls: ChatLlmRequest[] = [];
  return {
    provider: 'gemini',
    calls,
    async complete(request) {
      calls.push(request);
      const result = reply(request, calls.length - 1);
      if (result instanceof Error) {
        throw result;
      }
      return { content: result, usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };
}

export function judgeReply(
  verdict: string,
  rationale = '판정 근거',
  evidenceQuote: string | null = null,
): string {
  return JSON.stringify({ verdict, rationale, evidence_quote: evidenceQuote });
}
