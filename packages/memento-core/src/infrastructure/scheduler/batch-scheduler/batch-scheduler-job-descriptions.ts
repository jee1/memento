/**
 * Operator-facing batch schedule descriptions (#1464).
 * Single source for Admin Jobs UI and GET /admin/batch/stats.
 */
export const BATCH_SCHEDULER_JOB_DESCRIPTIONS: Readonly<Record<string, string>> = {
  cleanup:
    '망각 정책 배치 — 타입별 TTL·망각 점수 soft delete(working/episodic/semantic/procedural), 유예 기간 경과 hard delete',
  monitoring:
    'PerformanceMonitor — Node 힙, DB 크기, 쿼리 지연 등 자원 지표 수집 및 경고',
  healthcheck:
    'HealthChecker — DB SELECT 1, Node 힙 사용률, 실행 중 잡 수, 큐 크기 점검',
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
  anchor_auto_refresh:
    '빈 슬롯·1일 이상 미갱신 앵커 슬롯에 후보 memory_item을 고르고 setAnchor로 슬롯 기억 교체',
  embedding_reconciliation:
    '활성 memory_item 대비 native embedding 누락, content_hash 불일치, 현재 provider 미일치 행 재생성',
  supersede_candidate_scan:
    '최근 기억과 같은 범위의 옛 기억 쌍을 LLM 으로 확정/확인 대기/양립으로 분류해 후보 테이블에만 기록 (기억은 바꾸지 않음, SUPERSEDE_CANDIDATE_SCAN_ENABLED=true 일 때만)',
};

export function resolveBatchSchedulerJobDescription(jobName: string): string | null {
  if (typeof jobName !== 'string' || jobName.trim() === '') {
    return null;
  }
  if (!Object.hasOwn(BATCH_SCHEDULER_JOB_DESCRIPTIONS, jobName)) {
    return null;
  }
  return BATCH_SCHEDULER_JOB_DESCRIPTIONS[jobName] ?? null;
}
