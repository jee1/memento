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

## 대시보드 UI

- `static/css/tokens.css` 디자인 토큰 우선 ([DESIGN.md](../DESIGN.md))
- 리터럴 색·간격 값 지양

## PR·지식 복리

- 재현 어려운 버그·운영 함정 해결 후 PR 준비 시 `/ce-compound` 제안 (검증 완료 후)
- 해결 사례 경로: `docs/_work/solutions/` ([docs/README.md](../README.md))
- PR 템플릿 「지식 복리」: [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md)
- 기여 절차: [CONTRIBUTING.md](../../CONTRIBUTING.md)
