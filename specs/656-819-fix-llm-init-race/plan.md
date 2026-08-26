# Implementation Plan: Relation extractor silently falls back to rule-based

**Branch**: `656-819-fix-llm-init-race`
**Date**: 2026-08-25
**Spec**: [spec.md](./spec.md)
**Issue**: #819

## Summary

파일 2개만 고친다.

1. **레이스**: `RelationExtractor` 가 `LLMBasedRelationExtractor.isAvailable()` 을 동기로 부르는데, `preferredProvider` 는 생성자의 `initializationPromise.then()` 안에서만 세팅된다. 요청마다 새 인스턴스를 만드는 구조라 이 판정은 **항상** false → LLM 추출이 한 번도 시도되지 않는다. 초기화 완료를 보장하는 비동기 판정을 추가하고 두 판정 지점을 그쪽으로 옮긴다.
2. **가드 순서**: `LLMBasedRelationExtractor.extractRelations` 는 `await this.initializationPromise` **앞에서** throw 한다. 신규 인스턴스에서는 await 에 도달조차 못 한다. 순서를 뒤집는다.
3. **프로바이더 판정 불일치**: `isAvailable()` 은 `preferredProvider === 'ollama'` 면 true 지만, 실행 경로가 쓰는 `isOllamaAvailable()` 은 `mementoConfig.llmProvider === 'ollama'` 를 추가로 요구한다. `auto` 로 ollama 가 자동 선택된 환경에서 두 판정이 갈린다. 설정값 조건을 제거해 형제 서비스(`TripleExtractionService.determineProvider`)와 같은 기준으로 맞춘다.
4. **폴백 진단**: 규칙 기반 폴백 로그가 사유(미설정 / 초기화 실패 / 호출 실패)를 구분하게 한다.

추출기 재사용·싱글턴화, 새 설정값, 새 상태 타입·진단 API 는 범위 밖(spec Non-Goals).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules
**Primary Dependencies**: 기존 `@memento/core` (Vitest). 신규 dependency 없음.
**Storage**: DB 스키마·마이그레이션 변경 없음.
**Testing**: Vitest. 초기화 지연을 흉내내는 fake promise + 기존 prototype spy 패턴.
**Target Platform**: MCP server (`extract_relations` 도구 + `remember` 백그라운드 증강 경로)
**Project Type**: npm workspaces library (`packages/memento-core`)
**Performance Goals**: 규칙 기반 고신뢰 경로 대기 0(FR-007). 동기 대기는 `extract_relations` 도구 경로만이며 기존 초기화 재시도 상한 내(FR-008).
**Constraints**: 새 설정값 금지. 추출기 인스턴스 재사용 금지(별도 이슈). MCP 도구 요청·응답 형태 불변.
**Scale/Scope**: production 파일 2개 + 관련 테스트.

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Test-First | PASS — 각 US 마다 실패 테스트 먼저(초기화 미완 인스턴스의 LLM 시도, LLM 전용 미실패, auto+로컬 프로바이더, 미설정 회귀). |
| II. Public contracts | PASS — MCP `extract_relations` 요청·응답 형태 불변(FR-006). `isAvailable()` 은 제거하지 않고 유지 + "초기화 완료 이후에만 유효" 문서화(FR-009 단서 조항). 관계 추출이 **실제로 수행되기 시작**하는 것은 결함 수정이지 breaking 아님. |
| III. Schema/migration | PASS — 마이그레이션 없음. |
| IV. Quality gates | PASS — `npm run lint`, `npm run type-check`, `npm test` + graphify 재빌드(production 코드 변경이므로 적용). |
| V. Observability | PASS — 기존 로그 지점의 메시지 분기 + `reason` 필드만 추가. 새 telemetry stack 없음. 자격 증명 값 미노출(FR-005). |

**Re-check after implementation**: 관계 추출 관련 기존 테스트 green; `relation-extractor.ts` 에 동기 가용성 판정 잔존 0; 새 환경 변수 0.

## Architecture

```text
remember  →  launchBackgroundAugmentation()        # fire-and-forget (응답 지연 없음)
                └─ runRelationExtraction
                     new RelationExtractor()        # 요청별 생성 (유지)
extract_relations tool → new RelationExtractor()    # 동기 await (유일한 대기 부담 경로)

RelationExtractor.extractRelations
  ├─ method === 'rule'   → ruleExtractor                       # 변경 없음
  ├─ method === 'llm'    → await llm.isAvailableAsync()  ①     # :100
  │                          false → 명확한 오류
  └─ hybrid
       ruleExtractor
       hasHighConfidenceResults → 반환                          # 대기 없음 (FR-007)
       부족 → await llm.isAvailableAsync()  ①                   # :137
                false → 규칙 기반 반환 + 사유 구분 로그 ⑤
                true  → llm.extractRelations → merge

LLMBasedRelationExtractor
  ├─ isAvailableAsync()  ①  await initializationPromise → this.isAvailable()
  ├─ isAvailable()       ④  동기. "초기화 완료 이후에만 유효" JSDoc. prototype spy seam 유지
  ├─ extractRelations    ②  await 를 throw 앞으로
  └─ isOllamaAvailable() ③  preferredProvider === 'ollama' (설정값 조건 제거)
                              └─ hasAvailableClient(:374) 와 determineProvider(:423) 가 함께 해결
```

## Module boundaries

| Module | Change | FR |
|--------|--------|-----|
| `domains/relation/services/llm-based-relation-extractor.ts` | ① `public async isAvailableAsync()` 추가 (await 후 `this.isAvailable()` 위임) | FR-001, FR-009 |
| " | ② `extractRelations` 가드 순서 교정 (await → 가용성 판정) | FR-003 |
| " | ③ `isOllamaAvailable()` 에서 `mementoConfig.llmProvider === 'ollama'` 제거 | FR-010 |
| " | ④ `isAvailable()` JSDoc: 초기화 완료 이후에만 유효 | FR-009 |
| `domains/relation/services/relation-extractor.ts` | ⑤ `:100`·`:137` 을 비동기 판정으로 전환 + 폴백 로그 사유 분기(`reason` 필드) | FR-002, FR-004, FR-005 |

**위임(①)이 핵심 제약**: `extract-relations-tool.spec.ts:81`, `mcp-relation-tools.spec.ts:93`, `relation-extractor.spec.ts:106` 이 `LLMBasedRelationExtractor.prototype.isAvailable` 을 spy 해 LLM 호출을 차단한다. 비동기 판정이 동기 판정에 위임해야 그 차단이 유지된다.

## Project Structure

### Documentation (this feature)

```text
specs/656-819-fix-llm-init-race/
├── spec.md
├── plan.md              # 이 파일
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── availability-contract.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/memento-core/src/domains/relation/
├── services/
│   ├── llm-based-relation-extractor.ts          # ①②③④
│   ├── relation-extractor.ts                    # ⑤
│   └── __tests__/
│       ├── llm-based-relation-extractor.spec.ts # ①②③ 테스트
│       └── relation-extractor.spec.ts           # ⑤ 테스트 + 주입 더블 갱신
└── tools/__tests__/extract-relations-tool.spec.ts   # 회귀 확인

packages/memento-server/src/test/integration/
└── mcp-relation-tools.spec.ts                   # 회귀 확인
```

**Structure Decision**: 기존 `packages/memento-core` 도메인 레이아웃을 그대로 쓴다. 새 디렉터리·모듈 없음.

## Implementation Strategy

| Phase | 내용 | 게이트 |
|-------|------|--------|
| R1 (Red) | `llm-based-relation-extractor.spec.ts` 에 ①②③ 실패 테스트 추가 | 실패 확인 |
| G1 (Green) | ①②③④ 구현 | 해당 spec green |
| R2 (Red) | `relation-extractor.spec.ts` 에 ⑤ 실패 테스트 추가(초기화 미완 인스턴스가 LLM 을 시도하는지, 사유별 로그) + 주입 더블에 비동기 판정 추가 | 실패 확인 |
| G2 (Green) | ⑤ 구현 | 해당 spec green |
| V (Verify) | `extract-relations-tool.spec.ts` · `mcp-relation-tools.spec.ts` 회귀, 이어서 `npm run lint && npm run type-check && npm test`, graphify 재빌드 | 전 게이트 통과 |

## Complexity Tracking

헌법 위반 없음. 채울 항목 없음.
