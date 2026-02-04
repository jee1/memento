/**
 * Procedural Memory 구조화 diff (Issue #57 Phase 2)
 * 두 procedural 메모리의 workflow_name, skill_name, task_goal, trigger_conditions, steps 비교
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type {
  ProceduralDiffResult,
  FieldDiff,
  StepsDiffItem,
  StepChangeType
} from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';

function fieldDiff(left: string | null, right: string | null): FieldDiff {
  const l = left ?? null;
  const r = right ?? null;
  return { left: l, right: r, equal: l === r };
}

function parseStepsJson(raw: string | null): string[] {
  if (raw == null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((s: unknown) => String(s)) : [];
  } catch (err) {
    logger.debug('steps JSON 파싱 실패', { raw: raw?.substring(0, 100), error: err });
    return [];
  }
}

/**
 * Given: db, left_id, right_id.
 * When: computeProceduralDiff 호출.
 * Then: ProceduralDiffResult 반환. id 없거나 type !== procedural이면 null.
 */
export function computeProceduralDiff(
  db: Database.Database,
  leftId: string,
  rightId: string
): ProceduralDiffResult | null {
  const left = DatabaseUtils.get(
    db,
    `SELECT id, type, workflow_name, skill_name, task_goal, trigger_conditions, steps FROM memory_item WHERE id = ?`,
    [leftId]
  ) as { id: string; type: string; workflow_name: string | null; skill_name: string | null; task_goal: string | null; trigger_conditions: string | null; steps: string | null } | undefined;

  const right = DatabaseUtils.get(
    db,
    `SELECT id, type, workflow_name, skill_name, task_goal, trigger_conditions, steps FROM memory_item WHERE id = ?`,
    [rightId]
  ) as { id: string; type: string; workflow_name: string | null; skill_name: string | null; task_goal: string | null; trigger_conditions: string | null; steps: string | null } | undefined;

  if (!left || !right || left.type !== 'procedural' || right.type !== 'procedural') {
    return null;
  }

  const leftSteps = parseStepsJson(left.steps);
  const rightSteps = parseStepsJson(right.steps);
  const maxLen = Math.max(leftSteps.length, rightSteps.length);
  const steps: StepsDiffItem[] = [];

  for (let i = 0; i < maxLen; i++) {
    const l = leftSteps[i] ?? null;
    const r = rightSteps[i] ?? null;
    let change: StepChangeType;
    if (l == null && r != null) change = 'added';
    else if (l != null && r == null) change = 'removed';
    else if (l === r) change = 'same';
    else change = 'modified';
    steps.push({ index: i, left: l ?? undefined, right: r ?? undefined, change });
  }

  return {
    left_id: leftId,
    right_id: rightId,
    workflow_name: fieldDiff(left.workflow_name, right.workflow_name),
    skill_name: fieldDiff(left.skill_name, right.skill_name),
    task_goal: fieldDiff(left.task_goal, right.task_goal),
    trigger_conditions: fieldDiff(left.trigger_conditions, right.trigger_conditions),
    steps
  };
}
