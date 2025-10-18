import type { EmbeddingProvider } from './embedding.types.js';

/**
 * 벡터 검색 관련 타입 정의
 * 클린코드 원칙에 따른 인터페이스 분리
 */

export interface VectorSearchResult {
  memory_id: string;
  similarity: number;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned: boolean;
  tags?: string[];
}

export interface VectorSearchOptions {
  limit?: number;
  threshold?: number;
  type?: string;
  includeContent?: boolean;
  includeMetadata?: boolean;
}

export interface VectorSearchQuery {
  queryVector: number[];
  textQuery?: string;
  options: VectorSearchOptions;
  provider: string;
}

export interface VectorIndexStatus {
  available: boolean;
  tableExists: boolean;
  recordCount: number;
  dimensions: number;
  vecExtensionLoaded: boolean;
}

export interface PerformanceTestResult {
  averageTime: number;
  minTime: number;
  maxTime: number;
  results: number;
  successRate: number;
}

export interface VectorSearchConfig {
  defaultDimensions: number;
  defaultThreshold: number;
  defaultLimit: number;
  tableNames: Record<string, string>;
  providerDimensions: Record<string, number>;
}

export interface HybridSearchResult {
  memory_id: string;
  similarity: number; // final_similarity를 similarity로 통일
  vector_similarity: number;
  text_similarity: number;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned: boolean;
  tags?: string[];
}

export interface ProviderHybridQuery {
  query: VectorSearchQuery;
  text?: string;
  useHybrid?: boolean;
  useAvailableProviders?: boolean;
  overrideProviders?: EmbeddingProvider[];
  vectorLimit?: number;
}

export interface ProviderHybridResult {
  provider: EmbeddingProvider;
  vectorResults: VectorSearchResult[];
  hybridResults: VectorSearchResult[];
  vectorLatencyMs: number;
  hybridLatencyMs?: number;
}

export interface UnifiedSearchHit {
  memoryId: string;
  provider: EmbeddingProvider;
  normalizedScore: number;
  vectorSimilarity: number;
  hybridSimilarity?: number;
  content: string;
  type: string;
  importance: number;
  createdAt: string;
  tags?: string[];
  source: 'vector' | 'hybrid';
}

export interface UnifiedSearchResponse {
  providers: ProviderHybridResult[];
  unified: UnifiedSearchHit[];
}
