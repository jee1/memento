/**
 * 검색 품질 라벨링 후보군 빌더
 * 하이브리드 상위 결과 + 랜덤 네거티브를 합쳐 중복 제거·순서 유지
 */

/**
 * 여러 순위 그룹을 합치되, 첫 등장 순서를 유지하며 중복 제거
 */
export function mergeCandidateIds(groups: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const group of groups) {
    for (const id of group) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
  }

  return merged;
}
