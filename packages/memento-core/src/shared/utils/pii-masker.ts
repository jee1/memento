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

/**
 * PII 마스킹 결과
 */
export interface PIIMaskingResult {
  masked: string;           // 마스킹된 텍스트
  maskedCount: number;      // 마스킹된 항목 수
  maskedTypes: string[];    // 마스킹된 타입 목록
}

/**
 * PII 마스킹 옵션
 */
export interface PIIMaskingOptions {
  /**
   * 마스킹할 타입 목록 (지정하지 않으면 모든 타입 마스킹)
   */
  types?: Array<'email' | 'phone' | 'api_key' | 'password' | 'token' | 'credential'>;
  
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
  const envValue = process.env.ENABLE_PII_MASKING;
  if (envValue === undefined) {
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
    const types = options.types || ['email', 'phone', 'api_key', 'password', 'token', 'credential'];
    
    let masked = text;
    const maskedTypes: string[] = [];
    let totalMaskedCount = 0;

    // 이메일 주소 마스킹
    if (types.includes('email')) {
      const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const emailMatches = masked.match(emailPattern);
      if (emailMatches) {
        masked = masked.replace(emailPattern, usePlaceholder ? '[EMAIL]' : '');
        maskedTypes.push('email');
        totalMaskedCount += emailMatches.length;
      }
    }

    // 전화번호 마스킹 (한국 형식 포함)
    if (types.includes('phone')) {
      // 한국 전화번호: 010-1234-5678, 01012345678, +82-10-1234-5678 등
      const koreanPhonePattern = /(\+82[-.\s]?)?0?1[0-9]{1}[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{4}/g;
      const koreanMatches = masked.match(koreanPhonePattern);
      if (koreanMatches) {
        masked = masked.replace(koreanPhonePattern, usePlaceholder ? '[PHONE]' : '');
        if (!maskedTypes.includes('phone')) {
          maskedTypes.push('phone');
        }
        totalMaskedCount += koreanMatches.length;
      }

      // 국제 전화번호: +1-234-567-8900 등
      const internationalPhonePattern = /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;
      const internationalMatches = masked.match(internationalPhonePattern);
      if (internationalMatches) {
        masked = masked.replace(internationalPhonePattern, usePlaceholder ? '[PHONE]' : '');
        if (!maskedTypes.includes('phone')) {
          maskedTypes.push('phone');
        }
        totalMaskedCount += internationalMatches.length;
      }
    }

    // API 키 마스킹
    if (types.includes('api_key')) {
      // OpenAI API 키: sk-... 또는 sk-proj-... (하이픈·언더스코어 포함)
      const openaiKeyPattern = /sk-(?:proj-)?[a-zA-Z0-9_-]{20,}/g;
      const openaiMatches = masked.match(openaiKeyPattern);
      if (openaiMatches) {
        masked = masked.replace(openaiKeyPattern, usePlaceholder ? '[API_KEY]' : '');
        if (!maskedTypes.includes('api_key')) {
          maskedTypes.push('api_key');
        }
        totalMaskedCount += openaiMatches.length;
      }

      // Google API 키: AIza...
      const googleKeyPattern = /AIza[0-9A-Za-z_-]{35}/g;
      const googleMatches = masked.match(googleKeyPattern);
      if (googleMatches) {
        masked = masked.replace(googleKeyPattern, usePlaceholder ? '[API_KEY]' : '');
        if (!maskedTypes.includes('api_key')) {
          maskedTypes.push('api_key');
        }
        totalMaskedCount += googleMatches.length;
      }

      // 일반 API 키 패턴: api_key=..., OPENAI_API_KEY=..., *_SECRET=... (= 할당만; Token: 등은 토큰 마스킹에 위임)
      const generalApiKeyPattern = /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|SECRET)[A-Z0-9_]*|api[_-]?key|apikey)=[^\s&"',]+/gi;
      const generalMatches = masked.match(generalApiKeyPattern);
      if (generalMatches) {
        masked = masked.replace(generalApiKeyPattern, (match) => {
          const prefix = match.match(/^[^=:]+[=:]\s*/)?.[0] || '';
          return prefix + (usePlaceholder ? '[API_KEY]' : '');
        });
        if (!maskedTypes.includes('api_key')) {
          maskedTypes.push('api_key');
        }
        totalMaskedCount += generalMatches.length;
      }
    }

    // 비밀번호 마스킹
    if (types.includes('password')) {
      const passwordPattern = /\b(password|pwd|passwd)[=:]\s*[^\s&"']+/gi;
      const passwordMatches = masked.match(passwordPattern);
      if (passwordMatches) {
        masked = masked.replace(passwordPattern, (match) => {
          const prefix = match.match(/^[^=:]+[=:]\s*/)?.[0] || '';
          return prefix + (usePlaceholder ? '[PASSWORD]' : '');
        });
        maskedTypes.push('password');
        totalMaskedCount += passwordMatches.length;
      }
    }

    // 토큰 마스킹 (Bearer, JWT 등)
    if (types.includes('token')) {
      // Bearer 토큰
      const bearerTokenPattern = /\b(bearer|token)[=:]\s*[a-zA-Z0-9._-]{20,}/gi;
      const bearerMatches = masked.match(bearerTokenPattern);
      if (bearerMatches) {
        masked = masked.replace(bearerTokenPattern, (match) => {
          const prefix = match.match(/^[^=:]+[=:]\s*/)?.[0] || '';
          return prefix + (usePlaceholder ? '[TOKEN]' : '');
        });
        maskedTypes.push('token');
        totalMaskedCount += bearerMatches.length;
      }

      // JWT 토큰 (xxx.yyy.zzz 형식)
      const jwtPattern = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
      const jwtMatches = masked.match(jwtPattern);
      if (jwtMatches) {
        masked = masked.replace(jwtPattern, usePlaceholder ? '[JWT_TOKEN]' : '');
        if (!maskedTypes.includes('token')) {
          maskedTypes.push('token');
        }
        totalMaskedCount += jwtMatches.length;
      }
    }

    // 기타 credential 정보 마스킹
    if (types.includes('credential')) {
      // secret=..., key=..., token=... 등 (이미 마스킹된 것은 제외)
      const credentialPattern = /\b(secret|key|token|credential)[=:]\s*[a-zA-Z0-9._-]{10,}/gi;
      const credentialMatches = masked.match(credentialPattern);
      if (credentialMatches) {
        // 이미 마스킹된 패턴은 제외 (예: [API_KEY], [TOKEN] 등)
        const filteredMatches = credentialMatches.filter(match => 
          !match.includes('[API_KEY]') && 
          !match.includes('[TOKEN]') && 
          !match.includes('[PASSWORD]')
        );
        
        if (filteredMatches.length > 0) {
          masked = masked.replace(credentialPattern, (match) => {
            // 이미 마스킹된 것은 건너뛰기
            if (match.includes('[') && match.includes(']')) {
              return match;
            }
            const prefix = match.match(/^[^=:]+[=:]\s*/)?.[0] || '';
            return prefix + (usePlaceholder ? '[CREDENTIAL]' : '');
          });
          maskedTypes.push('credential');
          totalMaskedCount += filteredMatches.length;
        }
      }
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
  static maskObject(obj: any, visited: WeakSet<any> = new WeakSet()): any {
    // 환경 변수로 마스킹 비활성화된 경우 원본 반환
    if (!isPIIMaskingEnabled()) {
      return obj;
    }
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    // 순환 참조 감지
    if (visited.has(obj)) {
      return '[Circular Reference]';
    }
    visited.add(obj);

    try {
      // JSON 직렬화 후 마스킹
      const serialized = JSON.stringify(obj);
      const masked = this.mask(serialized).masked;
      // 역직렬화하여 객체로 복원
      return JSON.parse(masked);
    } catch {
      // 직렬화/역직렬화 실패 시 개별 필드에 마스킹 적용 시도
      const masked: any = Array.isArray(obj) ? [] : {};
      for (const [key, value] of Object.entries(obj)) {
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

