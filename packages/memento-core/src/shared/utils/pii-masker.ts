/**
 * PII (Personally Identifiable Information) 마스킹 유틸리티
 * 
 * 로그 파일에 저장되는 rawLLMOutput에서 민감한 정보를 마스킹합니다.
 * 
 * 마스킹 대상:
 * - 이메일 주소
 * - 전화번호
 * - API 키
 * - 비밀번호
 * - 토큰 (Bearer, JWT 등)
 * - 기타 credential 정보
 * 
 * 보안 정책:
 * - 모든 민감 정보는 [TYPE] 형식으로 마스킹
 * - 원본 정보는 복구 불가능하도록 완전히 제거
 */

type PIIType = 'email' | 'phone' | 'api_key' | 'password' | 'token' | 'credential';

const ALL_PII_TYPES: PIIType[] = ['email', 'phone', 'api_key', 'password', 'token', 'credential'];

/** `key=` · `key: ` 접두어. keepPrefix 규칙은 이 부분을 남기고 값만 가린다. */
const KEY_PREFIX = /^[^=:]+[=:]\s*/;

interface PIIRule {
  type: PIIType;
  pattern: RegExp;
  placeholder: string;
  keepPrefix?: boolean;
}

/** 적용 순서대로 나열한다. 패턴은 #854·#1133 경계 조건을 담고 있으니 이 표를 고칠 때 함께 확인할 것. */
const PII_RULES: PIIRule[] = [
  // 이메일 주소
  { type: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, placeholder: '[EMAIL]' },
  // 한국 휴대전화: 010/011/016–019 또는 +82 국제 표기만.
  // 숫자 lookaround — epoch-ms·memory_id 내부 부분매치 금지 (#854).
  {
    type: 'phone',
    pattern: /(?<![0-9])(?:\+82[-.\s]?1[0-9]|01[0-9])[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{4}(?![0-9])/g,
    placeholder: '[PHONE]'
  },
  // 국제 전화번호: +1-234-567-8900 등 (긴 숫자열 부분 절단 금지 — #854)
  {
    type: 'phone',
    pattern: /(?<![0-9])\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}(?![0-9])/g,
    placeholder: '[PHONE]'
  },
  // OpenAI API 키: sk-... 또는 sk-proj-... (하이픈·언더스코어 포함)
  { type: 'api_key', pattern: /sk-(?:proj-)?[a-zA-Z0-9_-]{20,}/g, placeholder: '[API_KEY]' },
  // Google API 키: AIza...
  { type: 'api_key', pattern: /AIza[0-9A-Za-z_-]{35}/g, placeholder: '[API_KEY]' },
  // 일반 API 키 패턴: api_key=..., OPENAI_API_KEY=..., *_SECRET=... (= 할당만; Token: 등은 토큰 마스킹에 위임)
  {
    type: 'api_key',
    pattern: /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|SECRET)[A-Z0-9_]*|api[_-]?key|apikey)=[^\s&"',]+/gi,
    placeholder: '[API_KEY]',
    keepPrefix: true
  },
  // 비밀번호
  { type: 'password', pattern: /\b(password|pwd|passwd)[=:]\s*[^\s&"']+/gi, placeholder: '[PASSWORD]', keepPrefix: true },
  // Bearer 토큰
  { type: 'token', pattern: /\b(bearer|token)[=:]\s*[a-zA-Z0-9._-]{20,}/gi, placeholder: '[TOKEN]', keepPrefix: true },
  // JWT 토큰 (header.payload.signature 3-segment 형식)
  { type: 'token', pattern: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, placeholder: '[JWT_TOKEN]' },
  // 기타 credential: secret=..., key=..., token=... 등.
  // 값 문자 집합에 '[' 가 없어 이미 가린 [API_KEY]·[TOKEN] 은 매치되지 않는다.
  {
    type: 'credential',
    pattern: /\b(secret|key|token|credential)[=:]\s*[a-zA-Z0-9._-]{10,}/gi,
    placeholder: '[CREDENTIAL]',
    keepPrefix: true
  }
];

/**
 * PII 마스킹 결과
 */
interface PIIMaskingResult {
  masked: string;           // 마스킹된 텍스트
  maskedCount: number;      // 마스킹된 항목 수
  maskedTypes: string[];    // 마스킹된 타입 목록
}

/**
 * PII 마스킹 옵션
 */
interface PIIMaskingOptions {
  /**
   * 마스킹할 타입 목록 (지정하지 않으면 모든 타입 마스킹)
   */
  types?: PIIType[];
  
  /**
   * 마스킹 플레이스홀더 사용 여부 (기본값: true)
   * false인 경우 빈 문자열로 대체
   */
  usePlaceholder?: boolean;
}

/**
 * PII 마스킹 활성화 여부 확인
 * 환경 변수 `ENABLE_PII_MASKING`으로 제어 (기본값: true)
 * 
 * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
 * - 프로덕션: 기본값 true (보안 우선, 변경 불가)
 * - 스테이징: 기본값 true (보안 우선, ENABLE_PII_MASKING=false로 선택적 비활성화 가능)
 * - 로컬/개발: 기본값 true (보안 우선, ENABLE_PII_MASKING=false로 선택적 비활성화 가능)
 */
function isPIIMaskingEnabled(): boolean {
  // 빈 문자열은 «미설정» 으로 읽는다. compose 가 `${ENABLE_PII_MASKING:-}` 로 넘기므로
  // undefined 만 검사하면 .env 에 키가 없는 배포에서 마스킹이 꺼진다 (#1133).
  const envValue = process.env.ENABLE_PII_MASKING?.trim();
  if (!envValue) {
    // 환경 변수 미지정 시 기본값: true (보안 우선)
    return true;
  }
  // 환경 변수가 지정된 경우: 'true', '1', 'yes' 등은 true, 그 외는 false
  const normalized = envValue.toLowerCase().trim();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * PII 마스킹기
 */
export class PIIMasker {
  /**
   * 텍스트에서 모든 PII를 마스킹합니다.
   * 
   * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
   * 환경 변수 `ENABLE_PII_MASKING`으로 마스킹 활성화/비활성화 제어
   * 
   * @param text 원본 텍스트
   * @param options 마스킹 옵션
   * @returns 마스킹 결과
   */
  static mask(text: string, options: PIIMaskingOptions = {}): PIIMaskingResult {
    // 환경 변수로 마스킹 비활성화된 경우 원본 반환
    if (!isPIIMaskingEnabled()) {
      return {
        masked: text || '',
        maskedCount: 0,
        maskedTypes: []
      };
    }
    if (!text || typeof text !== 'string') {
      return {
        masked: text || '',
        maskedCount: 0,
        maskedTypes: []
      };
    }

    const usePlaceholder = options.usePlaceholder !== false;
    const types = options.types || ALL_PII_TYPES;

    let masked = text;
    const maskedTypes: string[] = [];
    let totalMaskedCount = 0;

    // 순서가 결과를 정한다: 앞 규칙이 바꾼 텍스트에 다음 규칙을 적용한다.
    for (const rule of PII_RULES) {
      if (!types.includes(rule.type)) continue;
      const matches = masked.match(rule.pattern);
      if (!matches) continue;
      const placeholder = usePlaceholder ? rule.placeholder : '';
      masked = rule.keepPrefix
        ? masked.replace(rule.pattern, match => (match.match(KEY_PREFIX)?.[0] || '') + placeholder)
        : masked.replace(rule.pattern, placeholder);
      maskedTypes.push(rule.type);
      totalMaskedCount += matches.length;
    }

    return {
      masked,
      maskedCount: totalMaskedCount,
      maskedTypes: [...new Set(maskedTypes)] // 중복 제거
    };
  }

  /**
   * 텍스트에 PII가 포함되어 있는지 확인합니다.
   * 
   * @param text 확인할 텍스트
   * @returns PII 포함 여부
   */
  static hasPII(text: string): boolean {
    if (!text || typeof text !== 'string') {
      return false;
    }

    const result = this.mask(text, { usePlaceholder: false });
    return result.maskedCount > 0;
  }

  /**
   * 텍스트에서 마스킹된 PII 타입 목록을 반환합니다.
   * 
   * @param text 확인할 텍스트
   * @returns 마스킹된 타입 목록
   */
  static detectPIITypes(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const result = this.mask(text, { usePlaceholder: false });
    return result.maskedTypes;
  }

  /**
   * 객체의 PII 마스킹
   * JSON 직렬화 후 마스킹하여 중첩 객체의 PII도 마스킹
   * 
   * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
   * 공통 유틸리티 함수로 추출하여 중복 코드 제거
   * 환경 변수 `ENABLE_PII_MASKING`으로 마스킹 활성화/비활성화 제어
   * 
   * @param obj 마스킹할 객체
   * @returns 마스킹된 객체
   */
  static maskObject(obj: unknown, visited: WeakSet<object> = new WeakSet()): Record<string, unknown> {
    // 환경 변수로 마스킹 비활성화된 경우 원본 반환
    if (!isPIIMaskingEnabled()) {
      return obj as Record<string, unknown>;
    }
    if (!obj || typeof obj !== 'object') {
      return obj as Record<string, unknown>;
    }

    // 순환 참조 감지
    if (visited.has(obj)) {
      return { _circular: '[Circular Reference]' };
    }
    visited.add(obj);

    try {
      // JSON 직렬화 후 마스킹
      const serialized = JSON.stringify(obj);
      const masked = this.mask(serialized).masked;
      // 역직렬화하여 객체로 복원
      return JSON.parse(masked) as Record<string, unknown>;
    } catch {
      // 직렬화/역직렬화 실패 시 개별 필드에 마스킹 적용 시도
      const objRecord = obj as Record<string, unknown>;
      const masked: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(objRecord)) {
        if (typeof value === 'string') {
          masked[key] = this.mask(value).masked;
        } else if (typeof value === 'object' && value !== null) {
          // 순환 참조 체크
          if (visited.has(value)) {
            masked[key] = '[Circular Reference]';
          } else {
            masked[key] = this.maskObject(value, visited);
          }
        } else {
          masked[key] = value;
        }
      }
      return masked;
    }
  }

  /**
   * Error 객체의 PII 마스킹
   * error.message와 error.stack에 PII 마스킹 적용
   * 
   * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
   * 공통 유틸리티 함수로 추출하여 중복 코드 제거
   * 환경 변수 `ENABLE_PII_MASKING`으로 마스킹 활성화/비활성화 제어
   * 
   * @param error 마스킹할 Error 객체
   * @returns 마스킹된 Error 정보 객체
   */
  static maskError(error: Error): { message: string; name: string; stack?: string } {
    // 환경 변수로 마스킹 비활성화된 경우 원본 반환
    if (!isPIIMaskingEnabled()) {
      return {
        message: error.message,
        name: error.name,
        stack: error.stack
      };
    }
    return {
      message: this.mask(error.message).masked,
      name: error.name,
      stack: error.stack ? this.mask(error.stack).masked : undefined
    };
  }
}

