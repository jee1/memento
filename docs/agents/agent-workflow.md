# 에이전트 워크플로

[DEVELOPMENT_RULES.md §4](../../DEVELOPMENT_RULES.md#4-ai-에이전트-전용-지침-specialized-agent-rules)와 함께 적용합니다.

## MCP·메모리 — 작업 전후 기억 루프

Memento를 사용하는 에이전트는 아래 순서가 습관이 되어야 합니다(Issue #729 — feedback은 인프라가 있어도 안 쓰면 랭킹에 반영되지 않습니다).

1. **작업 전**: `recall` 또는 `memory_injection`으로 관련 기억을 불러와 맥락을 채운다.
2. **recall 결과를 실제로 썼다면**: 그 자리에서 `feedback` MCP 도구(helpful/not_helpful)를 호출한다. 예: `client.recordRecallFeedback(recallResult, memoryId, true)` — 랭킹 공식의 `ζ_fb·(feedback_norm − 0.5)` 항은 이 신호로만 갱신됩니다([search-ranking.md](./search-ranking.md)).
3. **작업 후**: `remember`로 결과를 남기되 기억 타입을 구분한다. 48시간 안에 다시 쓸 컨텍스트는 `working`, 에피소드·사건 기록은 `episodic`, 재사용 가능한 지식은 `semantic`, 반복 절차는 `procedural`입니다. 이 구분이 나중에 검색 품질을 결정합니다.

**관측**: `feedback` 채택률(1단계 대비 2단계 실행 비율)은 `get_telemetry_summary`의 `feedback_quality.recall_without_feedback_rate`, HTTP `GET /admin/telemetry/feedback`, 또는 `npm run telemetry -- --type feedback-quality`로 확인합니다. 1에 가까울수록 recall만 하고 feedback을 남기지 않는 비율이 높다는 뜻입니다.

### 진단 프로브 (#811)

- 진단·탐색용 `recall`은 **`auto_set_anchor: false`** 로 호출한다. 기본값(`true`)은 앵커 슬롯과 `meta_stats`(recall_count 등)를 갱신해 통계를 오염시킨다.
- **`feedback` 없이 `memory_injection`만 반복**하면 high_failure / 저신뢰 지표가 부풀 수 있다. 주입 결과를 실제로 썼다면 `feedback`을 남긴다. (훅·코드로 feedback을 강제하지 않음 — 운영 습관)

### Anchor Map 실측·회귀 (#877)

`recall` 기본값이 슬롯을 돌리므로, before/after·슬롯별 비교·Playwright 실측은 **먼저 `set_anchor`로 A/B/C를 고정**하고 측정 구간에서는 `auto_set_anchor: false`(또는 recall 자체를 쓰지 않음). 회전 중인 앵커로 잰 절대 건수는 재현되지 않는다.

recall·feedback만으로는 이미 쌓인 저품질 기억(저신뢰·고실패)까지 정리되지 않습니다 — 아래 heal 단계가 그 갭을 메웁니다.

| 단계 | 도구 | 종류 |
|------|------|------|
| 조회 | `recall`(`introspection_hint`) / `get_introspection_summary` | MCP |
| 피드백 | `feedback` | MCP |
| 치유 | `POST /admin/introspection/heal` | HTTP(admin 전용, MCP 미노출) |

### remember near-duplicate (write-path, #730)

`remember`는 저장 **직전**에 동일 `type`·`owner_id`·`project_id` 스코프에서 유사 기억을 검색합니다. 기본(`MEMENTO_REMEMBER_DEDUP_MODE=warn`)은 저장은 성공하고 응답에 `similarity_warning`을 붙입니다.

**권장 루프:** 유사 후보가 있으면(`similarity_warning.action='warned'`) 같은 content로 `update_mode=incremental`을 넣어 **재호출**해 top 후보를 UPDATE(새 row 없음, `action='merged'`)하세요. `strict` 모드는 INSERT를 거절하고 후보만 반환합니다(`action='rejected'`).

응답 필드(하위 호환 additive):

| 필드 | 설명 |
|------|------|
| `similarity_warning.count` | 임계값 이상 후보 수 |
| `similarity_warning.similar_ids` | 후보 memory_id 목록 |
| `similarity_warning.candidates` | `{ id, similarity }[]` |
| `similarity_warning.suggestion` | `'incremental'` — 병합 재호출 권장 |
| `similarity_warning.action` | `warned` \| `merged` \| `rejected` |

env: [commands.md — remember dedup](./commands.md#remember-near-duplicate-730)

### Introspection 치유 — recall·feedback으로 못 거르는 저품질 기억 (#728)

저신뢰·고실패 기억은 `recall` 응답의 `introspection_hint`나 `get_introspection_summary`(MCP)로 알 수 있지만, 정리는 자동이 아닙니다. 운영자가 **주기적으로** `POST /admin/introspection/heal`을 호출해(기본 dry-run으로 분류 결과를 먼저 검토한 뒤 `dry_run: false`로 apply) 스캔 결과를 re-embed·demote·soft-delete·review 4가지 액션으로 분류·실행합니다. **에이전트는 이 엔드포인트를 스스로 호출하지 않습니다** — 대량 삭제·importance 변경을 막기 위해 MCP 도구로는 등록되어 있지 않고 HTTP admin API로만 노출됩니다.

절차·env 플래그·curl 예시: [commands.md — Introspection 치유](./commands.md#introspection-치유-728)

## 코드 탐색 — Serena 심볼 우선

코드를 읽기 전에 파일 전체를 무작정 읽지 마세요. `get_symbols_overview`나 `find_symbol`로 원하는 심볼을 찾은 뒤 필요한 부분만 확인하는 것이 훨씬 빠릅니다. 파일이 50줄 미만이면 전체를 읽어도 괜찮지만, 그 이상이면 심볼 도구를 먼저 쓰는 것을 규칙으로 삼으세요.

## graphify — 코드 지도를 먼저 보기

`graphify-out/`은 Git에 커밋하지 않는 로컬 생성물입니다. 코드를 분석하거나 리팩터를 시작할 때 리포트가 없거나 오래됐다면 먼저 재빌드한 뒤 `graphify-out/GRAPH_REPORT.md`를 확인하세요. `graphify-out/wiki/index.md`가 있다면 위키를 우선 참고하세요. 코드를 수정한 뒤에도 반드시 다시 빌드해야 리포트가 최신 상태를 반영합니다.

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

graphify 아티팩트는 모두 로컬에서 재생성하며 PR에 포함하지 않습니다.

## 기술 부채·아키텍처 검사

코드 냄새를 정량적으로 파악하고 싶다면 `python3 ~/.agents/skills/tech-debt-analyzer/scripts/detect_code_smells.py packages scripts static tests --output markdown`으로 스캔합니다. 실제로 프로덕션에서 처리해야 할 마커는 `npm run check-debt-markers -- --production-only`로 확인하세요. tech-debt-analyzer가 `debug` 같은 키워드를 false positive로 잡는 경향이 있어 두 가지를 함께 보는 것이 좋습니다. 아키텍처 레벨의 변경은 graphify로 현황을 파악한 뒤 `$analyze`(read-only) 단계를 거쳐 리팩터 계획을 세우고, 필요하면 `gstack-plan-eng-review`로 검토를 요청하세요. 기술 부채 추적 이슈는 #593이고, deprecated API 목록은 [core-deprecated-inventory.md](../architecture/core-deprecated-inventory.md)에 있습니다.

## 대시보드 UI

UI를 손볼 때는 `static/css/tokens.css`에 정의된 디자인 토큰부터 확인하세요([DESIGN.md](../DESIGN.md) 참조). 색이나 간격 값을 리터럴로 박으면 테마 일관성이 깨집니다.

## Spec Kit · 이슈 격리 워크트리

저장소에는 Spec Kit가 초기화되어 있어 `.specify/`와 `specs/NNN-short-name/`(spec·plan·tasks) 구조를 씁니다. 새 기능이나 이슈 작업을 시작할 때는 `.specify/scripts/bash/create-new-feature.sh '설명' --short-name 'short-name'`으로 브랜치와 spec 디렉터리를 한 번에 만드세요. NNN은 자동으로 부여됩니다.

이슈를 격리해서 작업하려면 `git worktree add -b NNN-name ../memento-issue-NNN main`으로 워크트리를 만든 뒤, 그 경로에서 `npm install`을 실행해 의존성을 맞춥니다. 작업 흐름은 spec → plan → tasks → 구현 → PR(`Closes #이슈`) 순입니다. 작업이 끝나면 `git worktree remove <worktree-path>`로 먼저 연결을 끊고, 그 다음에 브랜치를 삭제해야 합니다. 순서가 바뀌면 로컬 브랜치 삭제에 실패합니다.

대형 리팩터(god node 분해 #593 계열)는 public import·export를 그대로 두고 내부를 composition sub-module(단일 파일 ≤500줄)로 나눕니다. 선행 spec이 green인지 확인하고 시작하세요.

## PR·지식 복리

커밋할 때 `.cursor/hooks.json`에 설정된 `revise-claude-md` 훅이 `AGENTS.md`·`CLAUDE.md`를 자동으로 갱신·스테이징합니다. 이 훅을 건너뛰고 싶으면 `REVISE_CLAUDE_MD_SKIP=1` 환경변수를 설정하세요. 이후 전역 훅으로 `npm run lint` / `test` / `build`와 staged diff 리뷰가 이어집니다.

재현이 어려운 버그나 운영 함정을 해결한 뒤 PR을 준비할 때는 `/ce-compound`를 제안받을 수 있습니다(검증 완료 후). 생성된 초안을 그대로 쌓지 말고 재사용 가능한 절차는 기존 공식 가이드에, 장기 설계 결정은 ADR에 반영한 뒤 PR 템플릿의 「지식 복리」 섹션을 채우세요.

관련 문서: [docs/README.md](../README.md) · [CONTRIBUTING.md](../../CONTRIBUTING.md) · [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md)
