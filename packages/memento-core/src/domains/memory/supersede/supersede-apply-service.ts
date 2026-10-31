/**
 * #1551: 승인된 대체 후보를 memory_item.superseded_by 포인터로 적용하고, 명시적으로 복원한다.
 *
 * 같은 범위의 원자적 직접 교체만 다룬다. 자동 적용 경로는 없다. 사람이 후보 하나를 승인할 때만 부른다.
 * 포인터 변경과 감사 사건은 한 트랜잭션에서 함께 커밋된다.
 */
import type Database from 'better-sqlite3';
import {
  compareAndClearSupersededBy,
  compareAndSetSupersededBy,
  findSupersedeApplyMemory,
  type SupersedeApplyMemoryRow,
} from '../repositories/memory-item-repository.js';
import { SupersedeCandidateRepository, type SupersedeCandidateRow } from './supersede-candidate-repository.js';
import { sha256Hex, type SupersedeVerdict } from './supersede-judge.js';

/** compatible 은 둘 다 참이라는 판정이라 대체로 적용하지 않는다. pending 은 승인이 곧 확인이다. */
const APPLICABLE_VERDICTS: ReadonlySet<SupersedeVerdict> = new Set(['confirmed', 'pending']);

export type SupersedeApplyRejection =
  | 'candidate_not_found'
  | 'verdict_not_applicable'
  | 'memory_not_found'
  | 'memory_deleted'
  | 'scope_mismatch'
  | 'input_changed'
  | 'cycle'
  | 'already_superseded'
  | 'dangling_pointer';

export type SupersedeApplyOutcome =
  | { kind: 'applied'; eventId: string }
  | { kind: 'already_applied' }
  | { kind: 'rejected'; reason: SupersedeApplyRejection };

export type SupersedeRestoreOutcome =
  | { kind: 'restored'; eventId: string }
  | { kind: 'rejected'; reason: 'memory_not_found' | 'not_superseded' | 'pointer_changed' };

function sameScope(candidate: SupersedeCandidateRow, memory: SupersedeApplyMemoryRow): boolean {
  return (
    memory.ownerId === candidate.ownerId &&
    memory.projectId === candidate.projectId &&
    memory.privacyScope === candidate.privacyScope &&
    memory.type === candidate.memoryType
  );
}

/** 새 기억에서 포인터를 따라가다 옛 기억에 닿으면 순환이다. 삭제된 target 의 포인터도 따라간다. */
function closesCycle(db: Database.Database, oldId: string, newId: string): boolean {
  const visited = new Set<string>();
  let cursor: string | null = newId;
  while (cursor !== null && !visited.has(cursor)) {
    if (cursor === oldId) {
      return true;
    }
    visited.add(cursor);
    cursor = findSupersedeApplyMemory(db, cursor)?.supersededBy ?? null;
  }
  return false;
}

function applyInTransaction(
  db: Database.Database,
  repository: SupersedeCandidateRepository,
  input: { candidateId: string; actor: string; reason?: string | null },
): SupersedeApplyOutcome {
  const reject = (reason: SupersedeApplyRejection): SupersedeApplyOutcome => ({ kind: 'rejected', reason });
  const candidate = repository.findCandidateById(input.candidateId);
  if (!candidate) {
    return reject('candidate_not_found');
  }
  if (!APPLICABLE_VERDICTS.has(candidate.verdict)) {
    return reject('verdict_not_applicable');
  }
  const old = findSupersedeApplyMemory(db, candidate.oldMemoryId);
  const next = findSupersedeApplyMemory(db, candidate.newMemoryId);
  if (!old || !next) {
    return reject('memory_not_found');
  }
  if (old.isDeleted || next.isDeleted) {
    return reject('memory_deleted');
  }
  if (old.supersededBy === next.id) {
    return { kind: 'already_applied' };
  }
  if (!sameScope(candidate, old) || !sameScope(candidate, next)) {
    return reject('scope_mismatch');
  }
  if (sha256Hex(old.content) !== candidate.oldContentSha256 || sha256Hex(next.content) !== candidate.newContentSha256) {
    return reject('input_changed');
  }
  if (closesCycle(db, old.id, next.id)) {
    return reject('cycle');
  }
  if (old.supersededBy !== null) {
    const target = findSupersedeApplyMemory(db, old.supersededBy);
    // target 이 지워져 남은 포인터다. restore 로 먼저 정리해야 새 승인을 건다.
    return reject(!target || target.isDeleted ? 'dangling_pointer' : 'already_superseded');
  }
  if (!compareAndSetSupersededBy(db, old.id, next.id)) {
    return reject('already_superseded');
  }
  const eventId = repository.insertEvent({
    action: 'applied',
    oldMemoryId: old.id,
    newMemoryId: next.id,
    candidateId: candidate.id,
    actor: input.actor,
    reason: input.reason ?? null,
    oldContentSha256: candidate.oldContentSha256,
    newContentSha256: candidate.newContentSha256,
  });
  return { kind: 'applied', eventId };
}

export function applySupersedeCandidate(
  db: Database.Database,
  input: { candidateId: string; actor: string; reason?: string | null },
): SupersedeApplyOutcome {
  const repository = new SupersedeCandidateRepository(db);
  return db.transaction(() => applyInTransaction(db, repository, input)).immediate();
}

/**
 * 포인터가 기대한 target 일 때만 지운다. target 이 이미 지워져 남은 포인터도 이 경로로 정리한다.
 */
export function restoreSupersededMemory(
  db: Database.Database,
  input: { oldMemoryId: string; expectedNewMemoryId: string; actor: string; reason?: string | null },
): SupersedeRestoreOutcome {
  const repository = new SupersedeCandidateRepository(db);
  return db
    .transaction((): SupersedeRestoreOutcome => {
      const old = findSupersedeApplyMemory(db, input.oldMemoryId);
      if (!old) {
        return { kind: 'rejected', reason: 'memory_not_found' };
      }
      if (old.supersededBy === null) {
        return { kind: 'rejected', reason: 'not_superseded' };
      }
      if (!compareAndClearSupersededBy(db, old.id, input.expectedNewMemoryId)) {
        return { kind: 'rejected', reason: 'pointer_changed' };
      }
      const next = findSupersedeApplyMemory(db, input.expectedNewMemoryId);
      const eventId = repository.insertEvent({
        action: 'restored',
        oldMemoryId: old.id,
        newMemoryId: input.expectedNewMemoryId,
        candidateId: null,
        actor: input.actor,
        reason: input.reason ?? null,
        oldContentSha256: sha256Hex(old.content),
        newContentSha256: next ? sha256Hex(next.content) : null,
      });
      return { kind: 'restored', eventId };
    })
    .immediate();
}
