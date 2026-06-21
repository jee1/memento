import Database from 'better-sqlite3';
import { mementoConfig } from '../shared/config/index.js';
import { getBatchScheduler } from '../infrastructure/scheduler/batch-scheduler.js';
import { SleepConsolidationService } from '../domains/consolidation/services/sleep-consolidation-service.js';
import { createRelationGraph } from '../infrastructure/relation-graph-factory.js';
import { IntrospectionScanCache } from '../domains/memory/services/introspection-scan-cache.js';
import { TelemetryRepository } from '../domains/telemetry/repositories/telemetry-repository.js';
import { TelemetryService } from '../domains/telemetry/services/telemetry-service.js';
import type { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import type { RuntimeDiagnosticsLogger } from '../domains/monitoring/services/runtime-diagnostics-logger.js';
import type { IReflexionWorker } from '../shared/interfaces/reflexion-worker.interface.js';
import type { AnchorManager } from '../domains/anchor/services/anchor/anchor-manager.js';

export async function createBatchTelemetryRelationAndSleep(
  db: Database.Database,
  embeddingService: MemoryEmbeddingService,
  runtimeDiagnosticsLogger: RuntimeDiagnosticsLogger,
  reflexionWorker: IReflexionWorker | undefined,
  anchorManager?: AnchorManager
): Promise<{
  introspectionScanCache: IntrospectionScanCache;
  telemetryRepository: TelemetryRepository;
  batchScheduler: ReturnType<typeof getBatchScheduler>;
  telemetryService: TelemetryService;
  relationGraph: ReturnType<typeof createRelationGraph>;
  sleepConsolidationService: SleepConsolidationService;
}> {
  const introspectionScanCache = new IntrospectionScanCache();
  const telemetryRepository = new TelemetryRepository(db);
  const batchScheduler = getBatchScheduler();
  batchScheduler.setDiagnosticsLogger(runtimeDiagnosticsLogger);
  batchScheduler.setTelemetryCleanupRepository(telemetryRepository);
  const telemetryService = new TelemetryService(telemetryRepository, () => getBatchScheduler());
  batchScheduler.setIntrospectionScanCache(introspectionScanCache);
  if (anchorManager) {
    batchScheduler.setAnchorManager(anchorManager);
  }
  const relationGraph = createRelationGraph(db);
  const sleepConsolidationService = new SleepConsolidationService(db, {
    relationGraph: relationGraph,
    memoryEmbeddingService: embeddingService,
    telemetryService
  });
  batchScheduler.setSleepConsolidationService(sleepConsolidationService);
  if (mementoConfig.batchSchedulerEnabled) {
    await batchScheduler.start(db, reflexionWorker);
  }

  return {
    introspectionScanCache,
    telemetryRepository,
    batchScheduler,
    telemetryService,
    relationGraph,
    sleepConsolidationService
  };
}
