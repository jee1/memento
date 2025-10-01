/**
 * MemoryManager - 기억 관리를 위한 고수준 API
 * MementoClient를 래핑하여 더 편리한 기억 관리 기능을 제공합니다.
 *
 * @example
 * ```typescript
 * import { MemoryManager } from '@memento/client';
 *
 * const manager = new MemoryManager(client);
 *
 * // 기억 저장
 * const memory = await manager.create({
 *   content: 'React Hook 학습',
 *   type: 'episodic',
 *   tags: ['react', 'frontend']
 * });
 *
 * // 기억 검색
 * const results = await manager.search('React Hook');
 * ```
 */
import { MementoClient } from './memento-client.js';
export class MemoryManager {
    client;
    constructor(client) {
        this.client = client;
    }
    // ============================================================================
    // 기본 CRUD 작업
    // ============================================================================
    /**
     * 기억 생성
     */
    async create(params) {
        const result = await this.client.remember(params);
        // 생성된 기억의 상세 정보를 조회하여 반환
        return await this.client.getMemory(result.memory_id);
    }
    /**
     * 기억 조회
     */
    async get(id) {
        try {
            return await this.client.getMemory(id);
        }
        catch (error) {
            if (error.code === 'NOT_FOUND' || error.message?.includes('not found')) {
                return null;
            }
            throw error;
        }
    }
    /**
     * 기억 업데이트
     */
    async update(id, params) {
        return await this.client.updateMemory(id, params);
    }
    /**
     * 기억 삭제
     */
    async delete(id, hard = false) {
        const result = await this.client.forget(id, hard);
        return result.success;
    }
    // ============================================================================
    // 검색 기능
    // ============================================================================
    /**
     * 기억 검색
     */
    async search(query, options = {}) {
        const { filters, limit, useHybrid = false } = options;
        if (useHybrid) {
            const hybridResult = await this.client.hybridSearch({
                query,
                filters: filters || undefined,
                limit: limit || undefined
            });
            // HybridSearchResult를 SearchResult로 변환
            return {
                items: hybridResult.items.map(item => ({
                    ...item,
                    score: item.finalScore
                })),
                total_count: hybridResult.total_count,
                query_time: hybridResult.query_time
            };
        }
        else {
            return await this.client.recall(query, filters, limit);
        }
    }
    /**
     * 태그로 기억 검색
     */
    async searchByTags(tags, limit) {
        return await this.search('*', {
            filters: { tags },
            limit: limit || undefined
        });
    }
    /**
     * 타입별 기억 검색
     */
    async searchByType(type, limit) {
        return await this.search('*', {
            filters: { type: [type] },
            limit: limit || undefined
        });
    }
    /**
     * 프로젝트별 기억 검색
     */
    async searchByProject(projectId, limit) {
        return await this.search('', {
            filters: { project_id: projectId },
            limit: limit || undefined
        });
    }
    /**
     * 최근 기억 검색
     */
    async searchRecent(days = 7, limit) {
        const timeFrom = new Date();
        timeFrom.setDate(timeFrom.getDate() - days);
        return await this.search('', {
            filters: {
                time_from: timeFrom.toISOString()
            },
            limit: limit || undefined
        });
    }
    /**
     * 고정된 기억 검색
     */
    async searchPinned(limit) {
        return await this.search('', {
            filters: { pinned: true },
            limit: limit || undefined
        });
    }
    // ============================================================================
    // 고급 검색 기능
    // ============================================================================
    /**
     * 의미적 유사 기억 검색
     */
    async findSimilar(memoryId, limit = 5) {
        const memory = await this.get(memoryId);
        if (!memory) {
            throw new Error(`Memory with id ${memoryId} not found`);
        }
        return await this.search(memory.content, {
            filters: {
                type: [memory.type]
            },
            limit: limit + 1, // 자기 자신 제외를 위해 +1
            useHybrid: true
        });
    }
    /**
     * 관련 기억 검색 (태그 기반)
     */
    async findRelated(memoryId, limit = 5) {
        const memory = await this.get(memoryId);
        if (!memory || !memory.tags || memory.tags.length === 0) {
            return { items: [], total_count: 0, query_time: 0 };
        }
        return await this.searchByTags(memory.tags, limit + 1);
    }
    // ============================================================================
    // 기억 관리 기능
    // ============================================================================
    /**
     * 기억 고정
     */
    async pin(id) {
        const result = await this.client.pin(id);
        return result.success;
    }
    /**
     * 기억 고정 해제
     */
    async unpin(id) {
        const result = await this.client.unpin(id);
        return result.success;
    }
    /**
     * 기억 중요도 설정
     */
    async setImportance(id, importance) {
        if (importance < 0 || importance > 1) {
            throw new Error('Importance must be between 0 and 1');
        }
        return await this.update(id, { importance });
    }
    /**
     * 기억 태그 추가
     */
    async addTags(id, tags) {
        const memory = await this.get(id);
        if (!memory) {
            throw new Error(`Memory with id ${id} not found`);
        }
        const existingTags = memory.tags || [];
        const newTags = [...new Set([...existingTags, ...tags])];
        return await this.update(id, { tags: newTags });
    }
    /**
     * 기억 태그 제거
     */
    async removeTags(id, tags) {
        const memory = await this.get(id);
        if (!memory) {
            throw new Error(`Memory with id ${id} not found`);
        }
        const existingTags = memory.tags || [];
        const newTags = existingTags.filter(tag => !tags.includes(tag));
        return await this.update(id, { tags: newTags });
    }
    /**
     * 기억 태그 업데이트
     */
    async setTags(id, tags) {
        return await this.update(id, { tags });
    }
    /**
     * 기억 공개 범위 설정
     */
    async setPrivacyScope(id, privacyScope) {
        return await this.update(id, { privacy_scope: privacyScope });
    }
    // ============================================================================
    // 배치 작업
    // ============================================================================
    /**
     * 여러 기억 일괄 생성
     */
    async createBatch(params) {
        const results = [];
        for (const param of params) {
            try {
                const memory = await this.create(param);
                results.push(memory);
            }
            catch (error) {
                console.error(`Failed to create memory: ${param.content}`, error);
                // 에러가 발생해도 계속 진행
            }
        }
        return results;
    }
    /**
     * 여러 기억 일괄 삭제
     */
    async deleteBatch(ids, hard = false) {
        let successCount = 0;
        for (const id of ids) {
            try {
                const success = await this.delete(id, hard);
                if (success)
                    successCount++;
            }
            catch (error) {
                console.error(`Failed to delete memory: ${id}`, error);
            }
        }
        return successCount;
    }
    /**
     * 여러 기억 일괄 고정/해제
     */
    async pinBatch(ids, pin = true) {
        let successCount = 0;
        for (const id of ids) {
            try {
                const success = pin ? await this.pin(id) : await this.unpin(id);
                if (success)
                    successCount++;
            }
            catch (error) {
                console.error(`Failed to ${pin ? 'pin' : 'unpin'} memory: ${id}`, error);
            }
        }
        return successCount;
    }
    // ============================================================================
    // 통계 및 분석
    // ============================================================================
    /**
     * 기억 통계 조회
     */
    async getStats() {
        const allMemories = await this.search('*', { limit: 50 });
        const recentMemories = await this.searchRecent(7, 50);
        const stats = {
            total: allMemories.total_count,
            byType: {
                working: 0,
                episodic: 0,
                semantic: 0,
                procedural: 0
            },
            byPrivacyScope: {
                private: 0,
                team: 0,
                public: 0
            },
            pinned: 0,
            recent: recentMemories.total_count
        };
        for (const memory of allMemories.items) {
            stats.byType[memory.type]++;
            const privacyScope = memory.privacy_scope || 'private';
            stats.byPrivacyScope[privacyScope]++;
            if (memory.pinned)
                stats.pinned++;
        }
        return stats;
    }
    /**
     * 인기 태그 조회
     */
    async getPopularTags(limit = 10) {
        const allMemories = await this.search('', { limit: 1000 });
        const tagCounts = {};
        for (const memory of allMemories.items) {
            if (memory.tags) {
                for (const tag of memory.tags) {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                }
            }
        }
        return Object.entries(tagCounts)
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }
}
//# sourceMappingURL=memory-manager.js.map