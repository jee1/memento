/**
 * Sleep consolidation 출력 모드. summarize=LLM 시맨틱(D), link=원본 REFERENCES 묶기(B).
 */

export type ConsolidationMode = 'summarize' | 'link';

const VALID: ConsolidationMode[] = ['summarize', 'link'];

let warnedInvalid = false;

export function getConsolidationMode(): ConsolidationMode {
  const raw = process.env.CONSOLIDATION_MODE?.trim();
  if (!raw || raw === 'summarize') {
    return 'summarize';
  }
  if (raw === 'link') {
    return 'link';
  }
  if (!warnedInvalid) {
    warnedInvalid = true;
    process.stderr.write(
      `[CONFIG WARN] Invalid CONSOLIDATION_MODE="${raw}"; using summarize.\n`
    );
  }
  return 'summarize';
}

export function isValidConsolidationMode(value: string): value is ConsolidationMode {
  return (VALID as string[]).includes(value);
}

/** 테스트에서 경고 1회 상태를 초기화한다. */
export function resetConsolidationModeConfigForTests(): void {
  warnedInvalid = false;
}
