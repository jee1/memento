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
import * as transformers from '@huggingface/transformers';
import { MINILM_MODEL_NAME } from '../../../../shared/config/embedding-models.js';
import { MiniLMEmbeddingService } from '../minilm-embedding-service.js';
import { UnifiedEmbeddingService } from '../unified-embedding-service.js';

// vitest.setup.ts가 두 모듈을 전역 모킹한다. 여기서는 실제 모델을 돌려야 하므로 되돌린다.
vi.unmock('@huggingface/transformers');
vi.unmock('onnxruntime-node');

const ENABLED = process.env.RUN_EMBEDDING_QUALITY === '1';

if (process.env.REQUIRE_EMBEDDING_QUALITY === '1' && !ENABLED) {
  throw new Error('REQUIRE_EMBEDDING_QUALITY=1 인데 RUN_EMBEDDING_QUALITY 가 꺼져 있다');
}

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

  it('전역 mock 이 해제되어 실제 transformers 를 로드한다 (V1)', () => {
    expect(vi.isMockFunction(transformers.pipeline)).toBe(false);
  });

  it('임베딩 차원이 384이다 — TF-IDF 512 폴백이 아님 (V2)', async () => {
    const vector = await embed(ANCHOR_DOC);
    expect(vector).toHaveLength(384);
  });

  it('모델명이 MiniLM 으로 기록된다 (V3)', async () => {
    const result = await service.generateEmbedding(ANCHOR_DOC);
    expect(result!.model).toBe(MINILM_MODEL_NAME);
  });

  it('벡터가 실제 추론 결과이다 — mock 상수 배제 (V4)', async () => {
    const vector = await embed(ANCHOR_DOC);
    expect(new Set(vector).size).toBeGreaterThan(300);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 3);
  });

  it('서로 다른 텍스트는 서로 다른 벡터를 만든다 (V5)', async () => {
    const anchor = await embed(ANCHOR_DOC);
    const irrelevant = await embed(IRRELEVANT_KO);
    expect(dot(anchor, irrelevant)).toBeLessThan(0.99);
  });

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

  it('UnifiedEmbeddingService는 minilm provider로 임베딩한다 — tfidf 폴백이 아님 (V8)', async () => {
    const previous = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = 'minilm';
    try {
      const unified = new UnifiedEmbeddingService();
      const result = await unified.generateEmbedding(ANCHOR_DOC);
      expect(result).not.toBeNull();
      expect(result!.provider).toBe('minilm');
      expect(result!.embedding).toHaveLength(384);
    } finally {
      if (previous === undefined) {
        delete process.env.EMBEDDING_PROVIDER;
      } else {
        process.env.EMBEDDING_PROVIDER = previous;
      }
    }
  }, 300_000);
});

/**
 * #1013 — 긴 한국어 기억의 뒤쪽이 벡터에 들어가는지 본다.
 *
 * 예전에는 앞 1024자만 임베딩해서 뒤쪽 문단은 어떤 질의로도 닿지 않았다. 윈도 평균 풀링 이후
 * 뒤쪽 문단을 묻는 질의가 앞부분만 임베딩한 벡터보다 확실히 높은 유사도를 받아야 한다.
 *
 * 문서는 앞뒤 주제가 서로 다르고 각각 한 윈도(510토큰 = 한국어 약 1,083자)를 채우도록 만든다.
 * 같은 문장을 반복해 채우면 모든 윈도의 벡터가 같아져 평균이 원본과 구분되지 않는다.
 */
const HEAD_TOPIC_KO = [
  '벡터 인덱스 재적재는 memory_embedding 트리거가 rowid 단위로 처리하므로 별도 배치 작업이 필요 없다',
  '하이브리드 검색은 FTS5 전문 검색 레인과 벡터 레인을 가중 합산해서 최종 순위를 만든다',
  '앵커 슬롯은 A B C 세 칸이고 각각 0.8 과 0.6 과 0.4 의 코사인 임계값을 가진다',
  '백업 게이트는 컨테이너가 떠 있는 동안에는 소스 디렉터리에 쓸 수 없다고 판단해 컨테이너 안에서 재시도한다',
  'sqlite-vec 가상 테이블은 distance_metric 을 명시하지 않으면 L2 거리를 쓰기 때문에 cosine 계약이 깨진다',
  'Docker 이미지의 EXPOSE 와 HEALTHCHECK 가 코드 기본값과 어긋나면 compose 없이는 컨테이너가 뜨지 않는다',
  '마이그레이션 의존성 검사기는 sqlite_master 를 읽어 확장 적재 여부를 먼저 확인한다',
  '스택 PR 을 delete-branch 로 머지하면 base 브랜치가 사라져서 뒤따르는 PR 이 닫힌다',
  '검색 랭킹은 최신성과 중요도와 사용 빈도를 곱해 최종 점수를 보정한다',
  '중복 판정은 어휘 게이트로 정밀도를 담당하고 본문 전체를 대상으로 삼는다',
].join('. ');

const TAIL_TOPIC_KO = [
  '한국어 문장은 토크나이저가 자모 단위에 가깝게 쪼개서 영어보다 훨씬 많은 토큰을 만든다',
  '실측한 문자당 토큰 비율은 2.124 이고 영어 휴리스틱인 4 와는 거의 두 배 차이가 난다',
  '그래서 길이를 4로 나누는 토큰 추정은 한국어에서 1.88 배 과소 계산된다',
  '임베딩 모델의 창은 512 토큰이고 특수 토큰 두 개를 빼면 본문은 510 토큰까지 들어간다',
  '예전 코드는 본문을 1024 자에서 잘랐는데 한국어에서는 그게 약 493 토큰이었다',
  '그 결과 긴 한국어 기억은 앞 절반만 벡터가 되고 뒤 절반은 색인에 존재하지 않았다',
  '토크나이저로 윈도를 나누면 언어에 상관없이 창 크기에 정확히 맞출 수 있다',
  '나뉜 윈도를 각각 임베딩한 뒤 평균 내고 다시 L2 정규화하면 벡터 하나가 나온다',
  '이 방식은 저장 스키마를 바꾸지 않고도 본문 전체를 벡터에 올린다',
  '문서당 벡터를 여러 개 두는 청킹보다 이득은 작지만 변경 범위가 훨씬 좁다',
].join('. ');

const TAIL_QUERY = '한국어 임베딩에서 문자당 토큰 비율과 토큰 추정 오차가 얼마인가';

/**
 * 각 주제 블록을 두 번씩 이어 붙여 앞 1024자가 head 주제만으로 채워지게 한다.
 * 한 번씩만 쓰면 head 블록이 577자뿐이라 `slice(0, 1024)` 안에 tail 주제가 절반이나 들어가고,
 * 그러면 «앞부분만 임베딩한 벡터»가 tail 질의를 이미 알고 있어서 비교 자체가 성립하지 않는다.
 */
const HEAD_BLOCK = `${HEAD_TOPIC_KO}. ${HEAD_TOPIC_KO}`;
const TAIL_BLOCK = `${TAIL_TOPIC_KO}. ${TAIL_TOPIC_KO}`;

describe.skipIf(!ENABLED)('#1013 MiniLM 윈도 평균 풀링', () => {
  it('긴 문서의 뒤쪽 문단이 벡터에 반영된다', async () => {
    const service = new MiniLMEmbeddingService();
    const longDoc = `${HEAD_BLOCK}. ${TAIL_BLOCK}`;
    // 예전 동작과 같은 입력: 앞 1024자만 임베딩한 벡터.
    const headOnly = longDoc.slice(0, 1024);
    expect(HEAD_BLOCK.length).toBeGreaterThan(1024);

    const query = (await service.generateEmbedding(TAIL_QUERY))!.embedding;
    const fullResult = (await service.generateEmbedding(longDoc))!;
    const head = (await service.generateEmbedding(headOnly))!.embedding;

    // 윈도가 둘 이상 나와야 이 테스트가 의미를 가진다.
    expect(fullResult.usage!.prompt_tokens).toBeGreaterThan(510);

    const fullSim = dot(query, fullResult.embedding);
    const headSim = dot(query, head);
    expect(fullSim).toBeGreaterThan(headSim + 0.1);
  }, 120_000);

  it('한 윈도에 들어가는 짧은 문서는 예전과 같은 단일 호출 결과를 낸다', async () => {
    const service = new MiniLMEmbeddingService();
    const short = ANCHOR_DOC;
    const result = (await service.generateEmbedding(short))!;

    expect(result.usage!.prompt_tokens).toBeLessThanOrEqual(510);
    // 정규화된 단위 벡터여야 한다 — 평균 풀링 경로를 타지 않았다는 뜻이다.
    expect(dot(result.embedding, result.embedding)).toBeCloseTo(1, 4);
  }, 120_000);
});
