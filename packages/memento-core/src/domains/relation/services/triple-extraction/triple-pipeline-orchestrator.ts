import type {
  Triple,
  TripleExtractionFailureReason,
  TripleExtractionOptions,
  TripleExtractionResult,
  TriplePipelineChunkError,
  TriplePipelineResult,
} from '../../../../shared/types/triple-extraction.js';
import { mergeTripleLists } from './triple-chunk-merge.js';
import { splitTextIntoChunks } from './triple-text-chunker.js';

/**
 * 선택적 기본 청크 파라미터(향후 확장용). 현재 `run`은 `chunkSize`/`chunkOverlap`를 직접 받는다.
 */
export interface TriplePipelineOrchestratorConfig {
  defaultChunkSize?: number;
  defaultChunkOverlap?: number;
}

function chunkSucceeded(result: TripleExtractionResult): boolean {
  return (
    result.triples.length > 0 ||
    result.extractionInfo.failureReason === undefined
  );
}

function failureMessageFromResult(result: TripleExtractionResult): string | undefined {
  const raw = result.extractionInfo.rawLLMOutput;
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  return undefined;
}

export class TriplePipelineOrchestrator {
  constructor(_config?: TriplePipelineOrchestratorConfig) {
    void _config;
  }

  async run(
    params: {
      text: string;
      chunkSize: number;
      chunkOverlap: number;
      extractionOptions?: TripleExtractionOptions;
    },
    extract: (chunkText: string) => Promise<TripleExtractionResult>,
  ): Promise<TriplePipelineResult> {
    void params.extractionOptions;

    const trimmed = params.text.trim();
    if (trimmed === '') {
      return { triples: [], chunkErrors: [], chunksProcessed: 0 };
    }

    const chunks = splitTextIntoChunks(
      trimmed,
      params.chunkSize,
      params.chunkOverlap,
    );

    const chunkTriples: Triple[][] = [];
    const chunkErrors: TriplePipelineChunkError[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i]!;
      try {
        const result = await extract(chunkText);
        if (chunkSucceeded(result)) {
          chunkTriples.push(result.triples);
        } else {
          chunkTriples.push([]);
          const reason: TripleExtractionFailureReason =
            result.extractionInfo.failureReason ?? 'llm_api_error';
          chunkErrors.push({
            chunkIndex: i,
            reason,
            message: failureMessageFromResult(result),
          });
        }
      } catch (err: unknown) {
        chunkTriples.push([]);
        chunkErrors.push({
          chunkIndex: i,
          reason: 'llm_api_error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const merged = mergeTripleLists(chunkTriples);

    return {
      triples: merged,
      chunkErrors,
      chunksProcessed: chunks.length,
    };
  }
}
