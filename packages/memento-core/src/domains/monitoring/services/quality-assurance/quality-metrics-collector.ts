/**
 * Quality Metrics Collector
 *
 * 품질 지표 수집 서비스의 public facade.
 */

import Database from 'better-sqlite3';
import type { CategoryMeasurement, CategoryQualityReport } from '../../../../shared/types/benchmark.types.js';
import type { CategoryMetricsOptions } from './category-quality-aggregator.js';
import type {
  CollectedMetrics,
  SearchMetricsOptions,
  RelationMetricsOptions,
} from './quality-metrics-types.js';
export type {
  CollectedMetrics,
  SearchMetricsOptions,
  RelationMetricsOptions,
} from './quality-metrics-types.js';
import { SearchMetricsCollector } from './search-metrics-collector.js';
import { RelationMetricsCollector } from './relation-metrics-collector.js';
import { StorageMetricsCollector } from './storage-metrics-collector.js';
import { CategoryQualityAggregator } from './category-quality-aggregator.js';
import type { RepositoryProvider } from '../../../../shared/ports/repository-provider.port.js';

export class QualityMetricsCollector {
  private readonly searchCollector: SearchMetricsCollector;
  private readonly relationCollector: RelationMetricsCollector;
  private readonly storageCollector: StorageMetricsCollector;
  private readonly categoryAggregator: CategoryQualityAggregator;

  constructor(db: Database.Database, repositories: RepositoryProvider) {
    if (!db) {
      throw new Error('Database instance is required');
    }

    this.searchCollector = new SearchMetricsCollector(db, repositories);
    this.relationCollector = new RelationMetricsCollector(db);
    this.storageCollector = new StorageMetricsCollector(db);
    this.categoryAggregator = new CategoryQualityAggregator(db, repositories);
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

  async collectStorageMetrics(context: string = 'default'): Promise<CollectedMetrics> {
    return this.storageCollector.collect(context);
  }

  async collectAllMetrics(context: string = 'default'): Promise<CollectedMetrics[]> {
    return Promise.all([
      this.collectSearchMetrics(context),
      this.collectRelationMetrics(context),
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
      case 'storage':
        return this.collectStorageMetrics(context);
      default:
        throw new Error(`Unknown namespace: ${namespace}`);
    }
  }

  async collectCategoryMetrics(
    benchmarkDir: string,
    mappingPath: string,
    options?: CategoryMetricsOptions
  ): Promise<CategoryQualityReport[]> {
    const measurement = await this.collectCategoryMeasurement(benchmarkDir, mappingPath, options);
    return [...measurement.reports];
  }

  async collectCategoryMeasurement(
    benchmarkDir: string,
    mappingPath: string,
    options?: CategoryMetricsOptions
  ): Promise<CategoryMeasurement> {
    return this.categoryAggregator.collect(benchmarkDir, mappingPath, options);
  }
}
