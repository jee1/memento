/**
 * Consolidation Score 테스트용 Seed 데이터 생성 헬퍼
 * 인메모리 SQLite + memory_item/memory_embedding 샘플 데이터 생성
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../shared/utils/database.js';
import type { MemoryType } from '../../shared/types/index.js';

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
 * 시드 기반 랜덤 생성기 (재현 가능한 랜덤 값 생성)
 * Linear Congruential Generator (LCG) 사용
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * 0과 1 사이의 랜덤 값 생성
   */
  random(): number {
    // LCG: (a * seed + c) mod m
    // a = 1664525, c = 1013904223, m = 2^32
    this.seed = (this.seed * 1664525 + 1013904223) % 0x100000000;
    return this.seed / 0x100000000;
  }

  /**
   * min과 max 사이의 정수 랜덤 값 생성
   */
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  /**
   * min과 max 사이의 실수 랜덤 값 생성
   */
  randomFloat(min: number, max: number): number {
    return this.random() * (max - min) + min;
  }
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
 * 다양한 시나리오를 포함한 테스트 데이터 생성
 * 벡터 유사도 높음/낮음, Consolidation 높음/낮음, 극단적 조합 케이스 포함
 * 
 * @param count 생성할 메모리 아이템 수
 * @param seed 시드 값 (재현성을 위해 사용, 기본값: 12345)
 * @returns 테스트 메모리 아이템 배열
 */
export function generateScenarioBasedTestData(
  count: number = 50,
  seed: number = 12345
): TestMemoryItem[] {
  const items: TestMemoryItem[] = [];
  const rng = new SeededRandom(seed);
  const types: MemoryType[] = ['episodic', 'semantic', 'procedural', 'working'];
  
  const baseContents = [
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
  
  // 시나리오별 비율 설정
  const scenarioRatios = {
    highVectorHighConsolidation: 0.2,  // 20%: 고벡터 유사도 + 고 consolidation
    highVectorLowConsolidation: 0.2,   // 20%: 고벡터 유사도 + 저 consolidation
    lowVectorHighConsolidation: 0.2,   // 20%: 저벡터 유사도 + 고 consolidation
    lowVectorLowConsolidation: 0.2,    // 20%: 저벡터 유사도 + 저 consolidation
    extreme: 0.2                        // 20%: 극단적 조합
  };

  let scenarioIndex = 0;
  const scenarioCounts = {
    highVectorHighConsolidation: Math.floor(count * scenarioRatios.highVectorHighConsolidation),
    highVectorLowConsolidation: Math.floor(count * scenarioRatios.highVectorLowConsolidation),
    lowVectorHighConsolidation: Math.floor(count * scenarioRatios.lowVectorHighConsolidation),
    lowVectorLowConsolidation: Math.floor(count * scenarioRatios.lowVectorLowConsolidation),
    extreme: count - Math.floor(count * (scenarioRatios.highVectorHighConsolidation + scenarioRatios.highVectorLowConsolidation + scenarioRatios.lowVectorHighConsolidation + scenarioRatios.lowVectorLowConsolidation))
  };

  // 시나리오별 데이터 생성
  const scenarios = [
    {
      name: 'highVectorHighConsolidation',
      vectorSimilarityRange: [0.7, 0.95],
      consolidationRange: [0.7, 0.95],
      count: scenarioCounts.highVectorHighConsolidation
    },
    {
      name: 'highVectorLowConsolidation',
      vectorSimilarityRange: [0.7, 0.95],
      consolidationRange: [0.1, 0.3],
      count: scenarioCounts.highVectorLowConsolidation
    },
    {
      name: 'lowVectorHighConsolidation',
      vectorSimilarityRange: [0.1, 0.4],
      consolidationRange: [0.7, 0.95],
      count: scenarioCounts.lowVectorHighConsolidation
    },
    {
      name: 'lowVectorLowConsolidation',
      vectorSimilarityRange: [0.1, 0.4],
      consolidationRange: [0.1, 0.3],
      count: scenarioCounts.lowVectorLowConsolidation
    },
    {
      name: 'extreme',
      vectorSimilarityRange: [0.05, 0.15],  // 매우 낮은 벡터 유사도
      consolidationRange: [0.85, 0.99],     // 매우 높은 consolidation
      count: scenarioCounts.extreme
    }
  ];

  scenarios.forEach(scenario => {
    for (let i = 0; i < scenario.count; i++) {
      const type = types[scenarioIndex % types.length];
      const content = baseContents[scenarioIndex % baseContents.length];
      const daysAgo = rng.randomInt(0, 30);
      const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      
      // 시나리오에 맞는 consolidation_score 생성
      const consolidationScore = rng.randomFloat(
        scenario.consolidationRange[0],
        scenario.consolidationRange[1]
      );
      
      // recall_count와 last_accessed_at을 consolidation_score에 맞게 설정
      const recallCount = consolidationScore > 0.7 
        ? rng.randomInt(5, 20)  // 고 consolidation: 높은 recall_count
        : rng.randomInt(0, 4);   // 저 consolidation: 낮은 recall_count
      
      const hoursSinceAccess = consolidationScore > 0.7
        ? rng.randomInt(0, 24)   // 고 consolidation: 최근 접근
        : rng.randomInt(48, 168); // 저 consolidation: 오래된 접근
      
      const lastAccessedAt = new Date(now.getTime() - hoursSinceAccess * 60 * 60 * 1000);
      
      items.push({
        id: `mem_scenario_${scenario.name}_${i}`,
        type,
        content: `${content} [${scenario.name}] (Item ${scenarioIndex})`,
        importance: rng.randomFloat(0.3, 0.9),
        tags: [`scenario_${scenario.name}`, `tag${scenarioIndex % 5}`],
        created_at: createdAt.toISOString(),
        last_accessed: lastAccessedAt.toISOString(),
        last_accessed_at: lastAccessedAt.toISOString(),
        pinned: scenarioIndex % 10 === 0,
        recall_count: recallCount,
        consolidation_score: consolidationScore,
        g_value: recallCount > 0 ? 1.0 + (recallCount * 0.5) : 1.0
      });
      
      scenarioIndex++;
    }
  });

  return items;
}

/**
 * 시드 기반 임베딩 생성 (재현 가능한 벡터 유사도 시뮬레이션)
 * 
 * @param memoryIds 메모리 ID 배열
 * @param dimension 임베딩 차원
 * @param seed 시드 값 (재현성을 위해 사용)
 * @param vectorSimilarityRange 벡터 유사도 범위 (시나리오별로 다름)
 * @returns 테스트 임베딩 배열
 */
export function generateSeededEmbeddings(
  memoryIds: string[],
  dimension: number = 1536,
  seed: number = 12345,
  vectorSimilarityRange?: [number, number]
): TestMemoryEmbedding[] {
  const rng = new SeededRandom(seed);
  
  return memoryIds.map((memoryId, index) => {
    // 시드 기반으로 재현 가능한 임베딩 생성
    const baseSeed = seed + index * 1000;
    const itemRng = new SeededRandom(baseSeed);
    
    // 벡터 유사도 범위가 지정된 경우, 해당 범위에 맞는 벡터 생성
    let embedding: number[];
    if (vectorSimilarityRange) {
      // 벡터 유사도를 시뮬레이션하기 위해 특정 패턴의 벡터 생성
      const targetSimilarity = itemRng.randomFloat(vectorSimilarityRange[0], vectorSimilarityRange[1]);
      embedding = Array(dimension).fill(0).map((_, i) => {
        // 타겟 유사도에 맞는 벡터 생성 (간단한 시뮬레이션)
        return Math.sin((index * 10 + i) / dimension) * targetSimilarity * 0.5 + targetSimilarity * 0.3;
      });
    } else {
      // 기본 임베딩 생성
      embedding = Array(dimension).fill(0).map((_, i) => {
        return itemRng.randomFloat(-0.1, 0.1);
      });
    }
    
    return {
      memory_id: memoryId,
      embedding,
      embedding_provider: 'tfidf',
      dim: dimension
    };
  });
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
  includeEmbeddings: boolean = true,
  seed?: number
): { memoryIds: string[]; items: TestMemoryItem[] } {
  initializeTestDatabase(db);

  const items = seed !== undefined
    ? generateScenarioBasedTestData(itemCount, seed)
    : generateSampleMemoryItems(itemCount);
  const memoryIds: string[] = [];

  // 메모리 아이템 삽입
  items.forEach(item => {
    insertMemoryItem(db, item);
    memoryIds.push(item.id);
  });

  // 임베딩 삽입 (선택적)
  if (includeEmbeddings) {
    const embeddings = seed !== undefined
      ? generateSeededEmbeddings(memoryIds, 1536, seed)
      : generateSampleEmbeddings(memoryIds);
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

