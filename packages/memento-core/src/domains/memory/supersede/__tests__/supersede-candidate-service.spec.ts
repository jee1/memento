import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUPERSEDE_PROMPT_VERSION } from '../supersede-judge.js';
import { SupersedeCandidateService } from '../supersede-candidate-service.js';
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

  it('parse_failed 는 그 쌍만 건너뛰고 다음 쌍을 판정한다', async () => {
    seedThreePairs();
    const port = fakeChatPort((_request, index) => (index === 0 ? '판정 불가' : judgeReply('pending')));

    const result = await service(port).scan({ runId: 'run-1' });

    expect(port.calls).toHaveLength(3);
    expect(result).toMatchObject({ status: 'completed', judged: 2, failed: 1 });
    expect(candidates()).toHaveLength(2);
    expect(logicalRows().map((r) => [r.final_path, r.final_reason])).toEqual([
      ['deferred', 'parse_failed'],
      ['llm', null],
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

  it('LLM 이 설정되지 않으면 호출 없이 not_configured 로 끝나고 logical 행 하나를 남긴다', async () => {
    seedPair();

    const result = await service(null).scan({ runId: 'run-1' });

    expect(result).toMatchObject({ status: 'not_configured', judged: 0 });
    expect(candidates()).toHaveLength(0);
    expect(logicalRows()).toEqual([
      expect.objectContaining({ feature: 'supersede_judge', final_path: 'not_configured' }),
    ]);
  });
});
