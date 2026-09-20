import { ErrorCategory, type AppErrorContract } from '../types/error-types.js';

export const MEMORY_VERSION_CONFLICT = 'memory_version_conflict';

/** JSON-RPC application error code mapped to HTTP 409 for tool dispatch. */
export const MEMORY_VERSION_CONFLICT_JSON_RPC_CODE = -32009;

/** Stored NULL version is treated as 1 for compare-and-swap (Issue #1093 Phase 1). */
export function memoryItemEffectiveVersion(stored: number | null | undefined): number {
  return stored ?? 1;
}

export class MemoryVersionConflictError extends Error implements AppErrorContract {
  readonly code = MEMORY_VERSION_CONFLICT;
  readonly category = ErrorCategory.MEMORY;
  readonly statusCode = 409;

  constructor(
    readonly memoryId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `memory version conflict for ${memoryId}: expected ${expectedVersion}, actual ${actualVersion}`,
    );
    this.name = 'MemoryVersionConflictError';
  }

  static forMemory(
    memoryId: string,
    expectedVersion: number,
    actualVersion: number,
  ): MemoryVersionConflictError {
    return new MemoryVersionConflictError(memoryId, expectedVersion, actualVersion);
  }
}
