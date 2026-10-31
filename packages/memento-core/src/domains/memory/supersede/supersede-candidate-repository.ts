import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { SupersedeVerdict } from './supersede-judge.js';

export interface SupersedeCandidateInsert {
  oldMemoryId: string;
  newMemoryId: string;
  ownerId: string | null;
  projectId: string | null;
  privacyScope: string;
  memoryType: string;
  verdict: SupersedeVerdict;
  rationale: string;
  evidenceQuote: string | null;
  oldContentSha256: string;
  newContentSha256: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  llmLogicalRequestId: string | null;
}

/** memory_supersede_candidate 만 다룬다. memory_item 질의는 memory-item-repository 에 둔다. */
export class SupersedeCandidateRepository {
  constructor(private readonly db: Database.Database) {}

  hasInputHash(inputHash: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM memory_supersede_candidate WHERE input_hash = ?')
        .get(inputHash) !== undefined
    );
  }

  /** 같은 input_hash 가 이미 있으면 아무것도 쓰지 않는다. */
  insertCandidate(candidate: SupersedeCandidateInsert): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO memory_supersede_candidate (
          id, old_memory_id, new_memory_id, owner_id, project_id, privacy_scope, memory_type,
          verdict, rationale, evidence_quote, old_content_sha256, new_content_sha256,
          provider, model, prompt_version, input_hash, llm_logical_request_id, created_at
        ) VALUES (
          @id, @oldMemoryId, @newMemoryId, @ownerId, @projectId, @privacyScope, @memoryType,
          @verdict, @rationale, @evidenceQuote, @oldContentSha256, @newContentSha256,
          @provider, @model, @promptVersion, @inputHash, @llmLogicalRequestId, @createdAt
        )`,
      )
      .run({ ...candidate, id: randomUUID(), createdAt: new Date().toISOString() });
  }
}
