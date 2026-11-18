import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { usageDailyCountDdl } from '../../../infrastructure/database/sqlite/migration/migrations/069-usage-daily-count.js';
import {
  USAGE_REPORT_KEYS,
  buildIssueDraft,
  buildUsageReport,
  renderReportMarkdown,
  validateUsageReport,
  type UsageReportInput,
} from './usage-report.js';
import { countMemories, readUsageRows, reportSinceDay } from './usage-report-reader.js';

const registeredTools = new Set(['recall', 'remember', 'forget']);

const baseInput = (over: Partial<UsageReportInput> = {}): UsageReportInput => ({
  mementoVersion: '2.3.10',
  nodeVersion: '24.1.0',
  platform: 'linux',
  arch: 'x64',
  install: 'npm-global',
  embeddingProvider: 'minilm',
  memoryCount: 1234,
  nativeModule: 'ok',
  database: 'ok',
  schemaVersion: '69.0',
  usageRows: [
    { client_name: 'claude-code', client_version: '2.1.327', tool: 'recall', outcome: 'success', error_code: 0, count: 90 },
    { client_name: 'claude-code', client_version: '2.1.327', tool: 'recall', outcome: 'error', error_code: -32603, count: 4 },
    { client_name: 'opencode', client_version: '1.19.6', tool: 'remember', outcome: 'error', error_code: -32602, count: 2 },
  ],
  registeredTools,
  ...over,
});

describe('buildUsageReport (#1769)', () => {
  it('키가 타입의 키와 같고 검증을 통과한다', () => {
    const report = buildUsageReport(baseInput());
    expect(Object.keys(report).sort()).toEqual([...USAGE_REPORT_KEYS].sort());
    expect(validateUsageReport(report)).toEqual([]);
  });

  it('요청과 오류, 클라이언트별 합계, 오류가 난 도구를 모은다', () => {
    const report = buildUsageReport(baseInput());
    expect(report).toMatchObject({ requests: 96, errors: 6, memory_count: '1000-9999', embedding_provider: 'minilm', node_major: 24 });
    expect(report.clients).toEqual([
      { client_name: 'claude-code', client_version: '2.1.327', requests: 94, errors: 4 },
      { client_name: 'opencode', client_version: '1.19.6', requests: 2, errors: 2 },
    ]);
    expect(report.failing_tools).toEqual([
      { tool: 'recall', error_code: -32603, count: 4 },
      { tool: 'remember', error_code: -32602, count: 2 },
    ]);
  });

  it.each([
    [null, 'unknown'],
    [0, '0'],
    [1, '1-99'],
    [99, '1-99'],
    [100, '100-999'],
    [999, '100-999'],
    [1000, '1000-9999'],
    [9999, '1000-9999'],
    [10000, '10000+'],
    [-5, 'unknown'],
  ])('기억 수 %s 는 구간 %s 로 줄인다', (count, bucket) => {
    expect(buildUsageReport(baseInput({ memoryCount: count })).memory_count).toBe(bucket);
  });

  it('클라이언트와 오류가 나는 도구는 다섯 줄까지만 싣는다', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      client_name: 'claude-code',
      client_version: `1.0.${i}`,
      tool: i % 2 ? 'recall' : 'remember',
      outcome: 'error',
      error_code: i % 3 ? -32603 : -32602,
      count: i + 1,
    }));
    const report = buildUsageReport(baseInput({ usageRows: rows }));
    expect(report.clients).toHaveLength(5);
    expect(report.failing_tools.length).toBeLessThanOrEqual(5);
    expect(validateUsageReport(report)).toEqual([]);
  });

  it('새어 나가는 값: 경로, 토큰, 호스트 이름, 사용자 이름, 기억 내용, 검색어를 모든 칸에 넣어도 출력에 없다', () => {
    const poison = [
      '/home/jee1lee/secret-project/memory.db',
      'sk-live-abcdef0123456789',
      'my-laptop.local',
      'jee1lee-real-name',
      '오늘 회사 비밀번호는 hunter2 라고 말했다',
      'SELECT * FROM memory_item',
      'secretproject',
    ];
    const report = buildUsageReport(
      baseInput({
        mementoVersion: poison[0],
        nodeVersion: poison[1],
        platform: poison[2],
        arch: poison[3],
        install: poison[0],
        embeddingProvider: poison[1],
        nativeModule: poison[4],
        database: poison[5],
        schemaVersion: poison[0],
        usageRows: poison.map((p) => ({
          client_name: p,
          client_version: p,
          tool: p,
          outcome: 'error',
          error_code: p,
          count: 3,
        })),
      }),
    );
    const draft = buildIssueDraft(report);
    const everything = [JSON.stringify(report), renderReportMarkdown(report), draft.title, draft.body, draft.url ?? '', decodeURIComponent(draft.url ?? '')].join('\n');
    for (const p of poison) expect(everything).not.toContain(p);
    expect(validateUsageReport(report)).toEqual([]);
  });

  it('모양은 맞지만 등록되지 않은 도구 이름은 other 로 바뀐다', () => {
    const report = buildUsageReport(
      baseInput({ usageRows: [{ client_name: 'cursor', client_version: '1.0.0', tool: 'secretproject', outcome: 'error', error_code: -32603, count: 2 }] }),
    );
    expect(report.failing_tools).toEqual([{ tool: 'other', error_code: -32603, count: 2 }]);
  });

  it('알 수 없는 환경 값은 기본값으로 바뀐다', () => {
    const report = buildUsageReport(baseInput({ platform: 'freebsd', arch: 'riscv64', install: 'snap', embeddingProvider: 'my-private-model' }));
    expect(report).toMatchObject({ os: 'other', cpu: 'other', install: 'unknown', embedding_provider: 'other' });
  });
});

describe('validateUsageReport', () => {
  it('타입에 없는 키가 있으면 위반이다', () => {
    const report = { ...buildUsageReport(baseInput()), hostname: 'my-laptop' };
    expect(validateUsageReport(report).join('\n')).toContain('키가 타입과 다르다');
  });

  it('값이 정해진 모양에 맞지 않으면 위반이다', () => {
    const report = { ...buildUsageReport(baseInput()), memento_version: '/home/jee1lee/x', os: 'my-laptop' };
    const problems = validateUsageReport(report).join('\n');
    expect(problems).toContain('memento_version');
    expect(problems).toContain('os');
  });

  it('목록 안의 행에 자유 문자열이 들어 있으면 위반이다', () => {
    const base = buildUsageReport(baseInput());
    const report = { ...base, clients: [{ client_name: 'my-laptop', client_version: '', requests: 1, errors: 0 }] };
    expect(validateUsageReport(report).join('\n')).toContain('clients');
    expect(validateUsageReport({ ...base, failing_tools: [{ tool: '/etc/passwd', error_code: -1, count: 1 }] }).join('\n')).toContain('failing_tools');
  });

  it('객체가 아니면 위반이다', () => {
    expect(validateUsageReport(null)).not.toEqual([]);
    expect(validateUsageReport([])).not.toEqual([]);
  });
});

describe('buildIssueDraft', () => {
  it('한도 안이면 링크를 만들고 링크를 풀면 본문과 같다', () => {
    const draft = buildIssueDraft(buildUsageReport(baseInput()));
    expect(draft.url).not.toBeNull();
    const url = new URL(draft.url as string);
    expect(url.origin + url.pathname).toBe('https://github.com/jee1/memento/issues/new');
    expect(url.searchParams.get('body')).toBe(draft.body);
    expect(url.searchParams.get('title')).toBe(draft.title);
    expect(Buffer.byteLength(draft.body, 'utf8')).toBeLessThanOrEqual(2048);
  });

  it('가장 큰 보고서(다섯 줄씩)도 2KB 안이다', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      client_name: ['claude-code', 'cursor', 'opencode'][i % 3],
      client_version: `${i}.${i}.${i}`,
      tool: ['recall', 'remember', 'forget'][i % 3],
      outcome: 'error',
      error_code: [-32602, -32603, -32003, -32009, -32601, -1][i % 6],
      count: 123456789 + i,
    }));
    const draft = buildIssueDraft(buildUsageReport(baseInput({ usageRows: rows, memoryCount: 99999 })));
    expect(Buffer.byteLength(draft.body, 'utf8')).toBeLessThanOrEqual(2048);
    expect(draft.url).not.toBeNull();
  });

  it('한도를 넘으면 링크 없이 본문만 돌려준다', () => {
    const draft = buildIssueDraft(buildUsageReport(baseInput()), { maxLinkBodyBytes: 100 });
    expect(draft.url).toBeNull();
    expect(draft.body).toContain('## 환경');
  });
});

describe('usage-report-reader', () => {
  const now = new Date('2026-11-19T10:00:00.000Z');

  it('창은 오늘을 포함해 7일이다', () => {
    expect(reportSinceDay(now)).toBe('2026-11-13');
  });

  it('창 안의 행만 같은 열쇠로 합쳐 읽는다', () => {
    const db = new Database(':memory:');
    db.exec(usageDailyCountDdl());
    const insert = db.prepare(
      `INSERT INTO usage_daily_count (day, client_name, client_version, connection_method, era, request_kind, tool, outcome, error_code, count)
       VALUES (?, 'claude-code', '2.1.327', ?, 'modern', 'tools/call', 'recall', 'success', 0, ?)`,
    );
    insert.run('2026-11-12', 'stdio', 100);
    insert.run('2026-11-13', 'stdio', 1);
    insert.run('2026-11-13', 'http-streamable', 2);
    insert.run('2026-11-19', 'stdio', 4);
    const rows = readUsageRows(db, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_name: 'claude-code', tool: 'recall', count: 7 });
    db.close();
  });

  it('표가 없으면 빈 값과 null 이다', () => {
    const db = new Database(':memory:');
    expect(readUsageRows(db, now)).toEqual([]);
    expect(countMemories(db)).toBeNull();
    db.close();
  });
});
