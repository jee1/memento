/**
 * Procedural Memory 버전/비교 관련 공용 타입 (Issue #57 Phase 2)
 */

/** 필드별 문자열 diff (workflow_name, skill_name, task_goal, trigger_conditions) */
export interface FieldDiff {
  left: string | null;
  right: string | null;
  equal: boolean;
}

/** steps 배열 항목별 변경 유형 */
export type StepChangeType = 'same' | 'added' | 'removed' | 'modified';

export interface StepsDiffItem {
  index: number;
  left?: string | null;
  right?: string | null;
  change: StepChangeType;
}

export interface ProceduralDiffResult {
  left_id: string;
  right_id: string;
  workflow_name: FieldDiff;
  skill_name: FieldDiff;
  task_goal: FieldDiff;
  trigger_conditions: FieldDiff;
  steps: StepsDiffItem[];
}

export interface VersionChainItem {
  id: string;
  version: number;
  created_at: string;
}

/** recall version_filter 값 */
export type VersionFilterType = 'latest_only' | 'all_versions' | 'specific_version';
