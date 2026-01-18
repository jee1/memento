/**
 * Entity Linker
 * Subject/Object 엔티티를 정규화하고 동일한 엔티티로 연결합니다.
 */

import type { EntityLinkingResult } from '../../../../shared/types/triple-extraction.js';

/**
 * Entity 사전
 * 표준 엔티티와 동의어 매핑
 * 
 * 구조:
 * - key: 표준 엔티티 (canonical form)
 * - value: 동의어 배열
 */
interface EntityDictionary {
    [canonical: string]: string[];
}

/**
 * 기본 Entity 사전
 * 자주 사용되는 일반적인 엔티티들에 대한 매핑
 */
const DEFAULT_ENTITY_DICTIONARY: EntityDictionary = {
    // 사용자 관련
    '사용자': ['user', '유저', '사용자', '나', 'i', 'me', 'myself', '내'],

    // 시스템/AI 관련
    '시스템': ['system', '시스템', 'ai', 'artificial intelligence', 'assistant', '어시스턴트', '너', 'you', '당신'],

    // 시간/날짜 관련 (상대적인 표현을 절대적인 개념으로 매핑하기는 어렵지만, 일반적인 표현 통일)
    '오늘': ['today', '금일', '현재'],
    '내일': ['tomorrow', '익일', '다음날'],
    '어제': ['yesterday', '작일', '전날'],
};

export class EntityLinker {
    private dictionary: EntityDictionary;
    private reverseIndex: Map<string, string>; // 동의어 -> 표준 엔티티 매핑

    constructor(customDictionary?: EntityDictionary) {
        this.dictionary = customDictionary || DEFAULT_ENTITY_DICTIONARY;
        this.reverseIndex = new Map<string, string>();
        this.buildReverseIndex();
    }

    /**
     * 역인덱스 구축 (동의어 -> 표준 엔티티)
     */
    private buildReverseIndex(): void {
        this.reverseIndex = new Map<string, string>();

        for (const [canonical, synonyms] of Object.entries(this.dictionary)) {
            // 표준 엔티티 자체도 매핑
            this.reverseIndex.set(this.normalizeKey(canonical), canonical);

            // 동의어들 매핑
            for (const synonym of synonyms) {
                this.reverseIndex.set(this.normalizeKey(synonym), canonical);
            }
        }
    }

    /**
     * 검색용 키 정규화
     * 대소문자 무시, 공백 제거
     */
    private normalizeKey(key: string): string {
        return key.toLowerCase().trim().replace(/\s+/g, '');
    }

    /**
     * 구조화된 엔티티인지 확인 (예외 규칙 적용)
     * 숫자, 날짜, 시간 등은 변환하지 않음
     */
    private isStructuredEntity(entity: string): boolean {
        const trimmed = entity.trim();

        // 숫자 (정수, 실수, 음수 포함)
        // 예: 123, -45.67, 0.5
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) return true;

        // 날짜 (YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD)
        // 예: 2025-01-15, 2025/01/01
        if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(trimmed)) return true;

        // 시간 (HH:MM, HH:MM:SS)
        // 예: 14:30, 09:00:00
        if (/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(trimmed)) return true;

        // 이메일 주소 (간단한 정규식)
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return true;

        // URL (http/https로 시작하는 경우)
        if (/^https?:\/\//i.test(trimmed)) return true;

        return false;
    }

    /**
     * Entity Linking 및 정규화 수행
     * 
     * @param entity 원본 엔티티 문자열
     * @returns EntityLinkingResult
     */
    public link(entity: string): EntityLinkingResult {
        if (!entity || typeof entity !== 'string') {
            return {
                linked: entity || '',
                original: entity || '',
                success: false,
                normalized: false
            };
        }

        const trimmed = entity.trim();
        if (trimmed.length === 0) {
            return {
                linked: '',
                original: entity,
                success: false,
                normalized: false
            };
        }

        // 1. 구조화된 엔티티 예외 처리 (숫자, 날짜 등)
        if (this.isStructuredEntity(trimmed)) {
            return {
                linked: trimmed,
                original: trimmed,
                success: true,
                normalized: false // 변환하지 않았음을 표시
            };
        }

        // 2. 사전 기반 매핑 확인
        const normalizedKey = this.normalizeKey(trimmed);
        const canonical = this.reverseIndex.get(normalizedKey);

        if (canonical) {
            return {
                linked: canonical,
                original: trimmed,
                success: true,
                normalized: canonical !== trimmed
            };
        }

        // 3. 매핑되지 않은 경우 기본 정규화
        // Lowercasing + 내부 다중 공백을 단일 공백으로 치환
        let basicNormalized = trimmed.toLowerCase().replace(/\s+/g, ' ');

        return {
            linked: basicNormalized,
            original: trimmed,
            success: true, // 사전에는 없지만 일반 정규화 성공으로 간주 (Open World Assumption)
            normalized: basicNormalized !== trimmed
        };
    }

    /**
     * 여러 엔티티 일괄 Linking
     */
    public linkBatch(entities: string[]): EntityLinkingResult[] {
        return entities.map(entity => this.link(entity));
    }

    /**
     * 사전에 Entity 추가
     * 
     * @param canonical 표준 엔티티
     * @param synonyms 동의어 배열
     */
    public addEntity(canonical: string, synonyms: string[]): void {
        if (!this.dictionary[canonical]) {
            this.dictionary[canonical] = [];
        }

        // 중복 제거 후 추가
        const existingSynonyms = new Set(this.dictionary[canonical]);
        for (const synonym of synonyms) {
            existingSynonyms.add(synonym);
        }
        this.dictionary[canonical] = Array.from(existingSynonyms);

        // 역인덱스 재구축
        this.buildReverseIndex();
    }
}
