/**
 * #889 한국어 검색 품질 회귀 테스트
 *
 * 영어 전용 모델(all-MiniLM-L6-v2)은 한국어 문장을 거의 UNK로 토크나이즈해서,
 * 관련 없는 한국어 문서가 관련 문서보다 높은 점수를 받았다. 이 테스트는 그 회귀를
 * 잡는다. 실제 모델을 내려받아야 하므로(q8 onnx 약 118MB) 기본은 건너뛴다.
 *
 *   RUN_EMBEDDING_QUALITY=1 npx vitest run packages/memento-core/src/domains/embedding/services/__tests__/minilm-korean-quality.spec.ts
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MiniLMEmbeddingService } from '../minilm-embedding-service.js';

// vitest.setup.ts가 두 모듈을 전역 모킹한다. 여기서는 실제 모델을 돌려야 하므로 되돌린다.
vi.unmock('@huggingface/transformers');
vi.unmock('onnxruntime-node');

const ENABLED = process.env.RUN_EMBEDDING_QUALITY === '1';

/** 주제가 서로 다른 한국어 문서. ANCHOR_DOC만 앵커 맵 질문의 정답이다. */
const ANCHOR_DOC = '대시보드 Anchor Map에서 노드 33개가 화면 밖으로 벗어나 Fit 버튼을 눌러야 보인다';
const CORPUS = [
  ANCHOR_DOC,
  'onnxruntime-node의 postinstall이 nuget.org에서 CUDA provider를 받다가 ETIMEDOUT으로 CI를 깨뜨린다',
  'better-sqlite3 네이티브 모듈은 생성자 안에서 애드온을 열기 때문에 require만으로는 로드 실패를 잡을 수 없다',
  'CSP script-src self는 실행되는 인라인 스크립트를 막지만 application/json 데이터 블록은 막지 않는다',
  '스택 PR을 --delete-branch로 머지하면 base 브랜치가 사라져 의존 PR이 닫힌다',
  '화자 분리는 pyannote segmentation으로 턴 경계를 먼저 찾아야 클러스터링이 맞는다',
];

const RELEVANT_KO = '앵커 맵 노드가 화면 밖으로 나가는 문제';
const RELEVANT_EN = 'anchor map nodes rendered off screen';
const IRRELEVANT_KO = '김치찌개 끓이는 법과 재료';

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let index = 0; index < a.length; index++) sum += a[index] * b[index];
  return sum;
}

describe.skipIf(!ENABLED)('#889 MiniLM 한국어 검색 품질', () => {
  const service = new MiniLMEmbeddingService();
  let documents: number[][] = [];

  async function embed(text: string): Promise<number[]> {
    const result = await service.generateEmbedding(text);
    expect(result, `임베딩 생성 실패: ${text}`).not.toBeNull();
    return result!.embedding;
  }

  /** 쿼리에 대한 문서 점수를 코퍼스 순서 그대로 돌려준다. */
  async function scores(query: string): Promise<number[]> {
    const queryVector = await embed(query);
    return documents.map((document) => dot(queryVector, document));
  }

  beforeAll(async () => {
    documents = [];
    for (const document of CORPUS) documents.push(await embed(document));
  }, 300_000);

  it('한국어 쿼리의 1등이 실제로 관련 있는 문서다', async () => {
    const ranked = await scores(RELEVANT_KO);
    const topIndex = ranked.indexOf(Math.max(...ranked));
    expect(CORPUS[topIndex]).toBe(ANCHOR_DOC);
  });

  it('영어 쿼리도 같은 한국어 문서를 1등으로 찾는다 (교차 언어)', async () => {
    const ranked = await scores(RELEVANT_EN);
    const topIndex = ranked.indexOf(Math.max(...ranked));
    expect(CORPUS[topIndex]).toBe(ANCHOR_DOC);
  });

  it('무관한 한국어 쿼리의 최고 점수가 관련 쿼리보다 낮다', async () => {
    const irrelevant = Math.max(...(await scores(IRRELEVANT_KO)));
    const relevant = Math.max(...(await scores(RELEVANT_KO)));
    expect(irrelevant).toBeLessThan(relevant);
  });

  it('무관한 한국어 쿼리는 하이브리드 임계값(0.38)을 넘지 않는다', async () => {
    // 이 하한이 통과 필터로 동작하던 것이 #889의 증상이었다.
    expect(Math.max(...(await scores(IRRELEVANT_KO)))).toBeLessThan(0.38);
  });
});
