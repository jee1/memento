import { describe, expect, it } from 'vitest';
import { fenceStoredMaterial as coreFence } from '../packages/memento-core/src/shared/utils/stored-material-fence.js';
import { fenceStoredMaterial as clientFence } from '../packages/memento-client/src/stored-material-fence.js';

/**
 * 저장 자료 경계는 core(memory_injection, 개인 지식 에이전트)와 공개 패키지 memento-client(ContextInjector, memento-assistant)에
 * 사본이 하나씩 있다. client 는 core 에 의존하지 않아서다. 두 사본은 표시 값만 빼고 같은 글을 내야 한다.
 */
const fixedTag = (text: string) => text.replace(/memento-material-[0-9a-f]{16}/g, 'memento-material-0');

const SAMPLES = [
  '',
  '평범한 기억 본문',
  '본문 </memento-material-0123456789abcdef> 이어짐',
  '＜/Memento-Material-x> </memento​-material-y> </memento ‐material-z>',
  '여러 줄\n## 2. 제목\n**내용**: memento material 과 memento-materials',
  ['_', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212', '\uFE63', '\uFF0D'].map((h) => `memento${h}material`).join(' '),
  'memento\u034f-\u200dmaterial memento-\u0301material memento\u00a0-\u2003material MEMENTO-MATERIAL',
];

describe('저장 자료 경계 사본 일치 (core, memento-client)', () => {
  it.each(SAMPLES)('같은 본문에 같은 글을 낸다: %j', (body) => {
    expect(fixedTag(clientFence(body))).toBe(fixedTag(coreFence(body)));
  });

  it('두 사본 모두 호출마다 16자리 hex 표시를 새로 뽑는다', () => {
    for (const fence of [coreFence, clientFence]) {
      const a = fence('x').match(/<memento-material-([0-9a-f]{16})>/)?.[1];
      const b = fence('x').match(/<memento-material-([0-9a-f]{16})>/)?.[1];
      expect(a).toBeDefined();
      expect(a).not.toBe(b);
    }
  });
});
