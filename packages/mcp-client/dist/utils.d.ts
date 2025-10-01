/**
 * @memento/client 유틸리티 함수들
 * 클라이언트 라이브러리 사용을 편리하게 하는 헬퍼 함수들
 */
import type { MemoryType, PrivacyScope, MemoryItem } from './types.js';
/**
 * 유효한 메모리 타입인지 확인
 */
export declare function isValidMemoryType(type: string): type is MemoryType;
/**
 * 유효한 프라이버시 스코프인지 확인
 */
export declare function isValidPrivacyScope(scope: string): scope is PrivacyScope;
/**
 * 유효한 중요도 값인지 확인 (0-1 범위)
 */
export declare function isValidImportance(importance: number): boolean;
/**
 * 메모리 내용에서 태그 추출
 */
export declare function extractTagsFromContent(content: string): string[];
/**
 * 메모리 내용 요약 (지정된 길이로)
 */
export declare function summarizeContent(content: string, maxLength?: number): string;
/**
 * 메모리 중요도 계산 (내용 길이, 태그 수, 타입 기반)
 */
export declare function calculateImportance(content: string, tags?: string[], type?: MemoryType): number;
/**
 * 메모리 타입별 기본 설정
 */
export declare function getDefaultSettingsForType(type: MemoryType): {
    importance: number;
    privacyScope: PrivacyScope;
    ttlDays?: number;
};
/**
 * 검색 쿼리 정규화
 */
export declare function normalizeQuery(query: string): string;
/**
 * 검색 결과 점수 정규화 (0-1 범위)
 */
export declare function normalizeScore(score: number, minScore?: number, maxScore?: number): number;
/**
 * 검색 결과 그룹화 (타입별, 태그별)
 */
export declare function groupSearchResults(results: MemoryItem[], groupBy: 'type' | 'tags' | 'privacy_scope'): Record<string, MemoryItem[]>;
/**
 * 상대적 시간 문자열 생성
 */
export declare function getRelativeTime(date: string | Date): string;
/**
 * 날짜 범위 필터 생성
 */
export declare function createDateRangeFilter(days: number): {
    time_from: string;
    time_to: string;
};
/**
 * 메모리를 JSON으로 직렬화
 */
export declare function serializeMemory(memory: MemoryItem): string;
/**
 * JSON에서 메모리 역직렬화
 */
export declare function deserializeMemory(json: string): MemoryItem;
/**
 * 메모리 배열을 CSV로 변환
 */
export declare function memoriesToCSV(memories: MemoryItem[]): string;
/**
 * 메모리 배열을 Markdown으로 변환
 */
export declare function memoriesToMarkdown(memories: MemoryItem[]): string;
/**
 * 메모리 생성 파라미터 검증
 */
export declare function validateCreateMemoryParams(params: any): {
    isValid: boolean;
    errors: string[];
};
/**
 * 검색 파라미터 검증
 */
export declare function validateSearchParams(params: any): {
    isValid: boolean;
    errors: string[];
};
//# sourceMappingURL=utils.d.ts.map