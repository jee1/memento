# feat: Issue #57 Phase 2 — remember_procedure, 성능 최적화(B), 다중 에이전트(D)

## 📝 변경 사항

Issue #57 Procedural Memory Phase 2 중 **독립 remember_procedure 툴**, **성능 최적화(B)**, **다중 에이전트(D)** 를 구현했습니다.

## 🎯 변경 유형

- [x] ✨ 새로운 기능 (기존 기능을 깨뜨리지 않는 새로운 기능)
- [x] ⚡ 성능 개선
- [x] ✅ 테스트 추가/수정
- [x] 📚 문서 업데이트

## 🔗 관련 이슈

- Closes #57 (Phase 2 일부: B, D 및 독립 remember_procedure)
- 관련 로드맵: `docs/plans/2026-02-05-issue57-phase2-roadmap.md`

## 📋 변경 사항 상세

### 추가된 기능

1. **독립 remember_procedure 툴 (Phase 2 C)**
   - 전용 MCP 툴 `remember_procedure` 추가
   - `workflow_name`, `skill_name`, `steps`, `trigger_conditions`, `task_goal` 등 전용 스키마 및 검증
   - 기존 `remember`와 분리된 로깅·에러 처리

2. **성능 최적화 (Phase 2 B)**
   - **마이그레이션 014**: `memory_item`에 `(type, version_series_id)`, `(type, version_series_id, version)` 복합 부분 인덱스 추가
   - **Recall 프로파일링**: `MEMENTO_RECALL_PROFILE=1` 설정 시 recall 호출당 `total_ms` 로그 출력
   - **문서**: `docs/recall-performance-tuning.md` — 프로파일링 방법 및 인덱스 가이드

3. **다중 에이전트 (Phase 2 D)**
   - **마이그레이션 015**: `memory_item`에 `owner_id TEXT NULL` 및 `idx_memory_item_owner_id` 인덱스 추가
   - **ToolContext**: `agentId?: string` 필드 추가
   - **remember / remember_procedure**: 입력 파라미터 또는 `context.agentId`로 `owner_id` 저장
   - **recall**: `owner_id` 필터 지원, 응답에 `owner_id` 포함
   - **문서**: `docs/multi-agent-usage.md` — owner_id 의미, 저장/조회 방법, context.agentId 설정 가이드

### 수정된 기능

- **SearchEngine**: procedural 검색 결과에 `m.owner_id` SELECT 포함
- **MemoryItem / recall 결과 타입**: `owner_id` 필드 추가

### 제거된 기능

- 없음

## 🧪 테스트

1. `npm test -- src/infrastructure/database/database/migration/migrations/014-procedural-version-indexes.spec.ts src/infrastructure/database/database/migration/migrations/015-memory-item-owner-id.spec.ts` — 마이그레이션 스펙
2. `npm test -- src/domains/memory/tools/__tests__/remember-procedure-tool.spec.ts src/domains/memory/tools/__tests__/remember-tool.spec.ts src/domains/memory/tools/__tests__/recall-tool.spec.ts` — 툴 동작 및 owner_id/version 관련 케이스
3. `npm run type-check` 및 `npm run lint`

### 테스트 결과

- [x] 모든 기존 테스트 통과
- [x] 새로운 테스트 추가 (014, 015 스펙, remember_procedure, recall owner_id 등)
- [x] 수동 테스트 완료 (선택)

## 📸 스크린샷

- UI 변경 없음 (MCP 툴·백엔드 확장)

## 🔍 코드 리뷰 포인트

- 마이그레이션 014/015의 인덱스 정의 및 backfill 유무
- recall 후처리에서 `owner_id` 필터 및 `version_filter`(기존 A 구현)와의 일관성
- `ToolContext.agentId`가 선택적이므로 기존 클라이언트 호환성 유지

## 📚 문서 업데이트

- [x] `docs/recall-performance-tuning.md` 추가
- [x] `docs/multi-agent-usage.md` 추가
- [x] `docs/plans/2026-02-05-issue57-phase2-roadmap.md` 업데이트 (B·D 완료 표시)
- [x] CHANGELOG [Unreleased] 반영

## ⚠️ 주의사항

- **DB 마이그레이션**: 014, 015 적용 필요. 기존 DB는 `npm run db:migrate`(또는 서버 기동 시 자동 마이그레이션)로 업그레이드.
- **환경 변수**: recall 프로파일링은 `MEMENTO_RECALL_PROFILE=1` 선택 사용. 기본값 미설정 시 동작 변경 없음.

## ✅ 체크리스트

- [x] 코드가 프로젝트의 코딩 스타일을 따릅니다
- [x] 자체 검토를 완료했습니다
- [x] 코드에 적절한 주석을 추가했습니다
- [x] 변경사항에 해당하는 문서를 업데이트했습니다
- [x] 새로운 경고나 오류가 없습니다
- [x] Breaking Change 없음 (기본 동작 유지)

## 🚀 배포 관련

- [x] **데이터베이스 마이그레이션 필요** — 014(procedural version indexes), 015(memory_item.owner_id)
- [ ] 환경 변수 변경 필요 — 선택: `MEMENTO_RECALL_PROFILE=1` (프로파일링용)
- [ ] 새로운 의존성 설치 필요 — 없음
- [ ] 특별한 배포 절차 필요 — 없음 (기존 `db:migrate` 또는 자동 마이그레이션)

---

**리뷰어분들께 감사드립니다! 🙏**
