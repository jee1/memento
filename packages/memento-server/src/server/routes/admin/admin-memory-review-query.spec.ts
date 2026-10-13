import { describe, expect, it } from 'vitest';
import { parseReviewCandidateListQuery } from './admin-memory-review.routes.js';

describe('parseReviewCandidateListQuery', () => {
  it('모든 필터와 페이지를 파싱한다', () => {
    expect(parseReviewCandidateListQuery({
      status: 'pending',
      importance_min: '0.2',
      importance_max: '0.8',
      unused_days_min: '3',
      unused_days_max: '30',
      memory_type: 'episodic',
      reason_contains: 'stale',
      page_size: '50',
      page: '2',
    })).toEqual({
      status: 'pending',
      importance_min: 0.2,
      importance_max: 0.8,
      unused_days_min: 3,
      unused_days_max: 30,
      memory_type: 'episodic',
      reason_contains: 'stale',
      page_size: 50,
      page: 2,
    });
  });

  it('빈 쿼리는 빈 입력이다', () => {
    expect(parseReviewCandidateListQuery({})).toEqual({});
  });

  it('page_size 만 주면 page 는 1 이다', () => {
    expect(parseReviewCandidateListQuery({ page_size: '25' })).toEqual({ page_size: 25, page: 1 });
  });

  it.each([
    [{ importance_min: '0.9', importance_max: '0.1' }, 'importance_min must be <= importance_max'],
    [{ unused_days_min: '9', unused_days_max: '1' }, 'unused_days_min must be <= unused_days_max'],
    [{ page: '2' }, 'page requires page_size'],
    [{ page_size: '30' }, 'Invalid page_size query'],
    [{ memory_type: 'core' }, 'Invalid memory_type query'],
    [{ reason_contains: 'x'.repeat(201) }, 'Invalid reason_contains query'],
  ])('잘못된 쿼리 %j 는 400 을 낸다', (query, error) => {
    expect(parseReviewCandidateListQuery(query)).toEqual({ error, status: 400 });
  });
});
