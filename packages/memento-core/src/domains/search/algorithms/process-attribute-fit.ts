/**
 * Process Attribute Fit (Issue #91)
 * process별 주제/속성과 메모리 항목의 적합도(0~1)를 계산. recall 스코어링에 사용.
 */

import type { ProcessAttribute } from '../../../shared/types/search.types.js';

export interface ProcessAttributeFitItem {
  tags?: string[];
  workflow_name?: string | null;
  skill_name?: string | null;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function toSet(arr: string[] | undefined): Set<string> {
  if (!arr || arr.length === 0) return new Set();
  return new Set(arr.map(normalize).filter(Boolean));
}

/**
 * process 속성과 메모리 항목 간 적합도(0~1) 계산.
 * process의 topics/workflow_names/skill_names와 메모리의 tags/workflow_name/skill_name 겹침 비율.
 * attr이 null이거나 process 쪽 집합이 비어 있으면 1 반환(중립).
 */
export function computeProcessAttributeFit(
  attr: ProcessAttribute | null,
  item: ProcessAttributeFitItem
): number {
  if (attr == null) return 1;

  const processSet = new Set<string>([
    ...toSet(attr.topics),
    ...toSet(attr.workflow_names),
    ...toSet(attr.skill_names)
  ]);
  if (processSet.size === 0) return 1;

  const itemParts: string[] = [
    ...(item.tags ?? []),
    ...(item.workflow_name ? [item.workflow_name] : []),
    ...(item.skill_name ? [item.skill_name] : [])
  ];
  const itemSet = toSet(itemParts);
  if (itemSet.size === 0) return 0;

  let match = 0;
  for (const key of processSet) {
    if (itemSet.has(key)) match += 1;
  }
  return match / processSet.size;
}
