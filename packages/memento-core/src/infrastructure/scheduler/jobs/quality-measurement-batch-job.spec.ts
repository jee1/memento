import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { QualityMeasurementBatchJob } from './quality-measurement-batch-job.js';
import type { QualityAssuranceService } from '../../../domains/monitoring/services/quality-assurance/quality-assurance-service.js';
import { DAY_MS } from '../../../shared/utils/date.js';

/**
 * #908: quality_measurement_history 보존 정리.
 * 측정 자체는 이 테스트의 대상이 아니므로 QualityAssuranceService 는 빈 결과를 돌려주는
 * 스텁으로 주입하고, 리포트 생성은 끈다.
 */
describe('QualityMeasurementBatchJob — quality_measurement_history 보존 정리', () => {
  let db: Database.Database;

  const stubService = {
    measureQuality: async () => ({ namespaces: [], evaluation_results: [] }),
  } as unknown as QualityAssuranceService;

  const makeJob = () =>
    new QualityMeasurementBatchJob(
      { record: false, generateReport: false },
      { qualityService: stubService },
    );

  const insertAt = (id: string, measuredAt: string) => {
    db.prepare(
      `INSERT INTO quality_measurement_history (id, measurement_type, measured_at, metrics, status)
       VALUES (?, 'batch', ?, '{}', 'success')`,
    ).run(id, measuredAt);
  };

  const remainingIds = () =>
    (db.prepare(`SELECT id FROM quality_measurement_history ORDER BY id`).all() as Array<{
      id: string;
    }>).map(r => r.id);

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE quality_measurement_history (
        id TEXT PRIMARY KEY,
        measurement_type TEXT NOT NULL,
        measured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metrics TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'success',
        warnings TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
  });

  it('기본 90일보다 오래된 행만 지운다', async () => {
    insertAt('old', new Date(Date.now() - 91 * DAY_MS).toISOString());
    insertAt('recent', new Date(Date.now() - 10 * DAY_MS).toISOString());

    const result = await makeJob().execute(db);

    expect(result.details.historyRowsPruned).toBe(1);
    expect(remainingIds()).toEqual(['recent']);
  });

  it('QUALITY_MEASUREMENT_HISTORY_RETENTION_DAYS 로 보존 창을 좁힐 수 있다', async () => {
    vi.stubEnv('QUALITY_MEASUREMENT_HISTORY_RETENTION_DAYS', '7');
    insertAt('day10', new Date(Date.now() - 10 * DAY_MS).toISOString());
    insertAt('day3', new Date(Date.now() - 3 * DAY_MS).toISOString());

    const result = await makeJob().execute(db);

    expect(result.details.historyRowsPruned).toBe(1);
    expect(remainingIds()).toEqual(['day3']);
  });

  it('경계 바로 바깥의 ISO 타임스탬프도 지운다 (문자열 비교였다면 살아남는다)', async () => {
    // 저장 형식은 `2026-09-19T12:25:52.925Z`, datetime('now', ...) 은
    // `2026-06-21 14:30:00` 을 돌려준다. 같은 날짜에서 'T'(0x54) 가 ' '(0x20) 보다
    // 크므로, 정규화 없이 문자열로 비교하면 이 행이 커트오프보다 "크다"고 판정돼
    // 남는다. 실측 프로덕션 DB 에서 이 차이가 240행이었다.
    insertAt('justOverCutoff', new Date(Date.now() - 90 * DAY_MS - 1000).toISOString());
    insertAt('justInside', new Date(Date.now() - 90 * DAY_MS + 60_000).toISOString());

    const result = await makeJob().execute(db);

    expect(result.details.historyRowsPruned).toBe(1);
    expect(remainingIds()).toEqual(['justInside']);
  });

  it('정리가 실패해도 작업은 실패하지 않고 경고만 남긴다', async () => {
    db.exec(`DROP TABLE quality_measurement_history`);

    const result = await makeJob().execute(db);

    expect(result.success).toBe(true);
    expect(result.details.historyRowsPruned).toBe(0);
    expect(result.warnings.some(w => w.includes('quality_measurement_history 정리 실패'))).toBe(
      true,
    );
  });
});
