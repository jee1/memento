/**
 * SQL 보안 검증 유틸리티
 * SQL Injection 방지를 위한 공통 검증 함수 제공
 * 
 * PRD 0019: 보안 강화 (Phase 1) - SQL Injection 방지
 */

import { VECTOR_SEARCH_CONFIG } from '../../shared/config/vector-search.config.js';

/**
 * SQL Injection 방지를 위한 테이블명 화이트리스트 검증
 * 허용된 테이블명만 사용하도록 보장합니다.
 * 
 * @param tableName 검증할 테이블명
 * @param allowedTableNames 허용된 테이블명 목록 (선택적, 미지정 시 VECTOR_SEARCH_CONFIG.tableNames 사용)
 * @throws Error 허용되지 않은 테이블명인 경우
 */
export function validateTableName(
  tableName: string,
  allowedTableNames?: string[]
): void {
  // 1. 화이트리스트에 정의된 테이블명만 허용
  const allowed = allowedTableNames ?? Object.values(VECTOR_SEARCH_CONFIG.tableNames);
  if (!allowed.includes(tableName)) {
    throw new Error(
      `SQL Injection 방지: 허용되지 않은 테이블명입니다. ` +
      `허용된 테이블명: ${allowed.join(', ')}. ` +
      `입력된 테이블명: ${tableName}`
    );
  }
  
  // 2. 테이블명 패턴 검증: 소문자, 숫자, 언더스코어만 허용
  const tableNamePattern = /^[a-z0-9_]+$/;
  if (!tableNamePattern.test(tableName)) {
    throw new Error(
      `SQL Injection 방지: 테이블명은 소문자, 숫자, 언더스코어만 허용됩니다. ` +
      `입력된 테이블명: ${tableName}`
    );
  }
  
  // 3. SQL 키워드 포함 여부 확인
  const sqlKeywords = [
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
    'FROM', 'WHERE', 'JOIN', 'UNION', 'EXEC', 'EXECUTE', 'SCRIPT',
    '--', '/*', '*/', ';', '\'', '"', '`'
  ];
  const upperTableName = tableName.toUpperCase();
  for (const keyword of sqlKeywords) {
    if (upperTableName.includes(keyword.toUpperCase())) {
      throw new Error(
        `SQL Injection 방지: 테이블명에 SQL 키워드가 포함되어 있습니다. ` +
        `키워드: ${keyword}, 테이블명: ${tableName}`
      );
    }
  }
}

/**
 * 벡터 검색 테이블명을 provider로부터 안전하게 가져오기
 * 화이트리스트 검증을 포함합니다.
 * 
 * @param provider 임베딩 provider 이름
 * @returns 검증된 테이블명
 * @throws Error 허용되지 않은 provider인 경우
 */
export function getVectorTableName(provider: string): string {
  const normalizedProvider = provider.toLowerCase();
  
  // 화이트리스트에서 테이블명 조회
  const tableName = VECTOR_SEARCH_CONFIG.tableNames[normalizedProvider as keyof typeof VECTOR_SEARCH_CONFIG.tableNames];
  
  if (!tableName) {
    // 알 수 없는 provider의 경우 기본 테이블 사용 (하위 호환성 유지)
    const defaultTableName = VECTOR_SEARCH_CONFIG.tableNames.tfidf as string;
    // 기본 테이블명도 화이트리스트 검증 수행
    validateTableName(defaultTableName);
    return defaultTableName;
  }
  
  // 화이트리스트 검증 수행
  validateTableName(tableName);
  
  return tableName as string;
}

