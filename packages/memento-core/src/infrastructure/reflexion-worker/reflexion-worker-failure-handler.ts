import type { FailureEvent } from '../../domains/monitoring/services/failure-detector.js';
import type { ExtractedProceduralMemory } from '../../domains/memory/procedural/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../../domains/memory/procedural/procedural-memory-extractor.types.js';
import type { ReflexionProceduralMemoryService } from '../reflexion-procedural-memory-service.js';

export interface ReflexionWorkerFailureHandlerDeps {
  proceduralMemoryService: ReflexionProceduralMemoryService;
}

/**
 * FailureDetector의 큐에 핸들러 등록
 * FailureDetector가 실패 이벤트를 큐에 추가할 때 이 핸들러를 사용하도록 설정
 */
export function registerHandler(): void {
  // FailureDetector의 queueFailureEvent를 래핑하여
  // 큐 크기 제한 및 processFailureEvent를 호출하도록 설정
  // 실제로는 FailureDetector에 직접 등록하는 대신,
  // BaseTool의 handleFailure에서 이 메서드를 호출하도록 수정 필요
  // 또는 FailureDetector에 setHandler 메서드를 추가
}

export async function updateProceduralMemory(
  deps: ReflexionWorkerFailureHandlerDeps,
  memoryId: string,
  extracted: ExtractedProceduralMemory,
  updateMode: 'replace' | 'incremental' | 'versioned',
  reflectionNote: ReflectionNotes | Record<string, unknown>,
  event: FailureEvent
): Promise<void> {
  await deps.proceduralMemoryService.updateProceduralMemory(
    memoryId,
    extracted,
    updateMode,
    reflectionNote,
    event
  );
}
