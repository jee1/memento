import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { findSqlInjectionPatterns, withoutBaseline, type SqlInjectionLocation } from './check-sql-injection.js';

const loc = (context: string, line = 1): SqlInjectionLocation => ({
  file: '/repo/packages/a.ts',
  line,
  column: 1,
  pattern: 'where-template-literal',
  context,
  severity: 'high',
});

describe('withoutBaseline', () => {
  it('drops reviewed findings regardless of line shifts and keeps new ones', () => {
    const baseline = ['packages/a.ts|where-template-literal|WHERE ${safe}'];
    const fresh = withoutBaseline([loc('WHERE ${safe}', 40), loc('WHERE ${raw}')], '/repo', baseline);
    expect(fresh.map((l) => l.context)).toEqual(['WHERE ${raw}']);
  });

  it('only absorbs as many duplicates as were reviewed', () => {
    const baseline = ['packages/a.ts|where-template-literal|WHERE ${safe}'];
    const fresh = withoutBaseline([loc('WHERE ${safe}', 1), loc('WHERE ${safe}', 9)], '/repo', baseline);
    expect(fresh.map((l) => l.line)).toEqual([9]);
  });
});

describe('findSqlInjectionPatterns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sqli-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const scan = (lines: string[]) => {
    const file = join(dir, `f${Math.random().toString(36).slice(2)}.ts`);
    writeFileSync(file, lines.join('\n'));
    return findSqlInjectionPatterns(file).map(l => `${l.line}:${l.column}:${l.pattern}:${l.severity}`);
  };

  it('string-concatenation: variable concat only, with safe-builder exceptions', () => {
    expect(scan([
      "sql += ' AND owner = ' + ownerId;",
      "sql += ' ORDER BY id';",
      "query += ' WHERE ' + conditions.join(' AND ');",
      "sql += ' AND id IN (' + placeholders + ')';",
      "// sql += ' x ' + y;",
      "const label = 'sql += ' + x;",
    ])).toEqual(['1:1:string-concatenation:high', '3:10:sql-string-concatenation:high']);
  });

  it('string-concatenation: reflectionNotesLike from the builder within 5 lines is allowed', () => {
    const builder = 'const reflectionNotesLike = buildReflectionNotesSearchCondition(x);';
    const use = 'sql += " AND " + reflectionNotesLike;';
    expect(scan([builder, '', '', '', use])).toEqual([]);
    expect(scan([builder, '', '', '', '', '', use])).toEqual(['7:1:string-concatenation:high']);
  });

  it('dynamic-table-name: allowed only after a validation within 300 lines', () => {
    const query = 'const rows = db.prepare(`SELECT * FROM ${tableName}`).all();';
    expect(scan([query])).toEqual(['1:35:dynamic-table-name:medium']);
    expect(scan(['const tableName = this.getTableName(provider);', query])).toEqual([]);
    expect(scan(['validateTableName(tableName);', ...Array(299).fill(''), query])).toEqual([]);
    expect(scan(['validateTableName(tableName);', ...Array(300).fill(''), query])).toEqual(['302:35:dynamic-table-name:medium']);
    expect(scan(["const tableName = cfg ?? 'memory_item_vec_tfidf';", query])).toEqual([]);
    expect(scan(['const tableName = VECTOR_SEARCH_CONFIG.tableNames.x;', 'x', query])).toEqual([]);
  });

  it('where-template-literal: flagged only without a ? placeholder or known-safe builder', () => {
    expect(scan([
      'db.prepare(`SELECT * FROM t WHERE id = ${id}`);',
      'db.prepare(`SELECT * FROM t WHERE id = ${id} AND x = ?`);',
      "db.prepare(`SELECT * FROM t WHERE ${conditions.join(' AND ')}`);",
      'db.prepare(`SELECT * FROM t WHERE id IN (${placeholders})`);',
      'db.prepare(`SELECT * FROM t WHERE ${config.filter}`);',
    ])).toEqual(['1:29:where-template-literal:high']);
  });

  it('sql-string-concatenation and unreadable files', () => {
    expect(scan(["const q = 'SELECT * FROM t WHERE id = ' + id;"])).toEqual(['1:11:sql-string-concatenation:high']);
    expect(findSqlInjectionPatterns(join(dir, 'missing.ts'))).toEqual([]);
  });
});
