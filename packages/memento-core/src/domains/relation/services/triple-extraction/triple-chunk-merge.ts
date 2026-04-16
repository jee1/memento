import type { Triple } from '../../../../shared/types/triple-extraction.js';

function tripleDedupeKey(triple: Triple): string {
  const s = triple.subject.trim().toLowerCase();
  const p = triple.predicate.trim().toLowerCase();
  const o = triple.object.trim().toLowerCase();
  return `${s}||${p}||${o}`;
}

/**
 * 여러 청크의 트리플 목록을 순서를 유지하며 합치고, SPO 정규화 키 기준으로 중복을 제거한다.
 * 먼저 등장한 트리플이 유지된다.
 */
export function mergeTripleLists(lists: Triple[][]): Triple[] {
  const seen = new Set<string>();
  const out: Triple[] = [];

  for (const list of lists) {
    for (const triple of list) {
      const key = tripleDedupeKey(triple);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(triple);
    }
  }

  return out;
}
