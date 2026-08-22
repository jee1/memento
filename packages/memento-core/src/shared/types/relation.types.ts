/** 관계·트리플 타입 공개 모음 */

export type {
  ExtractOptions,
  ExtractResult,
  IRelationExtractor,
  RelationCandidate,
  RelationCategory,
  RelationType,
} from './relation.js';

export type {
  AddRelationOptions,
  GetRelatedMemoriesOptions,
  GetRelationsOptions,
  IRelationGraph,
  MemoryRelation,
  RelationDirection,
  RelationMetadata,
  RelationTypeRegistry,
} from './relation-graph.js';

export type {
  EntityLinkingResult,
  ExtractionInfo,
  ExtractionSteps,
  PredicateCanonicalizationResult,
  Triple,
  TripleExtractionFailureReason,
  TripleExtractionOptions,
  TripleExtractionResult,
  TripleExtractionStats,
  TriplePipelineChunkError,
  TriplePipelineResult,
  TripleValidationResult,
} from './triple-extraction.js';
