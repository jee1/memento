# 에이전트 워크플로

[DEVELOPMENT_RULES.md §4](../../DEVELOPMENT_RULES.md#4-ai-에이전트-전용-지침-specialized-agent-rules)와 함께 적용합니다.

## MCP·메모리

- **작업 전**: `recall` 또는 `memory_injection`
- **작업 후**: `remember` (타입: working/episodic/semantic/procedural 구분)

## 코드 탐색 (Serena)

- 파일 전체 읽기 전 `get_symbols_overview`·`find_symbol` 우선
- 50줄 미만 파일만 전체 읽기

## graphify

- **분석 전**: `graphify-out/GRAPH_REPORT.md` 확인; `graphify-out/wiki/index.md` 있으면 위키 우선
- **코드 수정 후** 재빌드:

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

- **커밋 범위**: 저장소 루트 `graphify-out/`만 PR에 포함 (`packages/memento-core/graphify-out/cache/` 제외)

## 기술 부채·아키텍처 검사

- **정량 스캔**: `python3 ~/.agents/skills/tech-debt-analyzer/scripts/detect_code_smells.py packages scripts static tests --output markdown`
- **actionable 마커**: `npm run check-debt-markers -- --production-only` (memento-core 프로덕션)
- **아키텍처**: graphify → `$analyze`(read-only) → 리팩터 전 `gstack-plan-eng-review`
- **formal 감사(선택)**: `helderberto/skills@architecture-audit` 또는 `nkootstra/skills@code-complexity-audit` (`npx skills add …`)
- **추적 이슈**: #593 · deprecated inventory: [core-deprecated-inventory.md](../architecture/core-deprecated-inventory.md)

## 대시보드 UI

- `static/css/tokens.css` 디자인 토큰 우선 ([DESIGN.md](../DESIGN.md))
- 리터럴 색·간격 값 지양

## Spec Kit · 이슈 격리 워크트리

- **초기화됨**: `.specify/`, `specs/NNN-short-name/` (spec · plan · tasks)
- **브랜치 생성**: `.specify/scripts/bash/create-new-feature.sh '설명' --short-name 'short-name'` (NNN 자동 부여)
- **격리 작업**: `git worktree add -b NNN-name ../memento-issue-NNN main` → worktree에서 `npm install` → spec/plan/tasks → 구현 → PR (`Closes #이슈`)
- **정리 순서**: `git worktree remove <worktree-path>` → `git branch -d NNN-name` → `git pull origin main` → `git fetch --prune origin`
- **god node 분해** (#593 계열): public import·export 유지, 내부 composition sub-module(단일 파일 ≤500줄); 선행 spec green — monitoring: `performance-monitor.spec.ts`; relation: `relation-graph.spec.ts` + `relation-graph.integration.spec.ts`; memory: `semantic-memory-update-service.spec.ts`; search: `vector-search.repository.spec.ts` + `search-engine.spec.ts` + `search-engine-reflection-notes.spec.ts` + `006-fts5-reflection-notes.spec.ts`; agent-integration DB: `sqlite-agent-integration-repository.spec.ts` + `domains/agent-integration/`; 참조 오케스트레이터 (`performance-monitor.ts`, `relation-graph.ts`, `semantic-memory-update-service.ts`, `vector-search.repository.ts`, `search-engine.ts`, `sqlite-agent-integration-repository.ts`); search sub-dir `vector-search/`·`search-engine/`; infrastructure repo는 `*-store.ts`·`*-row-utils.ts`·`*-cursor-utils.ts`로 분해 (#610)

## PR·지식 복리

- 재현 어려운 버그·운영 함정 해결 후 PR 준비 시 `/ce-compound` 제안 (검증 완료 후)
- 해결 사례 경로: `docs/_work/solutions/` ([docs/README.md](../README.md))
- PR 템플릿 「지식 복리」: [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md)
- 기여 절차: [CONTRIBUTING.md](../../CONTRIBUTING.md)
