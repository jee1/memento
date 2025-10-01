/**
 * HTTP/WebSocket 기반 MCP 서버 v2
 * 모듈화된 구조로 새로 구현
 */
import express from 'express';
import { SearchEngine } from '../algorithms/search-engine.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import Database from 'better-sqlite3';
type TestDependencies = {
    database: Database.Database;
    searchEngine?: SearchEngine;
    hybridSearchEngine?: HybridSearchEngine;
    embeddingService?: MemoryEmbeddingService;
};
declare function cleanup(): Promise<void>;
declare function startServer(): Promise<void>;
export declare const __test: {
    setTestDependencies: (deps: TestDependencies) => void;
    getApp: () => express.Application;
    getServer: () => any;
    getDatabase: () => Database.Database | null;
    getSearchEngine: () => SearchEngine | undefined;
    getHybridSearchEngine: () => HybridSearchEngine | undefined;
    getEmbeddingService: () => MemoryEmbeddingService | undefined;
};
export { startServer, cleanup };
//# sourceMappingURL=http-server.d.ts.map