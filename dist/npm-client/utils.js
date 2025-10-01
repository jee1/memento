/**
 * @memento/client 유틸리티 함수들
 * 클라이언트 라이브러리 사용을 편리하게 하는 헬퍼 함수들
 */
// ============================================================================
// 타입 검증 함수들
// ============================================================================
/**
 * 유효한 메모리 타입인지 확인
 */
export function isValidMemoryType(type) {
    return ['working', 'episodic', 'semantic', 'procedural'].includes(type);
}
/**
 * 유효한 프라이버시 스코프인지 확인
 */
export function isValidPrivacyScope(scope) {
    return ['private', 'team', 'public'].includes(scope);
}
/**
 * 유효한 중요도 값인지 확인 (0-1 범위)
 */
export function isValidImportance(importance) {
    return typeof importance === 'number' && importance >= 0 && importance <= 1;
}
// ============================================================================
// 메모리 관련 유틸리티
// ============================================================================
/**
 * 메모리 내용에서 태그 추출
 */
export function extractTagsFromContent(content) {
    // 해시태그 패턴 (#tag)
    const hashtags = content.match(/#[\w가-힣]+/g) || [];
    // @멘션 패턴 (@user)
    const mentions = content.match(/@[\w가-힣]+/g) || [];
    // 태그 패턴 (tag:value)
    const tagPatterns = content.match(/[\w가-힣]+:/g) || [];
    return [
        ...hashtags.map(tag => tag.substring(1)), // # 제거
        ...mentions.map(mention => mention.substring(1)), // @ 제거
        ...tagPatterns.map(tag => tag.substring(0, tag.length - 1)) // : 제거
    ];
}
/**
 * 메모리 내용 요약 (지정된 길이로)
 */
export function summarizeContent(content, maxLength = 200) {
    if (content.length <= maxLength) {
        return content;
    }
    // 문장 단위로 자르기
    const sentences = content.split(/[.!?]+/);
    let summary = '';
    for (const sentence of sentences) {
        if (summary.length + sentence.length <= maxLength) {
            summary += sentence + '.';
        }
        else {
            break;
        }
    }
    return summary || content.substring(0, maxLength) + '...';
}
/**
 * 메모리 중요도 계산 (내용 길이, 태그 수, 타입 기반)
 */
export function calculateImportance(content, tags = [], type = 'episodic') {
    let importance = 0.5; // 기본값
    // 내용 길이 기반 (긴 내용일수록 중요)
    const contentLength = content.length;
    if (contentLength > 500)
        importance += 0.2;
    else if (contentLength > 200)
        importance += 0.1;
    else if (contentLength < 50)
        importance -= 0.1;
    // 태그 수 기반 (태그가 많을수록 중요)
    const tagCount = tags.length;
    if (tagCount > 5)
        importance += 0.2;
    else if (tagCount > 2)
        importance += 0.1;
    else if (tagCount === 0)
        importance -= 0.1;
    // 타입 기반
    switch (type) {
        case 'semantic':
            importance += 0.2; // 의미기억은 중요
            break;
        case 'procedural':
            importance += 0.1; // 절차기억도 중요
            break;
        case 'working':
            importance -= 0.1; // 작업기억은 덜 중요
            break;
    }
    // 0-1 범위로 클램프
    return Math.max(0, Math.min(1, importance));
}
/**
 * 메모리 타입별 기본 설정
 */
export function getDefaultSettingsForType(type) {
    switch (type) {
        case 'working':
            return {
                importance: 0.3,
                privacyScope: 'private',
                ttlDays: 2
            };
        case 'episodic':
            return {
                importance: 0.6,
                privacyScope: 'private',
                ttlDays: 90
            };
        case 'semantic':
            return {
                importance: 0.8,
                privacyScope: 'team'
                // ttlDays: undefined // 무기한 - exactOptionalPropertyTypes 때문에 제거
            };
        case 'procedural':
            return {
                importance: 0.7,
                privacyScope: 'team',
                ttlDays: 180
            };
    }
}
// ============================================================================
// 검색 관련 유틸리티
// ============================================================================
/**
 * 검색 쿼리 정규화
 */
export function normalizeQuery(query) {
    return query
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ') // 여러 공백을 하나로
        .replace(/[^\w\s가-힣]/g, ''); // 특수문자 제거
}
/**
 * 검색 결과 점수 정규화 (0-1 범위)
 */
export function normalizeScore(score, minScore = 0, maxScore = 1) {
    if (maxScore === minScore)
        return 0;
    return Math.max(0, Math.min(1, (score - minScore) / (maxScore - minScore)));
}
/**
 * 검색 결과 그룹화 (타입별, 태그별)
 */
export function groupSearchResults(results, groupBy) {
    const groups = {};
    for (const result of results) {
        let key;
        switch (groupBy) {
            case 'type':
                key = result.type;
                break;
            case 'tags':
                key = result.tags?.join(',') || 'untagged';
                break;
            case 'privacy_scope':
                key = result.privacy_scope;
                break;
            default:
                key = 'unknown';
        }
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(result);
    }
    return groups;
}
// ============================================================================
// 시간 관련 유틸리티
// ============================================================================
/**
 * 상대적 시간 문자열 생성
 */
export function getRelativeTime(date) {
    const now = new Date();
    const target = new Date(date);
    const diffMs = now.getTime() - target.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    if (diffDays > 0) {
        return `${diffDays}일 전`;
    }
    else if (diffHours > 0) {
        return `${diffHours}시간 전`;
    }
    else if (diffMinutes > 0) {
        return `${diffMinutes}분 전`;
    }
    else {
        return '방금 전';
    }
}
/**
 * 날짜 범위 필터 생성
 */
export function createDateRangeFilter(days) {
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return {
        time_from: from.toISOString(),
        time_to: now.toISOString()
    };
}
// ============================================================================
// 데이터 변환 유틸리티
// ============================================================================
/**
 * 메모리를 JSON으로 직렬화
 */
export function serializeMemory(memory) {
    return JSON.stringify(memory, null, 2);
}
/**
 * JSON에서 메모리 역직렬화
 */
export function deserializeMemory(json) {
    return JSON.parse(json);
}
/**
 * 메모리 배열을 CSV로 변환
 */
export function memoriesToCSV(memories) {
    if (memories.length === 0)
        return '';
    const headers = [
        'id',
        'content',
        'type',
        'importance',
        'created_at',
        'last_accessed',
        'pinned',
        'tags',
        'privacy_scope',
        'source'
    ];
    const rows = memories.map(memory => [
        memory.id,
        `"${memory.content.replace(/"/g, '""')}"`, // CSV 이스케이프
        memory.type,
        memory.importance,
        memory.created_at,
        memory.last_accessed || '',
        memory.pinned,
        memory.tags?.join(';') || '',
        memory.privacy_scope,
        memory.source || ''
    ]);
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}
/**
 * 메모리 배열을 Markdown으로 변환
 */
export function memoriesToMarkdown(memories) {
    if (memories.length === 0)
        return '# 기억이 없습니다\n';
    let markdown = `# 기억 목록 (${memories.length}개)\n\n`;
    for (const memory of memories) {
        const typeEmoji = {
            working: '⚡',
            episodic: '📅',
            semantic: '🧠',
            procedural: '🔧'
        }[memory.type] || '📝';
        const importanceBar = '★'.repeat(Math.round(memory.importance * 5)) +
            '☆'.repeat(5 - Math.round(memory.importance * 5));
        markdown += `## ${typeEmoji} ${memory.id}\n\n`;
        markdown += `**내용**: ${memory.content}\n\n`;
        markdown += `**타입**: ${memory.type}\n`;
        markdown += `**중요도**: ${importanceBar} (${memory.importance})\n`;
        markdown += `**생성일**: ${memory.created_at}\n`;
        if (memory.last_accessed) {
            markdown += `**마지막 접근**: ${memory.last_accessed}\n`;
        }
        if (memory.tags && memory.tags.length > 0) {
            markdown += `**태그**: ${memory.tags.map(tag => `#${tag}`).join(' ')}\n`;
        }
        markdown += `**공개 범위**: ${memory.privacy_scope}\n`;
        if (memory.pinned) {
            markdown += `**고정됨**: ✅\n`;
        }
        markdown += '\n---\n\n';
    }
    return markdown;
}
// ============================================================================
// 검증 유틸리티
// ============================================================================
/**
 * 메모리 생성 파라미터 검증
 */
export function validateCreateMemoryParams(params) {
    const errors = [];
    if (!params.content || typeof params.content !== 'string') {
        errors.push('content는 필수이며 문자열이어야 합니다');
    }
    if (params.type && !isValidMemoryType(params.type)) {
        errors.push('type은 working, episodic, semantic, procedural 중 하나여야 합니다');
    }
    if (params.importance !== undefined && !isValidImportance(params.importance)) {
        errors.push('importance는 0과 1 사이의 숫자여야 합니다');
    }
    if (params.privacy_scope && !isValidPrivacyScope(params.privacy_scope)) {
        errors.push('privacy_scope는 private, team, public 중 하나여야 합니다');
    }
    if (params.tags && !Array.isArray(params.tags)) {
        errors.push('tags는 배열이어야 합니다');
    }
    return {
        isValid: errors.length === 0,
        errors
    };
}
/**
 * 검색 파라미터 검증
 */
export function validateSearchParams(params) {
    const errors = [];
    if (!params.query || typeof params.query !== 'string') {
        errors.push('query는 필수이며 문자열이어야 합니다');
    }
    if (params.limit !== undefined && (typeof params.limit !== 'number' || params.limit < 0)) {
        errors.push('limit은 0 이상의 숫자여야 합니다');
    }
    if (params.filters) {
        if (params.filters.type && !Array.isArray(params.filters.type)) {
            errors.push('filters.type은 배열이어야 합니다');
        }
        if (params.filters.tags && !Array.isArray(params.filters.tags)) {
            errors.push('filters.tags는 배열이어야 합니다');
        }
    }
    return {
        isValid: errors.length === 0,
        errors
    };
}
//# sourceMappingURL=utils.js.map