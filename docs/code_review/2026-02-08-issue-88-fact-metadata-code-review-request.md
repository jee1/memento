# Code Review Request — Issue #88 Fact 메타데이터 표준화

코드 리뷰어(subagent 또는 담당자)용 요청서. 아래 지시와 Git 범위로 리뷰 수행.

---

# Code Review Agent
You are reviewing code changes for production readiness.
**Your task:**
1. Review what was implemented (Fact 1급 객체화 및 메타데이터 표준화: migration 017, remember 저장, recall 가중)
2. Compare against the plan/requirements below
3. Check code quality, architecture, testing
4. Categorize issues by severity
5. Assess production readiness

## What Was Implemented
Issue #88 구현: (1) 마이그레이션 017로 `memory_item`에 `num_times`, `last_mentioned_at`, `source_session_id`, `confidence` 컬럼·인덱스 추가 (2) `MemoryItem` 타입 및 remember 스키마/INSERT·UPDATE 연동 (3) SearchEngine에서 Fact 메타 SELECT 및 `calculateFactMetadataBoost()`로 recall 점수 가중(1.0~1.2). schema.sql·테스트 스키마 보강.

## Requirements/Plan
- **이슈:** [GitHub #88](https://github.com/jee1/memento/issues/88) — feat(memori): Fact 1급 객체화 및 메타데이터 표준화
- **계획:** `docs/plans/2026-02-08-issue-88-fact-metadata-implementation-plan.md`
- **요구사항 요약:** Fact 단위 저장(표준 메타), 표준 메타(num_times, last_mentioned_at, source_session_id, confidence), 콘솔리데이션 Fact 단위(기존 consolidation_score 활용), recall/검색 시 메타 활용

## Git Range to Review
**Base:** 4ad4d0abb51f13e9c9e6d3d68f4010ff50cc3774 (origin/main)  
**Head:** f12c7b23cff4114f4118097db16c27c4abdbfd97 (feat/issue-88-fact-metadata)

```bash
git diff --stat 4ad4d0abb51f13e9c9e6d3d68f4010ff50cc3774..f12c7b23cff4114f4118097db16c27c4abdbfd97
git diff 4ad4d0abb51f13e9c9e6d3d68f4010ff50cc3774..f12c7b23cff4114f4118097db16c27c4abdbfd97
```

## Review Checklist
**Code Quality:** 관심사 분리, 에러 처리, 타입 안전성, DRY, 경계 케이스  
**Architecture:** 설계 일관성, 확장성, 성능, 보안  
**Testing:** 실제 로직 검증, 경계 케이스, 통합 테스트, 전체 테스트 통과  
**Requirements:** 계획 요구사항 충족, 스펙 일치, 스코프 크리프 없음, breaking change 문서화  
**Production Readiness:** 마이그레이션 전략, 하위 호환, 문서, 명백한 버그 없음  

## Output Format
리뷰 결과는 다음 형식으로 작성:
- **Strengths** (구체적)
- **Issues** — Critical / Important / Minor (파일:라인, 내용, 이유, 수정 방향)
- **Recommendations**
- **Assessment** — Ready to merge? Yes/No/With fixes + 이유 1–2문장

## Critical Rules
DO: 심각도별 분류, 구체적 참조(file:line), 이유 설명, 강점 인정, 명확한 결론  
DON'T: 검증 없이 "looks good", 사소한 것을 Critical로, 리뷰하지 않은 코드 피드백, 모호한 지적, 결론 회피

---

# 리뷰 결과 (2026-02-08)

## Strengths
- **마이그레이션 TDD**: 017 스펙에서 validateBefore / up / validateAfter / down 시나리오를 Given-When-Then으로 검증하고, 기존 016 패턴(columnExists, indexExists, schema_version 체크)을 일관되게 따름.
- **스키마·타입 정합**: `schema.sql`, `MemoryItem`, remember 스키마, INSERT/UPDATE 바인딩이 동일한 4개 필드(num_times, last_mentioned_at, source_session_id, confidence)로 맞춰져 있음.
- **하위 호환**: 새 컬럼은 NULL 허용 또는 DEFAULT 1, 기존 DB는 마이그레이션 017 적용 시만 확장되며 기존 행은 NULL/1로 안전.
- **검색 가중치**: `calculateFactMetadataBoost`가 1.0~1.2로 상한되어 점수 폭주를 막고, `num_times`는 log(1+x)로 완만하게 반영됨.
- **테스트**: Fact 메타 기본값·명시값 저장 검증, 검색/하이브리드/consolidation 테스트용 스키마에 Fact 컬럼 반영으로 관련 스위트 통과.

## Issues

### Critical (Must Fix)
없음.

### Important (Should Fix)
없음.

### Minor (Nice to Have)
1. **Fact boost 상수화**
   - 파일: `src/domains/search/algorithms/search-engine.ts` (calculateFactMetadataBoost)
   - 내용: `0.1`, `1.2`, `30 * 24 * 60 * 60 * 1000` 등 매직 넘버가 인라인으로 사용됨.
   - 이유: 튜닝·설명 시 한곳에서 관리하는 편이 유지보수에 유리함.
   - 수정: `FACT_BOOST_WEIGHT`, `FACT_BOOST_CAP`, `RECENCY_HALFLIFE_MS` 등 상수로 추출해 주석으로 의미 명시.

2. **last_mentioned_at 검증 형식**
   - 파일: `src/domains/memory/tools/remember-tool.ts` (RememberSchema)
   - 내용: `z.string().datetime()`은 ISO 8601 형식만 허용하여, 일부 클라이언트의 다른 날짜 문자열은 검증 실패할 수 있음.
   - 이유: 호환성·UX. 선택 파라미터라 영향은 제한적.
   - 수정: 필요 시 `.or(z.string())`로 완화하거나, 도구/API 문서에 “ISO 8601 권장” 명시.

3. **마이그레이션 down 문서화**
   - 파일: `src/infrastructure/database/database/migration/migrations/017-fact-metadata-fields.ts` (down)
   - 내용: SQLite < 3.35에서는 DROP COLUMN 미지원으로 down 후에도 컬럼이 남을 수 있음.
   - 이유: 016과 동일한 정책이지만, 주석으로 명시해 두면 운영 시 혼동을 줄일 수 있음.
   - 수정: down() 상단에 “SQLite < 3.35: DROP COLUMN 미지원, 인덱스 제거 및 버전 기록 삭제만 수행” 주석 추가.

## Recommendations
- 향후 Fact 메타를 활용한 recall 정책(예: semantic만 가중, 타입별 다른 계수)이 필요해지면 `calculateFactMetadataBoost`에 `type` 또는 옵션 인자를 넘겨 확장하기 쉬운 형태로 두는 것을 고려.
- MCP/API 스키마에 Fact 메타 필드(num_times, last_mentioned_at, source_session_id, confidence)가 노출되는지 확인하고, 필요 시 스펙/문서에 반영.

## Assessment
**Ready to merge?** Yes  
**Reasoning:** 요구사항(Fact 표준 메타 저장, recall 시 메타 가중)이 계획대로 반영되었고, 마이그레이션·타입·테스트가 일관되게 추가됨. Critical/Important 이슈 없음. Minor는 머지 후 개선해도 무방함.
