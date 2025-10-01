/**
 * 불용어(Stopwords) 관리 유틸리티
 * 한국어와 영어 불용어를 통합 관리
 */
/**
 * 한국어와 영어 불용어를 통합한 Set을 반환
 */
export declare function getStopWords(): Set<string>;
/**
 * 특정 언어의 불용어만 반환
 */
export declare function getEnglishStopWords(): Set<string>;
export declare function getKoreanStopWords(): Set<string>;
/**
 * 불용어인지 확인
 */
export declare function isStopWord(word: string): boolean;
//# sourceMappingURL=stopwords.d.ts.map