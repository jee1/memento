Added
- `LLM_PROVIDER=anthropic` 으로 대체 후보 판정과 절차 추출을 Claude(기본 `claude-haiku-5-5`, `ANTHROPIC_API_KEY`)로 한다. 다른 제공자로 넘어가지 않고, 키가 없거나 실패하면 판정은 다음 스캔, 절차 추출은 규칙 추출로 간다. 대체 후보 스캔 한 번의 쌍 상한은 설정 `SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS`(기본 20, 전에는 5 고정)가 정한다. 본문과 범위가 같은 쌍은 제공자가 바뀌어도 다시 판정하지 않는다 (#1840)
