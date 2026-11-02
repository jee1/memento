import type Database from 'better-sqlite3';
import { mementoConfig } from '../../../shared/config/index.js';
import {
  buildSupersedeCandidateCountSql,
  buildSupersedeCandidateListSql,
  buildSupersedeCandidateSelectSql,
  mapSupersedeCandidateListRow,
} from './supersede-candidate-list-query.js';
import type {
  QuerySupersedeCandidatesInput,
  SupersedeCandidatePagination,
  SupersedeCandidatesQueryResult,
} from './supersede-candidate-list.types.js';

function buildPagination(page: number, pageSize: 25 | 50, totalCount: number): SupersedeCandidatePagination {
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
  return {
    page,
    page_size: pageSize,
    total_count: totalCount,
    total_pages: totalPages,
    has_prev: totalCount > 0 && page > 1,
    has_next: totalPages > 0 && page < totalPages,
  };
}

export function querySupersedeCandidates(
  db: Database.Database,
  input: QuerySupersedeCandidatesInput,
): SupersedeCandidatesQueryResult {
  const pageSize = input.page_size ?? 25;
  const page = input.page ?? 1;
  const built = buildSupersedeCandidateListSql(input);
  const countRow = db.prepare(buildSupersedeCandidateCountSql(built).sql).get(built.params) as { count?: number };
  const totalCount = Number(countRow?.count ?? 0);
  const pagination = buildPagination(page, pageSize, totalCount);

  if (pagination.total_pages > 0 && page > pagination.total_pages) {
    return { candidates: [], pagination, filters_applied: built.filtersApplied };
  }

  const select = buildSupersedeCandidateSelectSql(built, { page, page_size: pageSize });
  const rows = db.prepare(select.sql).all(select.params) as Record<string, unknown>[];
  const applyEnabled = mementoConfig.supersedeApplyEnabled;
  return {
    candidates: rows.map((row) => mapSupersedeCandidateListRow(row, applyEnabled)),
    pagination,
    filters_applied: built.filtersApplied,
  };
}
