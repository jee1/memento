import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

/**
 * `memory_item` 직접 SQL 동결 (#1531).
 *
 * 레인마다 SQL 을 따로 들고 있어 한쪽만 고치면 어긋난다(#998, #1006, #1009, #1392).
 * 새 파일이 `memory_item` SQL 을 쓰면 이 spec 이 실패한다. 늘리려면 PR 리뷰로
 * 허용 목록과 FROZEN 상수를 같이 올려야 하고, 줄이면 둘을 같이 내린다.
 * 2026-10-30 HEAD 측정: 80파일 → server 8파일 이관 후 72파일.
 * 방식은 #749 `dependency-boundaries.spec.ts` 를 따른다.
 */
const repoRoot = path.resolve(import.meta.dirname, '..');
const SCAN_ROOTS = ['packages/memento-core/src', 'packages/memento-server/src'] as const;

type AllowlistEntry = { readonly path: string; readonly rationale: string };

const MEMORY_ITEM_SQL_ALLOWLIST: readonly AllowlistEntry[] = [
  {
    path: 'packages/memento-core/src/domains/agent-integration/services/sqlite-hybrid-agent-context-source.ts',
    rationale: 'agent-integration 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/anchor/services/anchor/anchor-cache-service.ts',
    rationale: 'anchor 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/anchor/services/anchor/anchor-manager.ts',
    rationale: 'anchor 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/anchor/services/anchor/anchor-reanchor-service.ts',
    rationale: 'anchor 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/anchor/services/anchor/n-hop-linked-memory-service.ts',
    rationale: 'anchor 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/anchor/tools/set-anchor-tool.ts',
    rationale: 'anchor 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.ts',
    rationale: 'consolidation 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/embedding/services/embedding-reindex-service.ts',
    rationale: 'embedding 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/forgetting/services/forgetting-policy-service.ts',
    rationale: 'forgetting 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/introspection/introspection-healing-service.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/introspection/meta-memory-service.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/procedural/procedural-memory-change-detector.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/procedural/procedural-memory-diff.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/procedural/procedural-memory-similarity.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/procedural/procedural-rollback-service.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/procedural/procedural-versioning.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/recall/recall-tool-anchor-rotation.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/recall/recall-tool-metadata-enrich.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/remember/remember-tool-db-helpers.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/remember/remember-tool-memory-item.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/remember/remember-tool-near-duplicate.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/remember/remember-tool-reflection.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/remember/remember-tool-schema.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/remember/work-record.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/repositories/memory-item-repository.ts',
    rationale: 'server 8파일에서 이관한 질의와 기존 기억 저장소의 SQL 소유 지점',
  },
  {
    path: 'packages/memento-core/src/domains/memory/review/memory-review-candidate-list-query.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/review/memory-review-candidate-persistence-service.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/review/memory-review-candidate-selection-service.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/services/admin-memory-item-preview-service.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/embedding/services/memory-embedding-service.ts',
    rationale: 'embedding 도메인의 임베딩 저장·유사도 검색 질의; 기존 접근 범위 유지',
  },
  {
    path: 'packages/memento-core/src/domains/memory/services/memory-jsonl-portability.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/services/memory-neighbor-service.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/services/repetition-meta-update-service.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/tools/export-memories-tool.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/tools/feedback-tool.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/tools/forget-tool.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/tools/memory-injection-prompt.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/tools/pin-tool.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/tools/unpin-tool.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/memory/tools/wipe-memory-tool.ts',
    rationale: 'memory 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/monitoring/services/database-metrics-reader.ts',
    rationale: 'monitoring 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/monitoring/services/quality-assurance/storage-metrics-collector.ts',
    rationale: 'monitoring 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/relation/tools/add-relation-tool.ts',
    rationale: 'relation 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/relation/tools/extract-relations-tool.ts',
    rationale: 'relation 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/relation/tools/get-relations-tool.ts',
    rationale: 'relation 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/relation/tools/visualize-relations-tool.ts',
    rationale: 'relation 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/search/algorithms/hybrid-result-ranker.ts',
    rationale: 'search 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/search/algorithms/procedural-memory-matcher.ts',
    rationale: 'search 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/search/algorithms/search-engine/search-engine-sql-builder.ts',
    rationale: 'search 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/search/repositories/vector-search/vector-search-hybrid-query.ts',
    rationale: 'search 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/search/repositories/vector-search/vector-search-knn-query.ts',
    rationale: 'search 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/search/repositories/vector-search/vector-search-scope.ts',
    rationale: 'search 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/domains/telemetry/repositories/telemetry-memory-quality-query.ts',
    rationale: 'telemetry 도메인의 기존 기억 질의; 레인별 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/infrastructure/database/repositories/agent-integration-promotion-store.ts',
    rationale: '기존 저장·스키마 검증·업그레이드 경로; 이번 server 이관 범위 밖',
  },
  {
    path: 'packages/memento-core/src/infrastructure/database/sqlite/migration/idempotent-ddl.ts',
    rationale: 'migration 054/057 up() 전용 idempotent DDL; 운영 서비스 경로에서 호출하지 않음 (#1535)',
  },
  {
    path: 'packages/memento-core/src/infrastructure/database/sqlite/migrate.ts',
    rationale: '기존 저장·스키마 검증·업그레이드 경로; 이번 server 이관 범위 밖',
  },
  {
    path: 'packages/memento-core/src/infrastructure/database/sqlite/migration/dependency-validator.ts',
    rationale: '기존 저장·스키마 검증·업그레이드 경로; 이번 server 이관 범위 밖',
  },
  {
    path: 'packages/memento-core/src/infrastructure/database/sqlite/migration/migration-repair-helpers.ts',
    rationale: '기존 저장·스키마 검증·업그레이드 경로; 이번 server 이관 범위 밖',
  },
  {
    path: 'packages/memento-core/src/infrastructure/reflexion-procedural-memory-service.ts',
    rationale: '기존 배치·reflexion 기억 접근; 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/infrastructure/reflexion-procedural-memory-service/reflexion-procedural-create.ts',
    rationale: '기존 배치·reflexion 기억 접근; 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/infrastructure/reflexion-procedural-memory-service/reflexion-procedural-update-incremental.ts',
    rationale: '기존 배치·reflexion 기억 접근; 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/infrastructure/reflexion-procedural-memory-service/reflexion-procedural-update-replace.ts',
    rationale: '기존 배치·reflexion 기억 접근; 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/infrastructure/reflexion-reflection-recorder.ts',
    rationale: '기존 배치·reflexion 기억 접근; 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/infrastructure/scheduler/batch-scheduler/batch-scheduler-database-stats.ts',
    rationale: '기존 배치·reflexion 기억 접근; 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/infrastructure/scheduler/handlers/batch-scheduler-anchor-handlers.ts',
    rationale: '기존 배치·reflexion 기억 접근; 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/infrastructure/scheduler/jobs/embedding-reconciliation-batch-job.ts',
    rationale: '기존 배치·reflexion 기억 접근; 후속 이관 대상',
  },
  {
    path: 'packages/memento-core/src/shared/utils/memory-filter-sql.ts',
    rationale: '기존 공용 필터·스키마·쓰기 경로; 이번 server 이관 범위 밖',
  },
  {
    path: 'packages/memento-core/src/shared/utils/owned-ids.ts',
    rationale: '기존 공용 필터·스키마·쓰기 경로; 이번 server 이관 범위 밖',
  },
  {
    path: 'packages/memento-core/src/shared/utils/window-embedding-write.ts',
    rationale: '기존 공용 필터·스키마·쓰기 경로; 이번 server 이관 범위 밖',
  },
  {
    path: 'packages/memento-core/src/tools/migrate-embeddings-tool.ts',
    rationale: '기존 임베딩 이관 도구; 이번 server 이관 범위 밖',
  },
] as const;

/** 허용 목록 증가 방지 가드 — 리뷰 없이 올리지 않는다 (#1531). */
const FROZEN_MEMORY_ITEM_SQL_FILE_COUNT = 70;

/**
 * 문자열 리터럴 안의 `memory_item` 테이블 참조.
 * 절 키워드나 컬럼 한정자를 같이 봐야 테이블 이름만 담은 목록
 * (`check-migration-status.ts` 의 존재 확인 배열)이 섞이지 않는다.
 * `\b` 때문에 `memory_item_vec`·`memory_item_fts` 는 걸리지 않는다.
 */
const MEMORY_ITEM_SQL_PATTERNS = [
  /\b(?:from|join|into|update|table)\s+(?:if\s+not\s+exists\s+)?["`[]?memory_item\b/i,
  /\bmemory_item["`\]]?\s*\./i,
];

/** ts.createSourceFile 의 가상 파일명 — ScriptKind.TS 고정이라 경로는 파싱에 영향이 없다 (#926). */
const AST_VIRTUAL_FILE = 'virtual.ts';

const TEMPLATE_PART_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  return TEMPLATE_PART_KINDS.has(node.kind) ? (node as ts.TemplateLiteralLikeNode).text : null;
}

function hasMemoryItemSqlLiteral(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    AST_VIRTUAL_FILE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    const text = literalText(node);
    if (text !== null && MEMORY_ITEM_SQL_PATTERNS.some((pattern) => pattern.test(text))) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function isExcludedDirectory(name: string): boolean {
  return name === '__tests__' || name === 'test' || name === 'migrations';
}

function isProductionTsFile(name: string): boolean {
  return (
    name.endsWith('.ts') &&
    !name.endsWith('.d.ts') &&
    !name.endsWith('.spec.ts') &&
    !name.endsWith('.test.ts')
  );
}

async function collectProductionTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return isExcludedDirectory(entry.name) ? [] : await collectProductionTsFiles(entryPath);
      }
      if (!entry.isFile() || !isProductionTsFile(entry.name)) {
        return [];
      }
      return [path.relative(repoRoot, entryPath).split(path.sep).join('/')];
    }),
  );

  return files.flat();
}

async function collectMemoryItemSqlFiles(): Promise<string[]> {
  const roots = await Promise.all(
    SCAN_ROOTS.map(async (root) => await collectProductionTsFiles(path.join(repoRoot, root))),
  );
  const candidates = roots.flat().sort();
  const matches = await Promise.all(
    candidates.map(async (file) => {
      const source = await readFile(path.join(repoRoot, file), 'utf8');
      return hasMemoryItemSqlLiteral(source) ? [file] : [];
    }),
  );

  return matches.flat();
}

describe('memory_item SQL 동결 (#1531)', () => {
  it.each([
    "db.prepare('SELECT id FROM memory_item')",
    'db.exec(`UPDATE memory_item SET content = ${value} WHERE id = ?`)',
    'db.prepare(`SELECT id FROM "memory_item"`)',
    'db.exec(`CREATE TABLE IF NOT EXISTS memory_item (id TEXT)`)',
    'db.prepare(`SELECT memory_item.id FROM ${table}`)',
  ])('새 SQL 리터럴을 검출한다: %s', (source) => {
    expect(hasMemoryItemSqlLiteral(source)).toBe(true);
  });

  it('주석·테이블 이름 목록·다른 테이블은 제외한다', () => {
    expect(hasMemoryItemSqlLiteral(`
      // SELECT id FROM memory_item
      const tables = ['memory_item'];
      db.prepare('SELECT id FROM memory_item_vec');
      db.prepare('SELECT id FROM memory_item_fts');
    `)).toBe(false);
  });

  it('허용 목록에 없는 memory_item SQL 파일을 막는다', async () => {
    expect(MEMORY_ITEM_SQL_ALLOWLIST).toHaveLength(FROZEN_MEMORY_ITEM_SQL_FILE_COUNT);
    expect(new Set(MEMORY_ITEM_SQL_ALLOWLIST.map((entry) => entry.path)).size).toBe(
      FROZEN_MEMORY_ITEM_SQL_FILE_COUNT,
    );
    expect(MEMORY_ITEM_SQL_ALLOWLIST.every((entry) => entry.rationale.trim().length > 0)).toBe(true);

    const offenders = await collectMemoryItemSqlFiles();
    const allowlistPaths = new Set(MEMORY_ITEM_SQL_ALLOWLIST.map((entry) => entry.path));
    const unexpected = offenders.filter((file) => !allowlistPaths.has(file)).sort();
    const stale = [...allowlistPaths].filter((file) => !offenders.includes(file)).sort();

    expect(unexpected, `새 memory_item SQL (허용 목록 없음): ${unexpected.join(', ')}`).toEqual([]);
    expect(stale, `허용 목록 잔재 (항목을 지우거나 SQL 을 되살려라): ${stale.join(', ')}`).toEqual([]);
  });

  it('server 패키지에는 memory_item SQL 이 없다', async () => {
    const offenders = (await collectMemoryItemSqlFiles()).filter((file) =>
      file.startsWith('packages/memento-server/'),
    );

    expect(offenders, `server memory_item SQL: ${offenders.join(', ')}`).toEqual([]);
  });
});
