/**
 * Consolidation Score 테스트용 Seed 데이터 생성 헬퍼
 * 인메모리 SQLite + memory_item/memory_embedding 샘플 데이터 생성
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../utils/database.js';
import type { MemoryType } from '../../types/index.js';

export interface TestMemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  importance?: number;
  tags?: string[];
  created_at?: string;
  last_accessed?: string;
  pinned?: boolean;
  recall_count?: number;
  last_accessed_at?: string;
  consolidation_score?: number;
  g_value?: number;
}

export interface TestMemoryEmbedding {
  memory_id: string;
  embedding: number[];
  embedding_provider?: string;
  dim?: number;
}

/**
 * 테스트용 데이터베이스 초기화 (Consolidation Score 필드 포함)
 */
export function initializeTestDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
      origin_source TEXT DEFAULT '{}',
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
      -- Consolidation Score 필드
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      consolidation_score REAL,
      g_value REAL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_item_type ON memory_item(type);
    CREATE INDEX IF NOT EXISTS idx_memory_item_created_at ON memory_item(created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed);
    CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed_at ON memory_item(last_accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_desc ON memory_item(consolidation_score DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2;

    CREATE TABLE IF NOT EXISTS memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
      projection_type TEXT NOT NULL DEFAULT 'native',
      embedding TEXT NOT NULL,
      dim INTEGER NOT NULL,
      dimensions INTEGER DEFAULT 0,
      model TEXT,
      precision INTEGER DEFAULT 32,
      normalized BOOLEAN DEFAULT FALSE,
      version INTEGER DEFAULT 1,
      created_by TEXT DEFAULT 'system',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(memory_id, embedding_provider, projection_type)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider);

    -- FTS5 가상 테이블
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
      content,
      tags,
      source,
      content='memory_item',
      content_rowid='rowid'
    );
  `);
}

/**
 * 메모리 아이템 삽입
 */
export function insertMemoryItem(
  db: Database.Database,
  item: TestMemoryItem
): void {
  const tagsJson = item.tags ? JSON.stringify(item.tags) : null;
  const createdAt = item.created_at || new Date().toISOString();
  const lastAccessed = item.last_accessed || null;
  const lastAccessedAt = item.last_accessed_at || null;

  const sql = `
    INSERT INTO memory_item (
      id, type, content, importance, tags, created_at, last_accessed,
      pinned, recall_count, last_accessed_at, consolidation_score, g_value
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  DatabaseUtils.run(db, sql, [
    item.id,
    item.type,
    item.content,
    item.importance ?? 0.5,
    tagsJson,
    createdAt,
    lastAccessed,
    item.pinned ? 1 : 0,
    item.recall_count ?? 0,
    lastAccessedAt,
    item.consolidation_score ?? null,
    item.g_value ?? null
  ]);

  // FTS5 동기화 (트리거가 없으므로 수동 삽입)
  const ftsSql = `
    INSERT INTO memory_item_fts(rowid, content, tags, source)
    SELECT rowid, content, tags, source FROM memory_item WHERE id = ?
  `;
  DatabaseUtils.run(db, ftsSql, [item.id]);
}

/**
 * 메모리 임베딩 삽입
 */
export function insertMemoryEmbedding(
  db: Database.Database,
  embedding: TestMemoryEmbedding
): void {
  const embeddingJson = JSON.stringify(embedding.embedding);
  const dim = embedding.dim ?? embedding.embedding.length;
  const provider = embedding.embedding_provider || 'tfidf';

  const sql = `
    INSERT INTO memory_embedding (
      memory_id, embedding_provider, projection_type, embedding, dim, dimensions
    ) VALUES (?, ?, 'native', ?, ?, ?)
  `;

  DatabaseUtils.run(db, sql, [
    embedding.memory_id,
    provider,
    embeddingJson,
    dim,
    dim
  ]);
}

/**
 * 샘플 메모리 아이템 생성 (다양한 consolidation_score 값)
 */
export function generateSampleMemoryItems(count: number = 10): TestMemoryItem[] {
  const items: TestMemoryItem[] = [];
  const types: MemoryType[] = ['episodic', 'semantic', 'procedural', 'working'];
  const contents = [
    'React Hook에 대해 설명했다. useState는 상태를 관리하고, useEffect는 사이드 이펙트를 처리한다.',
    'TypeScript의 타입 시스템에 대해 설명했다. 인터페이스와 타입 별칭의 차이점을 다뤘다.',
    '데이터베이스 최적화에 대해 질문받았다. 인덱싱과 쿼리 최적화 방법을 설명했다.',
    'MCP 프로토콜에 대해 학습했다. Model Context Protocol은 AI 에이전트와 도구 간 통신을 위한 표준이다.',
    'Node.js의 이벤트 루프에 대해 공부했다. 비동기 처리 메커니즘을 이해했다.',
    'Docker 컨테이너화에 대해 실습했다. 이미지 빌드와 컨테이너 실행 방법을 익혔다.',
    'GraphQL API 설계에 대해 토론했다. RESTful API와의 차이점을 분석했다.',
    '머신러닝 모델 학습에 대해 실험했다. 하이퍼파라미터 튜닝 방법을 탐색했다.',
    '웹 보안에 대해 강의를 들었다. XSS와 CSRF 공격 방어 방법을 학습했다.',
    '마이크로서비스 아키텍처에 대해 설계했다. 서비스 간 통신 패턴을 고려했다.'
  ];

  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    const content = contents[i % contents.length];
    const daysAgo = Math.floor(i / 2);
    const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    
    // consolidation_score를 다양하게 설정
    // 높은 recall_count와 최근 접근일수록 높은 점수
    const recallCount = i % 5; // 0-4
    const hoursSinceAccess = (i % 3) * 24; // 0, 24, 48시간 전
    const lastAccessedAt = new Date(now.getTime() - hoursSinceAccess * 60 * 60 * 1000);
    
    // 간단한 consolidation_score 계산 (실제 계산 로직은 ConsolidationScoreService 사용)
    // 여기서는 테스트용으로 간단히 계산
    const consolidationScore = recallCount > 0 
      ? Math.min(0.3 + (recallCount * 0.1) + (hoursSinceAccess < 24 ? 0.2 : 0), 1.0)
      : 0.1;

    items.push({
      id: `mem_${i + 1}`,
      type,
      content: `${content} (Item ${i + 1})`,
      importance: 0.5 + (i % 5) * 0.1,
      tags: [`tag${i % 3}`, `category${Math.floor(i / 3)}`],
      created_at: createdAt.toISOString(),
      last_accessed: lastAccessedAt.toISOString(),
      last_accessed_at: lastAccessedAt.toISOString(),
      pinned: i % 10 === 0, // 10번째마다 핀
      recall_count: recallCount,
      consolidation_score: consolidationScore,
      g_value: recallCount > 0 ? 1.0 + (recallCount * 0.5) : 1.0
    });
  }

  return items;
}

/**
 * 샘플 임베딩 생성 (간단한 벡터)
 */
export function generateSampleEmbeddings(
  memoryIds: string[],
  dimension: number = 1536
): TestMemoryEmbedding[] {
  return memoryIds.map((memoryId, index) => {
    // 간단한 테스트용 벡터 생성 (실제로는 임베딩 서비스 사용)
    const embedding = Array(dimension).fill(0).map((_, i) => {
      // 각 메모리마다 약간 다른 벡터 생성
      return Math.sin((index * 10 + i) / dimension) * 0.1 + 0.1;
    });
    
    return {
      memory_id: memoryId,
      embedding,
      embedding_provider: 'tfidf',
      dim: dimension
    };
  });
}

/**
 * 데이터베이스에 샘플 데이터 주입
 */
export function seedTestDatabase(
  db: Database.Database,
  itemCount: number = 10,
  includeEmbeddings: boolean = true
): { memoryIds: string[]; items: TestMemoryItem[] } {
  initializeTestDatabase(db);

  const items = generateSampleMemoryItems(itemCount);
  const memoryIds: string[] = [];

  // 메모리 아이템 삽입
  items.forEach(item => {
    insertMemoryItem(db, item);
    memoryIds.push(item.id);
  });

  // 임베딩 삽입 (선택적)
  if (includeEmbeddings) {
    const embeddings = generateSampleEmbeddings(memoryIds);
    embeddings.forEach(embedding => {
      insertMemoryEmbedding(db, embedding);
    });
  }

  return { memoryIds, items };
}

/**
 * 데이터베이스 정리
 */
export function cleanupTestDatabase(db: Database.Database): void {
  try {
    // 트랜잭션으로 안전하게 정리
    db.exec('BEGIN TRANSACTION');
    try {
      db.exec(`
        DELETE FROM memory_item_fts;
        DELETE FROM memory_embedding;
        DELETE FROM memory_item;
      `);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      // 테이블이 없을 수 있으므로 무시
    }
  } catch (error) {
    // 데이터베이스가 이미 닫혔을 수 있음
  }
}

