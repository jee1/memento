# Quickstart: 수정 검증

**Feature**: 656-819-fix-llm-init-race | **Date**: 2026-08-25

## 1. 결함 재현 (수정 전)

LLM 프로바이더를 정상 설정하고 서버를 새로 띄운 뒤 기억을 저장한다.

```bash
# 예: 클라우드 프로바이더
export OPENAI_API_KEY=sk-...
npm run dev
```

저장 후 로그 확인:

```text
LLM 서비스가 사용 불가능하여 규칙 기반 결과 반환   ← 매 저장마다. 이것이 #819 증상
```

LLM 프로바이더 쪽 네트워크 호출은 0회다.

## 2. 수정 후 기대 동작

같은 조건에서 저장하면:

- 위 로그가 **더 이상 나오지 않는다**(SC-002).
- 규칙 기반 신뢰도가 낮은 경우 `규칙 기반 결과 부족, LLM fallback 시도` → `LLM fallback 완료` 로 이어진다.
- 저장된 관계에 `method: 'llm'` 항목이 나타난다.

## 3. 자동 선택 + 로컬 프로바이더 환경 (FR-010)

```bash
unset OPENAI_API_KEY GEMINI_API_KEY
unset LLM_PROVIDER            # 자동 선택
# 로컬 프로바이더 기동 상태
```

기대: 로컬 프로바이더로 LLM 추출이 수행된다. `OPENAI_API_KEY 또는 GEMINI_API_KEY를 설정하거나...` 오류 로그가 남지 않는다.

## 4. 미설정 환경 회귀 (SC-003)

```bash
unset OPENAI_API_KEY GEMINI_API_KEY
# 로컬 프로바이더도 없음
```

기대: 저장은 100% 성공하고, 규칙 기반 관계 결과가 변경 전과 같으며, 폴백 로그가 **사유를 구분해** 남는다.

## 5. 테스트

```bash
# 대상 스펙
npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
npm test -- packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts

# 회귀
npm test -- packages/memento-core/src/domains/relation/tools/__tests__/extract-relations-tool.spec.ts
npm test -- packages/memento-server/src/test/integration/mcp-relation-tools.spec.ts

# 헌법 IV 게이트
npm run lint && npm run type-check && npm test
```

production 코드를 건드리므로 완료 전 graphify 재빌드 후 `graphify-out/GRAPH_REPORT.md` 를 확인한다(헌법 IV). `graphify-out/` 는 커밋하지 않는다.
