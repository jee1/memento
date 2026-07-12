/**
 * #659 PoC: sleep consolidation을 core에 내장하지 않고 outbox consumer로 분리할 수 있음을 보인다.
 * SleepConsolidationService는 완료 시 `consolidation.completed`를 event_outbox에 적재하고(#659),
 * 이 worker는 EventOutboxPublisher로서 그 이벤트만 소비해 외부 액션(알림, export, 후속 집계 등)에
 * 연결한다. BatchScheduler나 SleepConsolidationService에 직접 의존하지 않는다.
 */

import type {
  EventOutboxEvent,
  EventOutboxPublisher,
} from '../../telemetry/services/event-outbox-service.js';

export interface ConsolidationCompletedHandlerInput {
  targetUri: string;
  ownerId: string | null;
  payload: Record<string, unknown>;
}

export class ConsolidationOutboxWorker implements EventOutboxPublisher {
  private handledCount = 0;

  constructor(
    private readonly onConsolidationCompleted?: (input: ConsolidationCompletedHandlerInput) => void | Promise<void>
  ) {}

  async publish(event: EventOutboxEvent): Promise<void> {
    if (event.eventType !== 'consolidation.completed') {
      return;
    }
    await this.onConsolidationCompleted?.({
      targetUri: event.targetUri,
      ownerId: event.ownerId,
      payload: event.payload,
    });
    this.handledCount += 1;
  }

  get handled(): number {
    return this.handledCount;
  }
}
