/**
 * triple-pipeline-orchestrator 단위 테스트
 */

import { describe, it, expect } from 'vitest';
import { TriplePipelineOrchestrator } from './triple-pipeline-orchestrator.js';
import type { Triple, TripleExtractionResult } from '../../../../shared/types/triple-extraction.js';

const okSteps = { canonicalization: true, entityLinking: true } as const;
const failSteps = { canonicalization: false, entityLinking: false } as const;

describe('TriplePipelineOrchestrator', () => {
  it('빈 텍스트면 청크 0·빈 트리플·에러 없음', async () => {
    const orchestrator = new TriplePipelineOrchestrator();
    const extract = async (): Promise<TripleExtractionResult> => ({
      triples: [],
      extractionInfo: { steps: okSteps },
    });

    const out = await orchestrator.run(
      { text: '   ', chunkSize: 10, chunkOverlap: 0 },
      extract,
    );

    expect(out.chunksProcessed).toBe(0);
    expect(out.triples).toEqual([]);
    expect(out.chunkErrors).toEqual([]);
  });

  it('단일 청크가 트리플을 반환하면 병합 결과에 포함된다', async () => {
    const orchestrator = new TriplePipelineOrchestrator();
    const t: Triple = { subject: 'A', predicate: 'p', object: 'B' };

    const out = await orchestrator.run(
      { text: 'short', chunkSize: 100, chunkOverlap: 0 },
      async () => ({
        triples: [t],
        extractionInfo: { steps: okSteps },
      }),
    );

    expect(out.chunksProcessed).toBe(1);
    expect(out.chunkErrors).toEqual([]);
    expect(out.triples).toEqual([t]);
  });

  it('두 청크가 모두 성공하면 mergeTripleLists가 적용된다', async () => {
    const orchestrator = new TriplePipelineOrchestrator();
    const t1: Triple = { subject: 'A', predicate: 'p', object: 'B' };
    const t2: Triple = { subject: 'C', predicate: 'q', object: 'D' };

    let call = 0;
    const out = await orchestrator.run(
      { text: 'aaaabbbb', chunkSize: 4, chunkOverlap: 0 },
      async () => {
        call += 1;
        if (call === 1) {
          return { triples: [t1], extractionInfo: { steps: okSteps } };
        }
        return { triples: [t2], extractionInfo: { steps: okSteps } };
      },
    );

    expect(out.chunksProcessed).toBe(2);
    expect(out.chunkErrors).toEqual([]);
    expect(out.triples).toEqual([t1, t2]);
  });

  it('두 번째 청크만 실패하면 chunkErrors 1건·첫 청크 트리플은 유지', async () => {
    const orchestrator = new TriplePipelineOrchestrator();
    const t1: Triple = { subject: 'A', predicate: 'p', object: 'B' };

    let call = 0;
    const out = await orchestrator.run(
      { text: 'aaaabbbb', chunkSize: 4, chunkOverlap: 0 },
      async () => {
        call += 1;
        if (call === 1) {
          return { triples: [t1], extractionInfo: { steps: okSteps } };
        }
        return {
          triples: [],
          extractionInfo: {
            failureReason: 'no_triple',
            steps: failSteps,
            rawLLMOutput: 'empty',
          },
        };
      },
    );

    expect(out.chunksProcessed).toBe(2);
    expect(out.triples).toEqual([t1]);
    expect(out.chunkErrors).toHaveLength(1);
    expect(out.chunkErrors[0]).toMatchObject({
      chunkIndex: 1,
      reason: 'no_triple',
      message: 'empty',
    });
  });
});
