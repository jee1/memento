import { LlmProceduralExtractor } from '../../domains/memory/services/procedural-llm-extractor.js';
import type { FailureEvent } from '../../domains/monitoring/services/failure-detector.js';
import { mementoConfig } from '../../shared/config/index.js';
import {
  extractProceduralMemory,
  type ExtractedProceduralMemory
} from '../../shared/utils/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../../shared/utils/procedural-memory-extractor.types.js';

export async function resolveExtractedProceduralMemory(
  reflectionNote: ReflectionNotes | Record<string, unknown>,
  event: FailureEvent
): Promise<ExtractedProceduralMemory> {
  if (mementoConfig.proceduralExtractionStrategy !== 'llm_first') {
    return extractProceduralMemory(reflectionNote, event);
  }

  const llmExtractor = new LlmProceduralExtractor();
  const llmResult = await llmExtractor.extract(reflectionNote, event);
  if (llmResult && (llmResult.workflow_name || llmResult.skill_name)) {
    return llmResult;
  }

  return extractProceduralMemory(reflectionNote, event);
}
