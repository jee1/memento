/**
 * RelationGraphCycleDetector 로그 볼륨 회귀 테스트 (#913)
 *
 * 깊이 한계에 걸린 노드는 visited 에 넣을 수 없어 들어오는 간선 수만큼 재진입한다.
 * 예전 구현은 그 지점마다 logger.warn 을 호출해서, remember 1건이 로그를 1.8만 줄까지 만들었다.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../../../shared/constants/relation-constants.js';
import { logger } from '../../../../shared/utils/logger.js';
import { RelationGraphCycleDetector } from '../relation-graph-cycle-detector.js';

/** 깊이 한계에 재진입할 프론티어 노드의 부모 수. 예전 구현이라면 이 수만큼 로그가 찍힌다. */
const FRONTIER_PARENTS = 50;

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_relation (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL
    );
  `);
}

function addRelation(db: Database.Database, sourceId: string, targetId: string): void {
  db.prepare(
    `INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES (?, ?, 'CAUSES')`
  ).run(sourceId, targetId);
}

/**
 * chain_0 -> ... -> chain_9 -> parent_i (깊이 10) -> frontier (깊이 11)
 * frontier 는 maxDepth 10 을 넘으므로 부모 수만큼 재진입한다.
 */
function createDepthLimitGraph(db: Database.Database): void {
  for (let i = 0; i < LIMITS.MAX_CYCLE_DEPTH - 1; i++) {
    addRelation(db, `chain_${i}`, `chain_${i + 1}`);
  }
  for (let i = 0; i < FRONTIER_PARENTS; i++) {
    addRelation(db, `chain_${LIMITS.MAX_CYCLE_DEPTH - 1}`, `parent_${i}`);
    addRelation(db, `parent_${i}`, 'frontier');
  }
}

describe('RelationGraphCycleDetector', () => {
  let db: Database.Database;
  let detector: RelationGraphCycleDetector;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
    detector = new RelationGraphCycleDetector(db);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    db.close();
  });

  it('깊이 한계에 여러 번 걸려도 경고는 호출당 한 줄만 남긴다', async () => {
    createDepthLimitGraph(db);

    const isCyclic = await detector.detectCycleInternal('unreachable', 'chain_0', 'CAUSES');

    expect(isCyclic).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const [, meta] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta.depthLimitHits).toBe(FRONTIER_PARENTS);
    expect(meta.cycleFound).toBe(false);
  });

  it('깊이 한계에 걸리지 않으면 경고를 남기지 않는다', async () => {
    addRelation(db, 'a', 'b');

    await detector.detectCycleInternal('b', 'a', 'CAUSES');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('깊이 안에 있는 순환은 그대로 감지한다', async () => {
    addRelation(db, 'a', 'b');
    addRelation(db, 'b', 'c');

    await expect(detector.detectCycleInternal('c', 'a', 'CAUSES')).resolves.toBe(true);
  });
});
