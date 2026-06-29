/**
 * Quality Metrics Collector
 *
 * 품질 지표 수집 서비스의 public facade.
 */

import Database from 'better-sqlite3';
import type { CategoryQualityReport } from '../../../../shared/types/benchmark.types.js';
import type {
  CollectedMetrics,
  SearchMetricsOptions,
  RelationMetricsOptions,
  ConsolidationMetricsOptions,
} from './quality-metrics-types.js';
export type {
  CollectedMetrics,
  SearchQualityMetrics,
  RelationQualityMetrics,
  ConsolidationQualityMetrics,
  StorageQualityMetrics,
  SearchMetricsOptions,
  RelationMetricsOptions,
  ConsolidationMetricsOptions,
} from './quality-metrics-types.js';
import { SearchMetricsCollector } from './search-metrics-collector.js';
import { RelationMetricsCollector } from './relation-metrics-collector.js';
import { ConsolidationMetricsCollector } from './consolidation-metrics-collector.js';
import { StorageMetricsCollector } from './storage-metrics-collector.js';
import { CategoryQualityAggregator } from './category-quality-aggregator.js';

export class QualityMetricsCollector {
  private readonly searchCollector: SearchMetricsCollector;
  private readonly relationCollector: RelationMetricsCollector;
  private readonly consolidationCollector: ConsolidationMetricsCollector;
  private readonly storageCollector: StorageMetricsCollector;
  private readonly categoryAggregator: CategoryQualityAggregator;

  constructor(private db: Database.Database) {
    if (!db) {
      throw new Error('Database instance is required');
    }

    this.searchCollector = new SearchMetricsCollector(db);
    this.relationCollector = new RelationMetricsCollector(db);
    this.consolidationCollector = new ConsolidationMetricsCollector(db);
    this.storageCollector = new StorageMetricsCollector(db);
    this.categoryAggregator = new CategoryQualityAggregator(db);
  }

  async collectSearchMetrics(
    context: string = 'default',
    options?: SearchMetricsOptions
  ): Promise<CollectedMetrics> {
    return this.searchCollector.collect(context, options);
  }

  async collectRelationMetrics(
    context: string = 'default',
    options?: RelationMetricsOptions
  ): Promise<CollectedMetrics> {
    return this.relationCollector.collect(context, options);
  }

  async collectConsolidationMetrics(
    context: string = 'default',
    options?: ConsolidationMetricsOptions
  ): Promise<CollectedMetrics> {
    return this.consolidationCollector.collect(context, options);
  }

  async collectStorageMetrics(context: string = 'default'): Promise<CollectedMetrics> {
    return this.storageCollector.collect(context);
  }

  async collectAllMetrics(context: string = 'default'): Promise<CollectedMetrics[]> {
    return Promise.all([
      this.collectSearchMetrics(context),
      this.collectRelationMetrics(context),
      this.collectConsolidationMetrics(context),
      this.collectStorageMetrics(context),
    ]);
  }

  async collectMetricsByNamespace(
    namespace: string,
    context: string = 'default'
  ): Promise<CollectedMetrics> {
    switch (namespace) {
      case 'search':
        return this.collectSearchMetrics(context);
      case 'relation':
        return this.collectRelationMetrics(context);
      case 'consolidation':
        return this.collectConsolidationMetrics(context);
      case 'storage':
        return this.collectStorageMetrics(context);
      default:
        throw new Error(`Unknown namespace: ${namespace}`);
    }
  }

  async collectCategoryMetrics(
    benchmarkDir: string,
    mappingPath: string
  ): Promise<CategoryQualityReport[]> {
    return this.categoryAggregator.collect(benchmarkDir, mappingPath);
  }
}
