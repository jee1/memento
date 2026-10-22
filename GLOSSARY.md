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

## 검색

**Hybrid search**:
FTS5 텍스트 검색과 벡터 검색을 함께 돌려 점수를 합치는 기본 검색 방식.
_Avoid_: combined search

**Anchor**:
`search_local`이 탐색 기준점으로 삼는 A, B, C 슬롯.
_Avoid_: pin, bookmark

## 격리와 도구

**Owner**:
기억을 에이전트나 테넌트 단위로 나누는 격리 경계. `owner_id`로 표현한다.
_Avoid_: user, tenant(단독)

**CORE toolset**:
`tools/list`에 기본으로 노출하는 도구 묶음(`recall`, `remember`, `memory_injection`, `feedback`).
_Avoid_: default tools, basic tools
