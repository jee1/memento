/**
 * Reflection Notes JSON 정규화 유틸리티
 * 
 * reflection_notes 필드를 FTS5 인덱싱을 위해 텍스트로 정규화하는 유틸리티 함수를 제공합니다.
 * 트리거에서 사용되며, JSON 형식(단일 객체 또는 배열)을 FTS5 검색 가능한 텍스트로 변환합니다.
 */

/**
 * 키 토큰으로 포함할 필드 목록
 * 타입별 검색/필터링을 위해 중요한 키는 토큰으로 포함
 */
const KEY_TOKEN_FIELDS = ['failure_type', 'phase'] as const;

/**
 * 제외할 필드 목록
 * 검색에 불필요한 필드는 토큰화하지 않음
 */
const EXCLUDED_FIELDS = ['timestamp'] as const;

/**
 * 키 토큰 접두사 매핑
 * 키 앞에 접두사를 추가하여 키-값을 구분
 */
const KEY_TOKEN_PREFIXES: Record<string, string> = {
  failure_type: 'type',
  phase: 'phase'
};

/**
 * 단일 Reflection Note 객체를 텍스트로 정규화
 * 
 * 정규화 규칙:
 * - 키 토큰 포함: failure_type, phase는 "key:value" 형식으로 포함
 * - 값 필드 토큰화: 모든 값 필드를 추출하여 공백으로 구분
 * - 제외 필드: timestamp는 제외
 * 
 * @param note - 정규화할 Reflection Note 객체
 * @returns 정규화된 텍스트 문자열
 */
function normalizeReflectionNoteObject(note: unknown): string {
  if (!note || typeof note !== 'object') {
    return '';
  }

  const noteObj = note as Record<string, unknown>;
  const tokens: string[] = [];

  // 키 토큰 포함 (failure_type, phase)
  for (const key of KEY_TOKEN_FIELDS) {
    if (noteObj[key] !== undefined && noteObj[key] !== null) {
      const prefix = KEY_TOKEN_PREFIXES[key] || key;
      const value = String(noteObj[key]).trim();
      if (value.length > 0) {
        tokens.push(`${prefix}:${value}`);
      }
    }
  }

  // 값 필드 토큰화 (모든 값 필드 추출)
  for (const [key, value] of Object.entries(noteObj)) {
    // 키 토큰 필드와 제외 필드는 이미 처리했거나 제외
    if (KEY_TOKEN_FIELDS.includes(key as any) || EXCLUDED_FIELDS.includes(key as any)) {
      continue;
    }

    // 값이 문자열인 경우 토큰화
    if (typeof value === 'string' && value.trim().length > 0) {
      tokens.push(value.trim());
    }
    // 값이 숫자나 불린인 경우 문자열로 변환
    else if (typeof value === 'number' || typeof value === 'boolean') {
      tokens.push(String(value));
    }
    // 값이 객체나 배열인 경우 재귀적으로 처리하지 않음 (현재 스키마에서는 단순 값만 사용)
  }

  return tokens.join(' ');
}

/**
 * reflection_notes JSON을 FTS5 인덱싱을 위해 텍스트로 정규화
 * 
 * 정규화 규칙:
 * - 단일 객체: 모든 값 필드를 추출하여 공백으로 구분된 단일 문자열로 병합
 * - 배열: 각 요소의 모든 값 필드를 추출하여 공백으로 구분된 단일 문자열로 병합
 * - 키 토큰 포함: failure_type, phase는 "key:value" 형식으로 포함
 * - 제외 필드: timestamp는 제외
 * 
 * 예시:
 * - `{"failure_type": "tool_error", "failure_description": "API timeout"}` 
 *   → "type:tool_error API timeout"
 * - `[{"failure_description": "API timeout"}, {"lessons_learned": "retry needed"}]` 
 *   → "API timeout retry needed"
 * 
 * @param reflectionNotes - 정규화할 reflection_notes (JSON 문자열, 객체, 또는 배열)
 * @returns 정규화된 텍스트 문자열 (FTS5 인덱싱용)
 */
export function normalizeReflectionNotes(reflectionNotes: string | null | undefined | any): string {
  // NULL 또는 빈 값 처리
  if (!reflectionNotes || reflectionNotes === '') {
    return '';
  }

  // 문자열인 경우 JSON 파싱
  let parsed: unknown;
  if (typeof reflectionNotes === 'string') {
    try {
      parsed = JSON.parse(reflectionNotes);
    } catch (error) {
      // JSON 파싱 실패 시 빈 문자열 반환
      return '';
    }
  } else {
    parsed = reflectionNotes;
  }

  // 배열인 경우: 각 요소를 정규화하여 병합
  if (Array.isArray(parsed)) {
    const normalizedItems = parsed
      .map(item => normalizeReflectionNoteObject(item))
      .filter(text => text.length > 0);
    
    return normalizedItems.join(' ');
  }

  // 단일 객체인 경우: 정규화
  if (typeof parsed === 'object' && parsed !== null) {
    return normalizeReflectionNoteObject(parsed);
  }

  // 예상치 못한 타입인 경우 빈 문자열 반환
  return '';
}

/**
 * 정규화된 텍스트에서 키 토큰 추출 (검색 쿼리 빌더용)
 * 
 * @param normalizedText - 정규화된 텍스트
 * @returns 키 토큰 배열 (예: ["type:tool_error", "phase:manual"])
 */
export function extractKeyTokens(normalizedText: string): string[] {
  const tokens: string[] = [];
  const keyTokenPattern = /(type|phase):\w+/g;
  let match;
  
  while ((match = keyTokenPattern.exec(normalizedText)) !== null) {
    tokens.push(match[0]);
  }
  
  return tokens;
}

/**
 * 검색 쿼리 예시 생성 (문서화용)
 * 
 * @returns 검색 쿼리 예시 객체
 */
export function getSearchQueryExamples(): {
  description: string;
  query: string;
  explanation: string;
}[] {
  return [
    {
      description: 'tool_error 타입만 검색',
      query: 'type:tool_error',
      explanation: 'failure_type이 tool_error인 reflection_notes만 검색'
    },
    {
      description: '특정 키워드 검색',
      query: 'API timeout',
      explanation: 'failure_description, lessons_learned 등에서 "API timeout" 검색'
    },
    {
      description: '타입과 키워드 조합 검색',
      query: 'type:tool_error API',
      explanation: 'tool_error 타입이면서 "API"를 포함하는 reflection_notes 검색'
    },
    {
      description: 'phase 필터링',
      query: 'phase:auto',
      explanation: 'phase가 auto인 reflection_notes만 검색'
    }
  ];
}

