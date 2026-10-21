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
  type VecTableConfig,
  buildVecTableDdl,
  buildVecTriggerSql,
  hasCosineDistanceMetric
} from './vec-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function providersInPredicates(predicates: readonly string[]): ReadonlySet<string> {
  const providers = new Set<string>();
  for (const predicate of predicates) {
    const equal = /^embedding_provider = '([^']+)'$/.exec(predicate);
    const equalProvider = equal?.[1];
    if (equalProvider) {
      providers.add(equalProvider);
      continue;
    }
    const list = /^embedding_provider IN \((.+)\)$/.exec(predicate);
    const listBody = list?.[1];
    if (!listBody) {
      continue;
    }
    for (const part of listBody.split(',')) {
      const provider = part.trim().replace(/^'|'$/g, '');
      if (provider) {
        providers.add(provider);
      }
    }
  }
  return providers;
}

function assertDisjointProviderSlots(tables: readonly VecTableConfig[]): void {
  const byDimension = new Map<number, { name: string; providers: ReadonlySet<string> }[]>();

  for (const table of tables) {
    const providers = providersInPredicates(table.predicates);
    if (providers.size === 0) {
      throw new Error(`${table.name} has no provider allowlist`);
    }

    const group = byDimension.get(table.dimension) ?? [];
    for (const other of group) {
      for (const provider of providers) {
        if (other.providers.has(provider)) {
          throw new Error(
            `${table.name} and ${other.name} both claim ${provider} at dimension ${table.dimension}`
          );
        }
      }
    }
    group.push({ name: table.name, providers });
    byDimension.set(table.dimension, group);
  }
}

describe('VEC_TABLES', () => {
  it('계약은 cosine이다', () => {
    expect(VEC_DISTANCE_METRIC).toBe('cosine');
  });

  it('제공자별 테이블과 차원을 포함한다', () => {
    expect(VEC_TABLES.map(table => [table.name, table.dimension])).toEqual([
      ['memory_item_vec_tfidf', 512],
      ['memory_item_vec_minilm', 384],
      ['memory_item_vec_openai', 1536],
      ['memory_item_vec_gemini', 768],
      ['memory_item_vec_mock', 64]
    ]);
  });

  it('legacy memory_item_vec 는 신규 스키마에 없다', () => {
    expect(VEC_TABLES.some(table => table.name === 'memory_item_vec')).toBe(false);
  });

  it('같은 차원의 provider 집합은 서로소다', () => {
    expect(() => assertDisjointProviderSlots(VEC_TABLES)).not.toThrow();
  });

  it('같은 384 슬롯에 minilm 을 두 번 넣으면 throw 한다', () => {
    const minilm = VEC_TABLES.find(table => table.name === 'memory_item_vec_minilm');
    expect(minilm).toBeDefined();
    const broken = [
      ...VEC_TABLES,
      { ...minilm!, name: 'memory_item_vec_minilm_dup' },
    ];
    expect(() => assertDisjointProviderSlots(broken)).toThrow(/minilm/);
  });

  it('제공자별 테이블은 provider + dimensions + native projection으로 필터한다', () => {
    const minilm = VEC_TABLES.find(table => table.name === 'memory_item_vec_minilm');
    expect(minilm?.filter).toContain('embedding_provider =');
    expect(minilm?.filter).toContain('dimensions = 384');
    expect(minilm?.filter).toContain('projection_type IN (');
    expect(minilm?.filter).toContain("'native'");
    expect(minilm?.filter).toContain("'window:0'");

    for (const table of VEC_TABLES.filter(t => t.name !== 'memory_item_vec_minilm')) {
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

  // #809 FR-016: BLOB direct pass — no json_extract on embedding
  it('insert/update SQL에 json_extract가 없고 NEW.embedding을 직접 전달한다', () => {
    expect(triggers.insert).not.toMatch(/json_extract/i);
    expect(triggers.update).not.toMatch(/json_extract/i);
    expect(triggers.insert).toContain('NEW.embedding');
    expect(triggers.update).toContain('NEW.embedding');
  });

  it('insert 트리거는 레거시 memory_item_vec 에 적재하지 않는다', () => {
    expect(triggers.insert).not.toContain('INSERT INTO memory_item_vec(');
    expect(triggers.insert).not.toContain("NEW.projection_type NOT LIKE 'window:%'");
  });

  it('insert 트리거가 minilm 테이블에 native 와 윈도 projection을 포함한다 (#1112)', () => {
    expect(triggers.insert).toContain("embedding_provider = 'minilm'");
    expect(triggers.insert).toContain("'window:15'");
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

  // #809 FR-016: schema.sql triggers pass BLOB directly
  it('vec 트리거에 json_extract가 없고 NEW.embedding을 직접 전달한다', () => {
    expect(schemaSql).not.toMatch(/json_extract\s*\(\s*NEW\.embedding/i);
    expect(schemaSql).toContain('NEW.embedding');
  });

  it('memory_embedding.embedding 컬럼이 BLOB이다', () => {
    expect(schemaSql).toMatch(/embedding\s+BLOB/i);
    expect(schemaSql).not.toMatch(/embedding\s+TEXT\s+NOT\s+NULL/i);
  });

  it('레거시 memory_item_vec DDL 은 없고 minilm float[384] 은 남는다', () => {
    expect(schemaSql).not.toContain('INSERT INTO memory_item_vec(');
    expect(schemaSql).not.toContain('DELETE FROM memory_item_vec ');
    expect(schemaSql).not.toContain(
      'CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec USING vec0(embedding float[384] distance_metric=cosine)'
    );
    expect(schemaSql).toContain(
      'CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_minilm USING vec0(embedding float[384] distance_metric=cosine)'
    );
    expect(schemaSql).not.toContain("NEW.projection_type NOT LIKE 'window:%'");
  });
});
