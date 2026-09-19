# Project Memory

## Hot Memory

- [decision][refs:2][last_referenced:2026-09-19][last_verified:2026-09-19] Issue #1048 P1: Ops `상태` 탭(첫 탭) + `GET /admin/status`. 주표기=사람 읽는 시간; 가동률 %·errorRate·memory% 금지. `process.uptimeMs`≠`scheduler.uptimeMs`. 배치=`batchImpact.durationMsSum`(success=0 `duration_ms` 합, 30일) — UI「배치 영향 시간」+ 툴팁「실패 실행 소요 합, 서비스 중단 아님」. Review `pendingTotal`+`netFlow1h`; embedding=`problemCount`+provider만(coverage % 금지). P1 색점/숫자 threshold 없음 — `ok|degraded|unavailable` 텍스트+degrade 배너만.
- [vocabulary][refs:2][last_referenced:2026-09-19][last_verified:2026-09-19] 「프로세스 가동」=`process.uptime`; 「스케줄러 가동」=`BatchScheduler.startTime` ms. 「배치 영향 시간」=failed run `duration_ms` 합(≠다운타임). Card3=「운영 흐름」(검토·임베딩 요약).
- [architecture][refs:1][last_referenced:2026-09-19][last_verified:2026-09-19] P1 `formatDurationHumanKo`는 status 패널 로컬; P2 `static/js/admin-format-duration.js` 추출+Jobs `renderHealth`. `/admin/status` embedding은 `diagnose()` problemCount만 — timeout→`embedding.degraded`, HTTP 200 유지.
- [constraint][refs:2][last_referenced:2026-09-19][last_verified:2026-09-19] 상태 탭 Jobs deep dive 대체 아님. API shape P1 freeze → #1025 strip subset consume(P3). 신규: `JobRunRepository.aggregateFailedDurationSince`.

## Warm Memory

- [open-question][refs:1][last_referenced:2026-09-19][last_verified:unverified] P2 numeric threshold(🟡🔴)·`idx_job_run` partial index 필요 여부(실측 후).
- [open-question][refs:1][last_referenced:2026-09-19][last_verified:unverified] #1025 Anchor Map ops strip ↔ `/admin/status` subset 필드 목록.
- [rejected-alternative][refs:1][last_referenced:2026-09-19][last_verified:2026-09-19] P1: Ops digest bar만·incident narrative 단일문장·Jobs header digest만 — 전용 탭+3카드 유지.
- [rejected-alternative][refs:1][last_referenced:2026-09-19][last_verified:2026-09-19] P1 🟡🔴 emoji threshold — false alarm 위험; 텍스트 degrade만 ship.

## Cold Memory

- [constraint][refs:0][last_referenced:2026-09-19][last_verified:2026-09-19] `job_run` retention 90일; 30일 윈도우·신규 설치 시 `windowDays`·`dataSince`·`since` echo; retention<30d면 clamp.

## Archived Decisions

- (none)
