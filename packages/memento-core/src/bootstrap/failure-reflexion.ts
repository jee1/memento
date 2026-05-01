import { FailureDetector } from '../domains/monitoring/services/failure-detector.js';
import { AsyncTaskQueue } from '../infrastructure/async-optimizer.js';
import { ReflexionWorker } from '../infrastructure/reflexion-worker.js';

export async function startFailureAndReflexion(db: import('better-sqlite3').Database): Promise<{
  failureDetector: FailureDetector;
  reflexionWorker: ReflexionWorker;
}> {
  const failureEventQueue = new AsyncTaskQueue(5);
  const failureDetector = new FailureDetector(failureEventQueue);
  await failureDetector.startQueue();
  const reflexionWorker = new ReflexionWorker(failureDetector, db);
  await reflexionWorker.start();
  return { failureDetector, reflexionWorker };
}
