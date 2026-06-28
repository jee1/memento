# Implementation Plan: 031-performance-monitor-split

## Architecture

`PerformanceMonitor` god node(1198줄)를 **composition**으로 분해한다. Public import 경로(`performance-monitor.js`)와 export surface는 유지하고, 내부 책임만 sub-module로 이동한다.

```text
performance-monitor.ts          # 오케스트레이션, lifecycle, history, singleton
performance-monitor-types.ts    # shared interfaces
memory-pressure-utils.ts        # denominator, ratio, formatBytes
cpu-usage-tracker.ts            # dual-baseline CPU
search-metrics-store.ts         # in-memory search stats
database-metrics-reader.ts      # SQLite metrics + optimize
performance-alert-manager.ts    # thresholds, alerts Map, check/resolve/stats
performance-analytics.ts        # trends, analytics, recommendations
```

## Changes

| 파일 | 변경 |
|------|------|
| `performance-monitor-types.ts` | 신규 — 타입 |
| `memory-pressure-utils.ts` | 신규 — 메모리 유틸 |
| `cpu-usage-tracker.ts` | 신규 — CPU tracker class |
| `search-metrics-store.ts` | 신규 — 검색 통계 |
| `database-metrics-reader.ts` | 신규 — DB reader/optimizer |
| `performance-alert-manager.ts` | 신규 — 알림 판정·상태 |
| `performance-analytics.ts` | 신규 — 집계·트렌드 |
| `performance-monitor.ts` | 축소 — delegate only |
| `docs/architecture/core-deprecated-inventory.md` | memory 모듈 경로 갱신 |

## Test Strategy

- 선행: `performance-monitor.spec.ts` green 확인
- 분리 후: 동일 spec 재실행
- 전체: `npm run build && npm test && npm run lint && npm run type-check`

## Constitution Alignment

- Structural refactoring exception (Constitution I): CI green = regression signal
- Backward compatibility (Constitution II): import path·public API 유지
- Quality gates (Constitution IV) 필수
