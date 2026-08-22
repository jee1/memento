/**
 * vec0 distance metric 계약 (issue #713)
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  VEC_DISTANCE_METRIC,
  VEC_TABLES,
  buildVecTableDdl,
  buildVecTriggerSql,
  hasCosineDistanceMetric
} from './vec-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('VEC_TABLES', () => {
  it('계약은 cosine이다', () => {
    expect(VEC_DISTANCE_METRIC).toBe('cosine');
  });

  it('legacy 384 테이블과 제공자별 테이블을 모두 포함한다', () => {
    expect(VEC_TABLES.map(table => [table.name, table.dimension])).toEqual([
      ['memory_item_vec', 384],
      ['memory_item_vec_tfidf', 512],
      ['memory_item_vec_minilm', 384],
      ['memory_item_vec_openai', 1536],
      ['memory_item_vec_gemini', 768],
      ['memory_item_vec_mock', 64]
    ]);
  });

  it('legacy 384 테이블은 provider 전용이 아니므로 dimensions 조건만 사용한다', () => {
    const legacy = VEC_TABLES.find(table => table.name === 'memory_item_vec');
    expect(legacy?.filter).toBe('dimensions = 384');
  });

  it('제공자별 테이블은 provider + dimensions + native projection으로 필터한다', () => {
    for (const table of VEC_TABLES.filter(t => t.name !== 'memory_item_vec')) {
      expect(table.filter).toContain('embedding_provider =');
      expect(table.filter).toContain(`dimensions = ${table.dimension}`);
      expect(table.filter).toContain("projection_type = 'native'");
    }
  });
});

describe('buildVecTableDdl', () => {
  it('distance_metric=cosine을 명시한다', () => {
    const mock = VEC_TABLES.find(table => table.name === 'memory_item_vec_mock')!;
    expect(buildVecTableDdl(mock)).toBe(
      'CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_mock ' +
        'USING vec0(embedding float[64] distance_metric=cosine)'
    );
  });

  it('허용 목록에 없는 테이블명은 거부한다', () => {
    expect(() =>
      buildVecTableDdl({
        name: 'memory_item_vec; DROP TABLE memory_item',
        dimension: 64,
        predicates: [],
        filter: ''
      })
    ).toThrow();
  });
});

describe('hasCosineDistanceMetric', () => {
  it('metric 미명시(L2 기본값) DDL은 false', () => {
    expect(
      hasCosineDistanceMetric('CREATE VIRTUAL TABLE memory_item_vec USING vec0(embedding float[384])')
    ).toBe(false);
  });

  it('공백이 달라도 cosine을 인식한다', () => {
    expect(
      hasCosineDistanceMetric(
        'CREATE VIRTUAL TABLE memory_item_vec USING vec0(embedding float[384]  distance_metric = cosine )'
      )
    ).toBe(true);
  });

  it('빈 값이면 false', () => {
    expect(hasCosineDistanceMetric(undefined)).toBe(false);
  });

  it('buildVecTableDdl이 만든 DDL을 항상 인식한다', () => {
    for (const table of VEC_TABLES) {
      expect(hasCosineDistanceMetric(buildVecTableDdl(table))).toBe(true);
    }
  });
});

describe('buildVecTriggerSql', () => {
  const triggers = buildVecTriggerSql(VEC_TABLES);

  it('insert 트리거가 mock을 포함한 모든 대상 테이블에 적재한다', () => {
    for (const table of VEC_TABLES) {
      expect(triggers.insert).toContain(`INSERT INTO ${table.name}(rowid, embedding)`);
    }
  });

  it('update 트리거는 모든 대상 테이블을 삭제 후 재적재한다', () => {
    for (const table of VEC_TABLES) {
      expect(triggers.update).toContain(`DELETE FROM ${table.name} WHERE rowid = NEW.id`);
      expect(triggers.update).toContain(`INSERT INTO ${table.name}(rowid, embedding)`);
    }
  });

  it('delete 트리거는 모든 대상 테이블에서 삭제한다', () => {
    for (const table of VEC_TABLES) {
      expect(triggers.delete).toContain(`DELETE FROM ${table.name} WHERE rowid = OLD.id`);
    }
  });

  it('존재하는 테이블만 전달하면 그 테이블만 참조한다', () => {
    const onlyMock = buildVecTriggerSql(VEC_TABLES.filter(t => t.name === 'memory_item_vec_mock'));
    expect(onlyMock.insert).toContain('memory_item_vec_mock');
    expect(onlyMock.insert).not.toContain('memory_item_vec_tfidf');
  });
});

describe('schema.sql (fresh DB 경로)', () => {
  const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

  it('모든 대상 vec 테이블을 distance_metric=cosine으로 생성한다', () => {
    for (const table of VEC_TABLES) {
      expect(schemaSql).toContain(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${table.name} ` +
          `USING vec0(embedding float[${table.dimension}] distance_metric=cosine)`
      );
    }
  });

  it('metric 미명시(L2 기본값) vec0 선언이 남아 있지 않다', () => {
    const withoutMetric = schemaSql.match(/USING vec0\((?![^)]*distance_metric)[^)]*\)/g);
    expect(withoutMetric).toBeNull();
  });
});
