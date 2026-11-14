/**
 * Operator-facing batch schedule descriptions (#1464 / #1724).
 * Single source for Admin Jobs UI and GET /admin/batch/stats.
 * Avoid English internal class/table names in the visible sentence.
 */
export const BATCH_SCHEDULER_JOB_DESCRIPTIONS: Readonly<Record<string, string>> = {
  cleanup:
    '타입별 보관 기간과 망각 점수로 만료된 기억을 먼저 숨기고, 유예가 지나면 완전히 지웁니다',
  monitoring: '메모리·DB 크기·쿼리 지연 같은 자원 지표를 모아 경고합니다',
  healthcheck: 'DB 연결, 메모리 사용률, 실행 중·대기 작업 수를 점검합니다',
  log_rotation:
    '텔레메트리·마이그레이션 백업·진단 로그 용량이 한도를 넘지 않게 정리합니다',
  quality_measurement_batch: '중복률, 메타데이터 완성도, 검색 랭킹 품질 지표를 측정합니다',
  meta_memory_introspection: '저신뢰·고실패 기억 후보를 찾아 점검 목록에 올립니다',
  memory_review_candidates: '검토 대기열에 올릴 후보를 고르고 행을 갱신합니다',
  sleep_consolidation_batch:
    '최근 일화 기억을 묶어 요약하고, 의미 기억으로 올리며 관계를 잇습니다',
  telemetry_cleanup_batch: '만료된 검색·피드백 품질 측정 기록을 지웁니다',
  forgetting_event_cleanup_batch: '보존 기간이 지난 망각 감사 로그를 지웁니다',
  job_run_cleanup_batch: '오래된 배치 실행 이력과 실행 로그를 지웁니다',
  anchor_auto_refresh:
    '비었거나 하루 이상 안 바뀐 앵커 슬롯에 후보 기억을 골라 넣습니다',
  embedding_reconciliation:
    '활성 기억 중 임베딩이 없거나 내용·제공자가 어긋난 행을 다시 만듭니다',
  supersede_candidate_scan:
    '같은 범위의 옛·새 기억 쌍을 분류해 대체 후보 표에만 적습니다(기억 본문은 바꾸지 않음)',
  rejection_gate_drift_check:
    '기각 게이트의 주간 기각률과 활성 기억 규모가 기준에서 벗어났는지 기록합니다(임계값은 바꾸지 않음)',
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
