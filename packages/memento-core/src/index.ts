/**
 * Memento Core - 범용 메모리 플랫폼 공개 엔트리.
 * Phase 1: facade; 실제 구현은 루트 src/에 유지.
 * Assistant가 사용할 계약: remember/recall 파라미터·공통 memory 타입은
 * 루트 src/shared/types, src/npm-client/types 및 MCP/HTTP tool contract로 제공됨.
 */

export { createCoreToolHttpClient } from './http-tool-client.js';
export type {
  CoreRememberParams,
  CoreRecallParams,
  CoreRecallItem,
  CoreRecallResult,
  CoreRememberResult,
} from './types.js';
