import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUPERSEDE_PROMPT_VERSION } from '../supersede-judge.js';
import { dismissSupersedeCandidate } from '../supersede-apply-service.js';
import { SupersedeCandidateService } from '../supersede-candidate-service.js';
import { resolveSupersedeMaxPairs } from '../../../../shared/config/index.js';
import { embeddingColumnToNumbers } from '../../../../shared/utils/embedding-serialization.js';
import { cosineSimilarity } from '../../../../shared/utils/vector-math.js';
import {
  closeSupersedeTestDb,
  createSupersedeTestDb,
  fakeChatPort,
  insertSeedMemory,
  isoDaysAgo,
  judgeReply,
  type FakeChatPort,
} from './supersede-test-support.js';

const OLD_AT = isoDaysAgo(10);
const NEW_AT = isoDaysAgo(1);
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

interface CandidateRow {
  id: string;
  old_memory_id: string;
  new_memory_id: string;
  verdict: string;
  rationale: string;
  evidence_quote: string | null;
  old_content_sha256: string;
  new_content_sha256: string;
  provider: string;
  model: string;
  prompt_version: string;
  input_hash: string;
  llm_logical_request_id: string | null;
}

describe('SupersedeCandidateService (#1548)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createSupersedeTestDb();
  });

  afterEach(() => closeSupersedeTestDb(db));

  const candidates = () =>
    db.prepare('SELECT * FROM memory_supersede_candidate ORDER BY old_memory_id, new_memory_id').all() as CandidateRow[];
  const logicalRows = () =>
    db.prepare('SELECT feature, final_path, final_reason, logical_request_id, run_id FROM llm_usage_logical ORDER BY rowid').all() as Array<{
      feature: string;
      final_path: string;
      final_reason: string | null;
      logical_request_id: string;
      run_id: string | null;
    }>;
  const service = (port: FakeChatPort | null) =>
    new SupersedeCandidateService({ db, port, model: 'test-model' });
  const seedPair = () => {
    insertSeedMemory(db, { id: 'old', content: '회의실은 3층이다.', createdAt: OLD_AT });
    insertSeedMemory(db, { id: 'new', content: '회의실을 4층으로 옮겼다.', createdAt: NEW_AT, vec: [0.9, 0.1, 0] });
  };
  const seedThreePairs = () => {
    insertSeedMemory(db, { id: 'o1', content: 'o1 본문', createdAt: OLD_AT });
    insertSeedMemory(db, { id: 'n1', content: 'n1 본문', createdAt: isoDaysAgo(2), vec: [0.95, 0.05, 0] });
    insertSeedMemory(db, { id: 'n2', content: 'n2 본문', createdAt: isoDaysAgo(1), vec: [0.9, 0.1, 0] });
  };

  it('confirmed 판정이어도 memory_item, memory_relation, memory_link 를 바꾸지 않는다', async () => {
    seedPair();
    const snapshot = () => ({
      items: db.prepare('SELECT * FROM memory_item ORDER BY id').all(),
      relations: db.prepare('SELECT * FROM memory_relation ORDER BY id').all(),
      links: db.prepare('SELECT * FROM memory_link ORDER BY id').all(),
    });
    const before = snapshot();

    const result = await service(fakeChatPort(() => judgeReply('confirmed', '층이 바뀌었다'))).scan({ runId: 'run-1' });

    expect(result.byVerdict.confirmed).toBe(1);
    expect(candidates()).toHaveLength(1);
    expect(snapshot()).toEqual(before);
  });

  it('후보 행에 입력 해시, 본문 sha256, 모델, 프롬프트 버전, 근거, logical 요청 id 를 남긴다', async () => {
    seedPair();
    await service(fakeChatPort(() => judgeReply('confirmed', '층이 바뀌었다', '4층으로 옮겼다'))).scan({ runId: 'run-1' });

    const [row] = candidates();
    expect(row).toMatchObject({
      old_memory_id: 'old',
      new_memory_id: 'new',
      verdict: 'confirmed',
      rationale: '층이 바뀌었다',
      evidence_quote: '4층으로 옮겼다',
      old_content_sha256: sha256('회의실은 3층이다.'),
      new_content_sha256: sha256('회의실을 4층으로 옮겼다.'),
      provider: 'gemini',
      model: 'test-model',
      prompt_version: SUPERSEDE_PROMPT_VERSION,
    });
    expect(row!.input_hash).toMatch(/^[0-9a-f]{64}$/);
    const [logical] = logicalRows();
    expect(logical).toMatchObject({ feature: 'supersede_judge', final_path: 'llm', run_id: 'run-1' });
    expect(row!.llm_logical_request_id).toBe(logical!.logical_request_id);
  });

  it('evidence_quote 가 새 기억 본문의 부분 문자열이 아니면 NULL 로 저장한다', async () => {
    seedPair();
    await service(fakeChatPort(() => judgeReply('confirmed', '근거', '5층으로 옮겼다'))).scan({ runId: 'run-1' });
    expect(candidates()[0]!.evidence_quote).toBeNull();
  });

  it('같은 내용을 다시 scan 하면 judge 를 부르지 않고, 새 기억 본문이 바뀌면 다시 판정한다', async () => {
    seedPair();
    const port = fakeChatPort(() => judgeReply('pending'));
    const svc = service(port);

    await svc.scan({ runId: 'run-1' });
    const second = await svc.scan({ runId: 'run-2' });

    expect(port.calls).toHaveLength(1);
    expect(second).toMatchObject({ judged: 0, skippedDuplicate: 1 });
    expect(candidates()).toHaveLength(1);

    db.prepare(`UPDATE memory_item SET content = ? WHERE id = 'new'`).run('회의실을 5층으로 옮겼다.');
    await svc.scan({ runId: 'run-3' });

    expect(port.calls).toHaveLength(2);
    expect(candidates()).toHaveLength(2);
  });

  it('제공자를 바꿔도 본문이 같은 쌍은 다시 판정하지 않는다 (#1840)', async () => {
    seedPair();
    await service(fakeChatPort(() => judgeReply('compatible'))).scan({ runId: 'run-1' });

    const claude = { ...fakeChatPort(() => judgeReply('confirmed')), provider: 'anthropic' as const };
    const second = await new SupersedeCandidateService({ db, port: claude, model: 'claude-haiku-5-5' }).scan({
      runId: 'run-2',
    });

    expect(second).toMatchObject({ judged: 0, skippedDuplicate: 1 });
    expect(claude.calls).toHaveLength(0);
    expect(candidates()).toHaveLength(1);
  });

  it('새 기억의 범위가 바뀌면 본문이 같아도 다시 판정한다 (#1840)', async () => {
    seedPair();
    const port = fakeChatPort(() => judgeReply('compatible'));
    await service(port).scan({ runId: 'run-1' });

    db.prepare(`UPDATE memory_item SET project_id = 'other-project' WHERE id IN ('old', 'new')`).run();
    const second = await service(port).scan({ runId: 'run-2' });

    expect(second).toMatchObject({ judged: 1 });
    expect(port.calls).toHaveLength(2);
  });

  it('maxPairs 를 주지 않으면 한 번에 20쌍까지 판정한다 (#1840)', async () => {
    const at = isoDaysAgo(1);
    for (let i = 0; i < 22; i += 1) {
      insertSeedMemory(db, { id: `old-${i}`, content: `옛 기억 ${i}`, createdAt: OLD_AT });
      insertSeedMemory(db, { id: `new-${i}`, content: `새 기억 ${i}`, createdAt: at });
    }
    const port = fakeChatPort(() => judgeReply('compatible'));

    const summary = await service(port).scan({ runId: 'run-1' });

    expect(summary.pairsConsidered).toBeGreaterThan(20);
    expect(port.calls).toHaveLength(20);
  });

  it('거절한 (old,new) 쌍은 내용이 같으면 모델만 바뀌어도 다시 후보로 만들지 않고 skippedDismissed 로 센다', async () => {
    seedPair();
    const portA = fakeChatPort(() => judgeReply('confirmed', '층이 바뀌었다'));
    await new SupersedeCandidateService({ db, port: portA, model: 'model-a' }).scan({ runId: 'run-1' });
    const [row] = candidates();
    dismissSupersedeCandidate(db, { candidateId: row!.id, actor: 'op', reason: '아님' });

    const portB = fakeChatPort(() => judgeReply('confirmed', '층이 바뀌었다'));
    const second = await new SupersedeCandidateService({ db, port: portB, model: 'model-b' }).scan({
      runId: 'run-2',
    });

    expect(second).toMatchObject({ judged: 0, skippedDismissed: 1, skippedDuplicate: 0 });
    expect(candidates()).toHaveLength(1);
    expect(portB.calls).toHaveLength(0);
  });

  it('거절 뒤 old 또는 new 내용이 바뀌면 다시 판정하고, 내용이 같으면 건너뛴다 (#1665)', async () => {
    seedPair();
    const port = fakeChatPort(() => judgeReply('confirmed', '층이 바뀌었다'));
    const svc = service(port);
    await svc.scan({ runId: 'run-1' });
    dismissSupersedeCandidate(db, { candidateId: candidates()[0]!.id, actor: 'op', reason: '아님' });

    const sameContent = await svc.scan({ runId: 'run-2' });
    expect(sameContent).toMatchObject({ judged: 0, skippedDismissed: 1, skippedDuplicate: 0 });
    expect(port.calls).toHaveLength(1);

    db.prepare(`UPDATE memory_item SET content = ? WHERE id = 'old'`).run('회의실은 2층이다.');
    const afterOldChange = await svc.scan({ runId: 'run-3' });
    expect(afterOldChange).toMatchObject({ judged: 1, skippedDismissed: 0 });
    expect(port.calls).toHaveLength(2);
    expect(candidates()).toHaveLength(2);

    const openId = (
      db.prepare('SELECT id FROM memory_supersede_candidate WHERE dismissed_at IS NULL').get() as { id: string }
    ).id;
    dismissSupersedeCandidate(db, { candidateId: openId, actor: 'op', reason: '또 아님' });
    db.prepare(`UPDATE memory_item SET content = ? WHERE id = 'new'`).run('회의실을 5층으로 옮겼다.');
    const afterNewChange = await svc.scan({ runId: 'run-4' });
    expect(afterNewChange).toMatchObject({ judged: 1, skippedDismissed: 0 });
    expect(port.calls).toHaveLength(3);
    expect(candidates()).toHaveLength(3);
  });

  it('owner, project, privacy_scope, type, 임베딩 모델이 다르거나 cosine 이 0.65 미만이면 쌍으로 만들지 않는다', async () => {
    insertSeedMemory(db, { id: 'new', content: 'NEW', createdAt: NEW_AT, ownerId: 'o1', projectId: 'p1', vec: [1, 0, 0] });
    const same = { ownerId: 'o1', projectId: 'p1', createdAt: OLD_AT };
    insertSeedMemory(db, { id: 'ok', content: 'ok', ...same });
    insertSeedMemory(db, { id: 'near-edge', content: 'edge', ...same, vec: [0.7, 0.7141428, 0] });
    insertSeedMemory(db, { id: 'below', content: 'below', ...same, vec: [0.6, 0.8, 0] });
    insertSeedMemory(db, { id: 'orthogonal', content: 'orth', ...same, vec: [0, 1, 0] });
    insertSeedMemory(db, { id: 'other-owner', content: 'x', ...same, ownerId: 'o2' });
    insertSeedMemory(db, { id: 'null-owner', content: 'x', ...same, ownerId: null });
    insertSeedMemory(db, { id: 'other-project', content: 'x', ...same, projectId: 'p2' });
    insertSeedMemory(db, { id: 'other-scope', content: 'x', ...same, privacyScope: 'team' });
    insertSeedMemory(db, { id: 'other-type', content: 'x', ...same, type: 'episodic' });
    insertSeedMemory(db, { id: 'other-model', content: 'x', ...same, model: 'm2' });
    const port = fakeChatPort(() => judgeReply('compatible'));

    const result = await service(port).scan({ runId: 'run-1' });

    expect(candidates().map((c) => c.old_memory_id)).toEqual(['near-edge', 'ok']);
    expect(port.calls).toHaveLength(2);
    expect(result.pairsConsidered).toBe(2);
  });

  describe('출처 (#1622)', () => {
    const USER = { tool: 'remember', caller: 'user' };
    const CONSOLIDATION = { tool: 'sleep-consolidation', caller: 'system' };
    const LEGACY_CONSOLIDATION = { tool: 'sleep-consolidation', context: { merge_resummarize: true } };
    const directive = '(2026-10-18) 모든 개발 건은 poteto-mode 로 진행한다. 착수 전 ~/.claude/skills/poteto-mode/SKILL.md 를 끝까지 읽는다.';
    const summary =
      'poteto 개발은 playbooks/ 의 플레이북 단계를 따른다. 2026-10-24 기준 Codex 환경에 ~/.codex/skills/poteto-mode 가 설치되었다.';

    const pairedOldIds = async () => {
      const port = fakeChatPort(() => judgeReply('confirmed', '경로가 바뀌었다'));
      const result = await service(port).scan({ runId: 'run-1' });
      return { oldIds: candidates().map((c) => c.old_memory_id), calls: port.calls.length, result };
    };

    it.each([
      ['caller=system', CONSOLIDATION],
      ['caller 없는 merge_resummarize', LEGACY_CONSOLIDATION],
    ])('consolidation 요약(%s)은 사용자가 남긴 지침과 짝짓지 않는다', async (_name, originSource) => {
      insertSeedMemory(db, { id: 'directive', content: directive, createdAt: OLD_AT, originSource: USER });
      insertSeedMemory(db, { id: 'summary', content: summary, createdAt: NEW_AT, vec: [0.9, 0.1, 0], originSource });

      const { oldIds, calls, result } = await pairedOldIds();

      expect(oldIds).toEqual([]);
      expect(calls).toBe(0);
      expect(result.pairsConsidered).toBe(0);
    });

    it('사용자 기억이 요약을, 요약이 요약이나 출처 미상 기억을 대체하는 쌍은 판정한다', async () => {
      insertSeedMemory(db, { id: 'old-summary', content: summary, createdAt: isoDaysAgo(12), originSource: CONSOLIDATION });
      insertSeedMemory(db, { id: 'old-unknown', content: '출처 없는 옛 기억', createdAt: isoDaysAgo(11) });
      insertSeedMemory(db, { id: 'new-user', content: directive, createdAt: isoDaysAgo(2), vec: [0.9, 0.1, 0], originSource: USER });
      insertSeedMemory(db, { id: 'new-summary', content: `${summary} 갱신`, createdAt: NEW_AT, vec: [0.95, 0.05, 0], originSource: CONSOLIDATION });

      await service(fakeChatPort(() => judgeReply('compatible'))).scan({ runId: 'run-1' });

      expect(candidates().map((c) => [c.old_memory_id, c.new_memory_id])).toEqual([
        ['old-summary', 'new-summary'],
        ['old-summary', 'new-user'],
        ['old-unknown', 'new-summary'],
        ['old-unknown', 'new-user'],
      ]);
    });
  });

  it('임베딩이 없는 기억은 쌍에서 빼고 개수를 보고한다', async () => {
    insertSeedMemory(db, { id: 'old', content: 'old', createdAt: OLD_AT, vec: null });
    insertSeedMemory(db, { id: 'new', content: 'new', createdAt: NEW_AT });
    const port = fakeChatPort(() => judgeReply('compatible'));

    const result = await service(port).scan({ runId: 'run-1' });

    expect(port.calls).toHaveLength(0);
    expect(result).toMatchObject({ status: 'completed', pairsConsidered: 0, skippedNoEmbedding: 1 });
  });

  it('429 를 받으면 그 run 을 즉시 멈추고 deferred 로 기록하며, 다음 run 이 남은 쌍을 판정한다', async () => {
    seedThreePairs();
    const limited = fakeChatPort(() => new Error('429 rate limit exceeded'));

    const first = await service(limited).scan({ runId: 'run-1' });

    expect(limited.calls).toHaveLength(1);
    expect(candidates()).toHaveLength(0);
    expect(first).toMatchObject({ status: 'deferred', judged: 0 });
    expect(logicalRows()).toEqual([
      expect.objectContaining({ feature: 'supersede_judge', final_path: 'deferred', final_reason: 'rate_limited' }),
    ]);

    const healthy = fakeChatPort(() => judgeReply('compatible'));
    const second = await service(healthy).scan({ runId: 'run-2' });

    expect(healthy.calls).toHaveLength(3);
    expect(second).toMatchObject({ status: 'completed', judged: 3 });
    expect(candidates()).toHaveLength(3);
  });

  it('parse_failed 와 llm_failed 는 그 쌍만 건너뛰고 429 defer 와 다른 failed 로 기록한다', async () => {
    seedThreePairs();
    const port = fakeChatPort((_request, index) =>
      index === 0 ? '판정 불가' : index === 1 ? new Error('500 server error') : judgeReply('pending'),
    );

    const result = await service(port).scan({ runId: 'run-1' });

    expect(port.calls).toHaveLength(3);
    expect(result).toMatchObject({ status: 'completed', judged: 1, failed: 2 });
    expect(candidates()).toHaveLength(1);
    expect(logicalRows().map((r) => [r.final_path, r.final_reason])).toEqual([
      ['failed', 'parse_failed'],
      ['failed', 'llm_failed'],
      ['llm', null],
    ]);
  });

  it('maxPairs 는 run 하나의 판정 시도 수이고 중복 건너뜀은 세지 않는다', async () => {
    seedThreePairs();
    const port = fakeChatPort(() => judgeReply('compatible'));
    const svc = service(port);

    const first = await svc.scan({ runId: 'run-1', maxPairs: 2 });
    const second = await svc.scan({ runId: 'run-2', maxPairs: 2 });

    expect(first).toMatchObject({ judged: 2, pairsConsidered: 3 });
    expect(second).toMatchObject({ judged: 1, skippedDuplicate: 2 });
    expect(port.calls).toHaveLength(3);
  });

  it('판정 중 기억 행이 영구 삭제되면 그 쌍은 건너뛰고, 소프트 삭제는 그대로 판정한다 (#1789)', async () => {
    const seed = () => {
      insertSeedMemory(db, { id: 'oldA', content: 'oldA 본문', createdAt: OLD_AT });
      insertSeedMemory(db, { id: 'oldB', content: 'oldB 본문', createdAt: OLD_AT });
      insertSeedMemory(db, { id: 'newN', content: 'newN 본문', createdAt: NEW_AT, vec: [0.9, 0.1, 0] });
    };
    const scanRemovingOldBAfterFirstJudge = async (remove: () => void) => {
      const port = fakeChatPort((_request, index) => {
        if (index === 0) {
          remove();
        }
        return judgeReply('compatible');
      });
      const summary = await service(port).scan({ runId: 'run-del' });
      return { summary, calls: port.calls.length };
    };

    seed();
    const hard = await scanRemovingOldBAfterFirstJudge(() => {
      db.prepare('DELETE FROM memory_item WHERE id = ?').run('oldB');
    });
    expect(hard.summary).toMatchObject({ judged: 1, pairsConsidered: 2, failed: 0 });
    expect(hard.calls).toBe(1);

    db.prepare('DELETE FROM memory_supersede_candidate').run();
    db.prepare('DELETE FROM memory_item').run();
    seed();
    const soft = await scanRemovingOldBAfterFirstJudge(() => {
      db.prepare('UPDATE memory_item SET is_deleted = 1 WHERE id = ?').run('oldB');
    });
    expect(soft.summary).toMatchObject({ judged: 2, pairsConsidered: 2 });
    expect(soft.calls).toBe(2);
  });

  it('LLM 이 설정되지 않으면 호출 없이 not_configured 로 끝나고 logical 행 하나를 남긴다', async () => {
    seedPair();

    const result = await service(null).scan({ runId: 'run-1' });

    expect(result).toMatchObject({ status: 'not_configured', judged: 0 });
    expect(candidates()).toHaveLength(0);
    expect(logicalRows()).toEqual([
      expect.objectContaining({ feature: 'supersede_judge', final_path: 'not_configured' }),
    ]);
  });

  /** 전체를 올려 전수 비교하는 옛 방식. 나눠 읽는 방식과 같은 쌍을 같은 순서로 내는지 대조하는 기준이다 (#1789). */
  function referencePairs(lookbackDays: number): Array<[string, string]> {
    const rows = db
      .prepare(
        `SELECT mi.id, mi.type, mi.owner_id AS ownerId, mi.project_id AS projectId, mi.privacy_scope AS scope,
                julianday(mi.created_at) AS jd, julianday(mi.created_at) >= julianday('now') - ? AS recent,
                mi.origin_source AS origin, me.embedding AS embedding, me.model AS model
         FROM memory_item mi JOIN memory_embedding me ON me.memory_id = mi.id AND me.projection_type = 'native'`,
      )
      .all(lookbackDays) as Array<Record<string, any>>;
    const key = (r: Record<string, any>) => JSON.stringify([r.ownerId, r.projectId, r.scope, r.type, r.model]);
    const origin = (r: Record<string, any>) => {
      const o = JSON.parse(r.origin) as { tool?: string; caller?: string };
      return o.tool === 'sleep-consolidation' ? 'consolidation' : o.caller === 'user' ? 'user' : 'unknown';
    };
    const pairs: Array<[string, string]> = [];
    for (const next of rows.filter((r) => r.recent === 1).sort((a, b) => b.jd - a.jd)) {
      rows
        .filter((o) => key(o) === key(next) && o.jd < next.jd && !(origin(next) === 'consolidation' && origin(o) === 'user'))
        .map((o) => ({ o, sim: cosineSimilarity(embeddingColumnToNumbers(next.embedding)!, embeddingColumnToNumbers(o.embedding)!) }))
        .filter(({ sim }) => sim >= 0.65)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3)
        .forEach(({ o }) => pairs.push([o.id, next.id]));
    }
    return pairs;
  }

  it('나눠 읽어도 전체를 올려 전수 비교한 것과 같은 쌍을 같은 순서로 판정한다 (#1789)', async () => {
    let seed = 1789;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const centers = [[1, 0, 0, 0], [0.8, 0.6, 0, 0], [0, 0, 1, 0]];
    for (let i = 0; i < 80; i += 1) {
      const c = centers[i % centers.length]!;
      const vec = i % 7 === 0 ? c : c.map((x) => x + (rand() - 0.5) * 0.4);
      insertSeedMemory(db, {
        id: `m${String(i).padStart(2, '0')}`,
        content: `본문 ${i}`,
        createdAt: isoDaysAgo(i < 20 ? 0.5 + rand() * 5 : 8 + rand() * 40),
        type: i % 5 === 0 ? 'episodic' : 'semantic',
        ownerId: i % 4 === 0 ? 'owner-b' : 'owner-a',
        vec: i % 11 === 0 ? null : vec,
        originSource: i % 3 === 0 ? { tool: 'sleep-consolidation' } : i % 3 === 1 ? { caller: 'user' } : {},
      });
    }
    const expected = referencePairs(7);
    expect(expected.length).toBeGreaterThan(10);

    const summary = await service(fakeChatPort(() => judgeReply('compatible'))).scan({ runId: 'run-eq', maxPairs: 1000 });

    expect(summary.pairsConsidered).toBe(expected.length);
    const judged = db
      .prepare('SELECT old_memory_id, new_memory_id FROM memory_supersede_candidate ORDER BY rowid')
      .all() as Array<{ old_memory_id: string; new_memory_id: string }>;
    expect(judged.map((r) => [r.old_memory_id, r.new_memory_id])).toEqual(expected);
    expect(summary.skippedNoEmbedding).toBe(8);
  });
});

describe('resolveSupersedeMaxPairs (#1840)', () => {
  const saved = process.env.SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS;
  afterEach(() => {
    if (saved === undefined) delete process.env.SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS;
    else process.env.SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS = saved;
  });

  it('비었거나 1~200 밖이면 20, 안이면 그 값', () => {
    const read = (value: string | undefined) => {
      if (value === undefined) delete process.env.SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS;
      else process.env.SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS = value;
      return resolveSupersedeMaxPairs();
    };
    expect([undefined, '', '0', '201', 'x', '7', '200'].map(read)).toEqual([20, 20, 20, 20, 20, 7, 200]);
  });
});
