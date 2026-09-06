import { createHash } from 'crypto';
import Database from 'better-sqlite3';

import type { FailureEvent } from '../domains/monitoring/services/failure-detector.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import {
  mergeReflectionNotes,
  serializeReflectionNotes,
  type ExistingReflectionNotes
} from '../shared/utils/reflection-notes-merge.js';
import type { ReflectionNotes } from '../domains/memory/procedural/procedural-memory-extractor.types.js';
import { logger } from '../shared/utils/logger.js';
import { ReflexionProceduralMemoryService } from './reflexion-procedural-memory-service.js';

interface FailurePatternAnalysis {
  repeatCount: number;
  failureTypes: string[];
  tools: string[];
  errorMessages: string[];
}

export class ReflexionReflectionRecorder {
  private readonly duplicateWindow: Map<string, number> = new Map();

  constructor(
    private readonly db: Database.Database,
    private readonly proceduralMemoryService: ReflexionProceduralMemoryService,
    private readonly windowSizeMs: number
  ) {}

  /**
   * 실패 정보를 바탕으로 reflection_notes를 생성, 저장, procedural memory 변환까지 수행한다.
   * @returns 중복 이벤트가 아니어서 실제 저장/변환을 시도했으면 true
   */
  async record(event: FailureEvent): Promise<boolean> {
    if (this.isDuplicate(event)) {
      logger.debug('중복 이벤트 감지, Reflexion 기록 스킵', {
        event_id: event.id,
        tool: event.tool_name
      });
      return false;
    }

    const eventKey = this.generateEventKey(event);
    this.duplicateWindow.set(eventKey, Date.now());

    const reflectionNote = this.generateReflectionNote(event);
    const taskGoal = event.original_task || this.extractTaskGoal(event);

    if (taskGoal) {
      await this.recordWithTaskGoal(event, reflectionNote, taskGoal);
    } else {
      await this.recordWithoutTaskGoal(event, reflectionNote);
    }

    await this.proceduralMemoryService.convert(reflectionNote, event);
    return true;
  }

  cleanupDuplicateWindow(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.duplicateWindow.entries()) {
      if (now - timestamp >= this.windowSizeMs) {
        this.duplicateWindow.delete(key);
      }
    }
  }

  private async recordWithTaskGoal(
    event: FailureEvent,
    reflectionNote: ReflectionNotes,
    taskGoal: string
  ): Promise<void> {
    const existingRecord = DatabaseUtils.get(
      this.db,
      `SELECT id, reflection_notes FROM memory_item 
       WHERE type = 'procedural' AND task_goal = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [taskGoal]
    ) as { id: string; reflection_notes: string | null } | undefined;

    const existing = this.toExistingReflectionNotes(existingRecord?.reflection_notes);
    const patternAnalysis = this.analyzeFailurePattern(existing, event);

    if (patternAnalysis.repeatCount > 1) {
      logger.warn('동일 작업 반복 실패 감지', {
        task_goal: taskGoal,
        repeat_count: patternAnalysis.repeatCount,
        failure_types: patternAnalysis.failureTypes,
        tools: patternAnalysis.tools,
        message: `동일 작업이 ${patternAnalysis.repeatCount}회 실패했습니다. 개선 방안을 검토해야 합니다.`
      });
    }

    const mergeResult = mergeReflectionNotes(existing, reflectionNote);
    const finalReflectionNotes = serializeReflectionNotes(mergeResult.merged);

    if (existingRecord?.id) {
      DatabaseUtils.run(
        this.db,
        `UPDATE memory_item SET reflection_notes = ? WHERE id = ?`,
        [finalReflectionNotes, existingRecord.id]
      );
      logger.info('기존 reflection_notes 업데이트됨', {
        memory_id: existingRecord.id,
        task_goal: taskGoal
      });
    } else {
      const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      DatabaseUtils.run(
        this.db,
        `INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          memoryId,
          'procedural',
          `Reflexion: ${event.tool_name} 실패 기록`,
          taskGoal,
          JSON.stringify([]),
          finalReflectionNotes,
          0.7,
          'private',
          new Date().toISOString()
        ]
      );
      logger.info('새 reflection_notes 생성됨', {
        memory_id: memoryId,
        task_goal: taskGoal
      });
    }

    for (const warning of mergeResult.warnings) {
      logger.warn('reflection_notes 병합 경고', { warning });
    }

    if (mergeResult.removedCount > 0) {
      logger.warn('reflection_notes 크기 제한으로 인해 항목 제거됨', {
        removed_count: mergeResult.removedCount
      });
    }
  }

  private async recordWithoutTaskGoal(
    event: FailureEvent,
    reflectionNote: ReflectionNotes
  ): Promise<void> {
    const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    DatabaseUtils.run(
      this.db,
      `INSERT INTO memory_item (id, type, content, reflection_notes, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        memoryId,
        'procedural',
        `Reflexion: ${event.tool_name} 실패 기록`,
        JSON.stringify(reflectionNote),
        0.7,
        'private',
        new Date().toISOString()
      ]
    );
    logger.info('새 reflection_notes 생성됨 (task_goal 없음)', {
      memory_id: memoryId
    });
  }

  private toExistingReflectionNotes(
    reflectionNotes: string | null | undefined
  ): ExistingReflectionNotes {
    if (!reflectionNotes) {
      return { type: 'null', value: null };
    }

    const parsed = this.parseReflectionNotes(reflectionNotes);
    if (parsed.type === 'object') {
      return { type: 'object', value: parsed.value as ExistingReflectionNotes['value'] } as ExistingReflectionNotes;
    }
    if (parsed.type === 'array') {
      return { type: 'array', value: parsed.value as ExistingReflectionNotes['value'] } as ExistingReflectionNotes;
    }
    return { type: 'null', value: null };
  }

  private isDuplicate(event: FailureEvent): boolean {
    const eventKey = this.generateEventKey(event);
    const timestamp = this.duplicateWindow.get(eventKey);

    if (!timestamp) {
      return false;
    }

    const now = Date.now();
    if (now - timestamp < this.windowSizeMs) {
      return true;
    }

    this.duplicateWindow.delete(eventKey);
    return false;
  }

  private generateEventKey(event: FailureEvent): string {
    const keyString = `${event.tool_name}_${event.error_type}_${event.error_message_hash}`;
    return createHash('sha256').update(keyString).digest('hex');
  }

  private generateReflectionNote(event: FailureEvent): ReflectionNotes {
    return {
      failure_type: event.error_type,
      failure_description: event.error_message,
      timestamp: event.timestamp,
      original_task: event.original_task,
      lessons_learned: this.generateLessonsLearned(event),
      suggested_improvements: this.generateSuggestedImprovements(event),
      phase: 'auto'
    };
  }

  private generateLessonsLearned(event: FailureEvent): string {
    const templates: Record<string, string> = {
      tool_error: `${event.tool_name} 도구 실행 중 오류가 발생했습니다. 에러 유형을 분석하여 재발 방지 방안을 수립해야 합니다.`,
      user_feedback: `사용자 피드백을 통해 ${event.tool_name} 도구의 문제점이 확인되었습니다. 사용자 요구사항을 반영하여 개선이 필요합니다.`,
      metric_failure: `${event.tool_name} 도구의 성능 지표가 임계값을 초과했습니다. 성능 최적화가 필요합니다.`
    };

    return templates[event.error_type] || `${event.tool_name} 도구 실행 중 문제가 발생했습니다.`;
  }

  private generateSuggestedImprovements(event: FailureEvent): string {
    const errorMessage = event.error_message.toLowerCase();
    const suggestions: string[] = [];

    if (errorMessage.includes('validation') || errorMessage.includes('검증')) {
      suggestions.push('입력 파라미터 검증 로직을 강화해야 합니다.');
    }

    if (
      errorMessage.includes('database') ||
      errorMessage.includes('데이터베이스') ||
      errorMessage.includes('sqlite')
    ) {
      suggestions.push('데이터베이스 연결 및 쿼리 최적화가 필요합니다.');
    }

    if (errorMessage.includes('timeout') || errorMessage.includes('타임아웃')) {
      suggestions.push('타임아웃 설정을 조정하고 재시도 로직을 추가해야 합니다.');
    }

    if (event.context?.execution_time_ms && event.context.execution_time_ms > 5000) {
      suggestions.push('실행 시간이 길어 성능 최적화가 필요합니다.');
    }

    if (suggestions.length === 0) {
      suggestions.push('에러 로그를 분석하여 근본 원인을 파악하고 개선 방안을 수립해야 합니다.');
    }

    return suggestions.join(' ');
  }

  private analyzeFailurePattern(
    existing: ExistingReflectionNotes,
    currentEvent: FailureEvent
  ): FailurePatternAnalysis {
    let repeatCount = 1;
    const failureTypes = new Set<string>([currentEvent.error_type]);
    const tools = new Set<string>([currentEvent.tool_name]);
    const errorMessages: string[] = [currentEvent.error_message];

    if (existing.type === 'array') {
      repeatCount += existing.value.length;

      for (const note of existing.value) {
        if (note.failure_type) {
          failureTypes.add(note.failure_type);
        }
        if (note.tool_name) {
          tools.add(note.tool_name);
        }
        if (note.failure_description) {
          errorMessages.push(note.failure_description);
        }
      }
    } else if (existing.type === 'object') {
      repeatCount += 1;
      const note = existing.value;
      if (note.failure_type) {
        failureTypes.add(note.failure_type);
      }
      if (note.tool_name) {
        tools.add(note.tool_name);
      }
      if (note.failure_description) {
        errorMessages.push(note.failure_description);
      }
    }

    return {
      repeatCount,
      failureTypes: Array.from(failureTypes),
      tools: Array.from(tools),
      errorMessages
    };
  }

  private extractTaskGoal(event: FailureEvent): string | undefined {
    if (event.original_task) {
      return event.original_task;
    }

    const taskGoal = event.context?.params?.task_goal;
    if (typeof taskGoal === 'string') return taskGoal;

    // params.content 는 저장 대상 데이터이지 작업 목표가 아님 (#856)
    return undefined;
  }

  private parseReflectionNotes(reflectionNotes: string): {
    type: 'null' | 'object' | 'array';
    value: null | Record<string, unknown> | unknown[];
  } {
    if (!reflectionNotes) {
      return { type: 'null', value: null };
    }

    try {
      const parsed = JSON.parse(reflectionNotes);

      if (Array.isArray(parsed)) {
        return { type: 'array', value: parsed };
      } else if (typeof parsed === 'object' && parsed !== null) {
        return { type: 'object', value: parsed };
      } else {
        return { type: 'null', value: null };
      }
    } catch (error) {
      logger.warn('reflection_notes 파싱 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { type: 'null', value: null };
    }
  }
}
