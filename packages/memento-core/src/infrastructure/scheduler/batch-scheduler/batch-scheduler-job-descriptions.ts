/**
 * Operator-facing batch schedule descriptions (#1464).
 * Single source for Admin Jobs UI and GET /admin/batch/stats.
 */
export const BATCH_SCHEDULER_JOB_DESCRIPTIONS: Readonly<Record<string, string>> = {
  cleanup:
    '망각 정책 배치 — TTL 만료 working/episodic soft delete, 유예 기간이 지난 항목 hard delete',
  monitoring:
    'PerformanceMonitor — Node 힙, DB 크기, 쿼리 지연 등 자원 지표 수집 및 경고',
  healthcheck: 'DB 연결, sqlite-vec 등 필수 컴포넌트 건전성 점검',
  log_rotation:
    '로그·백업 보존 — 텔레메트리 retention, migration 백업 개수, docker diagnostics·monitor jsonl 용량 상한',
  quality_measurement_batch:
    '기억 품질 측정 — 중복률, 메타데이터 완성도, 검색 랭킹 품질 지표',
  meta_memory_introspection:
    '메타 기억 introspection — 저신뢰·고실패 기억 후보 탐지',
  memory_review_candidates:
    '검토 대기열 후보 선정 및 memory_review_candidate 행 갱신',
  sleep_consolidation_batch:
    '수면 통합 — episodic 클러스터링·요약, semantic 승격 및 관계 연결',
  telemetry_cleanup_batch: '만료된 search_quality·feedback_quality 텔레메트리 행 삭제',
  forgetting_event_cleanup_batch: '보존 기간이 지난 forgetting_event 감사 로그 삭제',
  job_run_cleanup_batch:
    '오래된 job_run 및 job_run_log durable 실행 이력 삭제 (JOB_RUN_RETENTION_DAYS)',
  anchor_auto_refresh: '앵커 맵 자동 force 시뮬레이션 및 슬롯 배치 갱신',
  embedding_reconciliation:
    'memory_item 대비 embedding 누락·차원 불일치·provider drift 보정',
};

export function resolveBatchSchedulerJobDescription(jobName: string): string | null {
  if (typeof jobName !== 'string' || jobName.trim() === '') {
    return null;
  }
  return BATCH_SCHEDULER_JOB_DESCRIPTIONS[jobName] ?? null;
}
