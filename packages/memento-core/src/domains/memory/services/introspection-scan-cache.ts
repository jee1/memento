/**
 * Introspection Scan Cache (Issue #21 Phase B)
 *
 * meta_memory_introspection job 실행 결과를 보관하고,
 * recall / get_meta_memory_stats / get_introspection_summary에서 읽습니다.
 * 프로세스 내 메모리만 사용하며, 재시작 시 비어 있습니다.
 */

import type { MetaMemoryIntrospectionScanResult } from './meta-memory-introspection-service.js';

export interface CachedIntrospectionScan {
  result: MetaMemoryIntrospectionScanResult;
  scanned_at: string; // ISO 8601
}

export class IntrospectionScanCache {
  private cached: CachedIntrospectionScan | null = null;

  set(result: MetaMemoryIntrospectionScanResult, scanned_at: string): void {
    this.cached = { result, scanned_at };
  }

  get(): CachedIntrospectionScan | null {
    return this.cached;
  }

  clear(): void {
    this.cached = null;
  }
}
