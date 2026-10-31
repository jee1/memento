# Memento

AI 에이전트의 기억을 저장하고, 검색하고, 잊는 MCP 서버의 도메인 용어입니다. 구현 세부(TTL 값, 컬럼, 가중치)는 여기에 두지 않고 링크한 문서에 둡니다.

## 기억

**Memory**:
에이전트가 `remember`로 남기고 `recall`로 되찾는 한 단위의 기록.
_Avoid_: note, record, entry

**Working memory**:
지금 하는 작업의 맥락을 담는 단기 기억. 세션이 끝나면 episodic으로 옮겨 간다.
_Avoid_: scratch, temp memory

**Episodic memory**:
언제 무슨 일이 있었는지를 담는 사건 기록. Triple 추출과 Sleep consolidation의 원천이다.
_Avoid_: log, history

**Semantic memory**:
시점과 무관하게 참인 지식이나 사실.
_Avoid_: fact memory, knowledge entry

**Procedural memory**:
버전을 쌓아 가며 관리하는 작업 절차.
_Avoid_: recipe, playbook

**Failure observation (실패 관찰)**:
실패 이벤트와 당시 작업·적용 범위를 남긴 사건 기록. 개선 제안이나 실행 성공의 증거와 구분한다.

**Unverified procedural candidate (미검증 절차 후보)**:
실패 관찰에서 추출한 개선 제안. 실행·검증 결과를 받기 전에는 채택한 절차로 취급하지 않는다. 저장·조회는 [Reflexion 관찰 가이드](./docs/guides/ko/reflexion-observations.md)를 따른다.

**Sleep consolidation**:
episodic 기억을 모아 semantic 기억으로 증류하는 주기 배치. v2.0.0에서 제거한 랭킹의 consolidation 블렌드([search-ranking.md](./docs/agents/search-ranking.md))와는 다른 개념이다.
_Avoid_: consolidation(단독), consolidation score

**Triple**:
기억에서 뽑은 Subject, Predicate, Object 묶음. 지식 그래프와 관계 추출의 단위다.
_Avoid_: fact triple, edge

**Relation**:
두 기억을 방향을 갖고 잇는 연결. 표준 어휘는 [relation-type-vocabulary.md](./docs/reference/ko/relation-type-vocabulary.md)가 정한다.
_Avoid_: link, edge

**Introspection**:
신뢰도가 낮거나 자주 실패하는 기억을 찾아내고 정리(heal)하는 운영 절차.
_Avoid_: cleanup, audit

**Supersede candidate**:
같은 owner, project, privacy scope, type, 임베딩 모델 안에서 새 기억이 옛 기억을 대체하는지 LLM 이 분류해 `memory_supersede_candidate`에 남긴 판정 기록. 상태는 `confirmed`(확정 대체), `pending`(확인 대기), `compatible`(양립)이며 사람이 검토할 업무 상태일 뿐 안전 보장이 아니다. 판정이 나와도 기억은 비활성화하거나 바꾸지 않는다.
_Avoid_: retirement, auto-supersede

## 검색

**Hybrid search**:
FTS5 텍스트 검색과 벡터 검색을 함께 돌려 점수를 합치는 기본 검색 방식.
_Avoid_: combined search

**Anchor**:
`search_local`이 탐색 기준점으로 삼는 A, B, C 슬롯.
_Avoid_: pin, bookmark

## 지침 주입

**Case**:
`case` 태그를 단 기억. UserPromptSubmit 때 recall해 에이전트 컨텍스트에 붙이는 행동 지침 후보다.
_Avoid_: rule, lesson

**Pinned directives**:
매 주입 맨 앞에 붙이는 고정 지침 파일의 내용(1KB 이하). recall 결과와 무관하다.
_Avoid_: system prompt, static rules

**Directive injection log**:
주입 한 번마다 jsonl 한 줄을 남기는 append-only 로그. 세션 안 중복 제거는 이 로그를 접어 계산하며 다른 상태는 없다.
_Avoid_: dedup cache, injection state

**Shadow mode**:
주입 결과를 로그에만 남기고 에이전트에는 주지 않는 모드. `live`로 올리기 전 검증용이다.
_Avoid_: dry run, silent mode

**inj_id**:
주입 한 번을 가리키는 `<session 앞 8자>-<epoch ms>-<프롬프트 sha1 앞 6자>`. 컨텍스트 첫 줄 `[inj:<id>]`와 로그 줄이 같은 값을 가진다. 로그에서 주입 줄은 `inj_id` 가 있는 줄이고 reset 줄은 `reset` 이 있는 줄이다.
_Avoid_: injection id, trace id

## 격리와 도구

**Owner**:
기억을 에이전트나 테넌트 단위로 나누는 격리 경계. `owner_id`로 표현한다.
_Avoid_: user, tenant(단독)

**CORE toolset**:
`tools/list`에 기본으로 노출하는 도구 묶음(`recall`, `remember`, `memory_injection`, `feedback`).
_Avoid_: default tools, basic tools
