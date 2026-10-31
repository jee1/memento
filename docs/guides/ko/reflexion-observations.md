# Reflexion 관찰과 미검증 후보 (#1547)

[실패 관찰과 미검증 절차 후보](../../../GLOSSARY.md)는 실행 성공이나 채택한 절차를 뜻하지 않는다. `REFLEXION_OBSERVATION_ONLY=true`로 분리 경로를 선택한다. 기본값은 `false`이며 기존 운영 설정은 바뀌지 않는다.

## 저장과 보존

분리 경로의 Recorder는 작업 목표 유무와 무관하게 실패 관찰을 새 episodic으로 저장한다. 규칙 기반 추출 결과에 workflow 또는 skill이 있으면 미검증 후보도 별도 episodic으로 남긴다. `convert`와 직접 `updateProceduralMemory` 모두 기존 절차를 교체·병합하거나 새 절차 버전을 만들지 않는다. 후보에 붙은 steps는 검증되지 않은 제안이다.

두 기록 모두 private이며 `source=reflexion`, `origin_source.reflexion.state`에 각각 `failure_observation`, `unverified_candidate`를 남긴다. 같은 메타데이터에 원본 `event_id`, 호출 범위, environment와 tool_version을 보존한다. owner/project/process/session은 서버 이벤트의 scope를 쓰며 MCP 도구 실패는 토큰 바인딩을 우선한다. 실패한 요청의 owner/project 입력값으로 호출 범위를 덮어쓰지 않는다. 환경·도구 버전을 제공하지 않은 이벤트는 해당 값을 null로 남긴다. 본문에서 범위를 추정하지 않는다.

기록은 append-only다. 중복 키는 도구·오류 유형·전체 오류 문구·owner/project/process/session·환경·도구 버전·작업 목표로 구성한다. 오류 문구는 앞뒤 공백 제거, 소문자 변환, 연속 공백 축약으로 정규화한다. 이벤트 ID가 달라도 같은 키의 실패는 Recorder의 중복 시간 창에서 한 번만 기록하며, 첫 이벤트의 ID를 출처에 남긴다. 다른 범위·환경·목표·오류는 별도 기록한다.

같은 키·시간 창에서는 동시 요청과 재시도를 합쳐 고정 행을 최대 2개(실패 관찰 1개·미검증 후보 최대 1개), 임베딩 시도를 최대 1회 남긴다. 저장 전에 중복 키를 예약하고 관찰 INSERT 자체가 실패하면 예약을 해제한다. 관찰 저장 뒤 변환·임베딩이 실패하면 중복 키를 유지하므로 재시도로 고정 행을 늘리지 않는다. 시간 창은 첫 시도에서 시작하며 중복 요청으로 연장하지 않는다. 이 상한은 Recorder 인스턴스의 `record` 경로에만 적용된다. 직접 `convert`·`updateProceduralMemory` 호출은 별도로 후보를 추가한다.

중복 키는 메모리에만 남는다. 시간 창 만료·Recorder 재생성·서버 재시작 뒤에는 같은 오류도 다시 기록한다. 서로 다른 키와 여러 시간 창을 합친 전체 누적 상한은 없으며 영속적인 재시도 멱등성을 보장하지 않는다.

자동 Sleep consolidation과 망각으로 원본이 약해지지 않도록 두 기록을 pin한다. pin은 채택 표시가 아니다. 플래그를 다시 꺼도 저장한 episodic과 pin은 유지한다. 보존 비용이 계속 누적되므로 운영자가 검토한 뒤 명시적으로 unpin·삭제해야 한다.

## 조회와 호환

일반 절차 검색은 `recall`의 기존 `type: "procedural"` 필터를 쓴다. 새 관찰·후보는 episodic이므로 텍스트·벡터 레인에서 절차 검색 대상이 되지 않는다. 회고를 조회할 때는 아래처럼 episodic을 요청한다. 넓은 타입 검색에서는 본문의 미검증 표시와 `origin_source.reflexion.state`를 함께 확인한다.

```json
{
  "query": "실패 당시 작업 목표",
  "type": "episodic",
  "has_reflection_notes": true,
  "auto_set_anchor": false
}
```

owner/project 필터와 토큰 바인딩은 기존 recall 계약을 따른다. 이전 procedural 회고는 `type: "procedural", has_reflection_notes: true`로 계속 조회한다. 기존 행을 수정하거나 verified로 일괄 승격하지 않는다. 신규 state가 없는 이전 행은 검증 여부 미상이다. 플래그 off의 기존 저장·추출 동작도 유지한다.

새 관찰·후보는 기본 메타데이터 응답에 reflection_notes와 추출한 steps를 포함한다. `steps_only`를 요청해도 미검증 표시·본문·출처를 유지하며 procedural 버전으로 표시하지 않는다. `include_metadata: false`이면 미검증 본문만 남고 해당 메타데이터는 생략한다.

## 검증·채택의 경계

이 단계는 서버의 실패 관찰·후보 저장만 다룬다. 에이전트 도구 루프를 실행하지 않고 후보를 자동 적용하지 않는다. 분리 경로는 기존 `PROCEDURAL_EXTRACTION_STRATEGY=llm_first` 설정과 무관하게 규칙으로 제안만 추출하며 새로운 LLM 호출·provider fallback·일일 cap을 추가하지 않는다.

채택·회귀 판정은 [adoption-ko-panel-v1 계약](../../../tests/fixtures/search-quality/adoption-ko-panel-v1/README.md)을 따른다. 해당 판본의 execution evidence는 0건이므로 실행 성공률과 후보의 효과는 미측정이다. 이 변경의 회귀 테스트는 실패만으로 새 procedural을 만들지 않음, 기존 절차·회고 보존, scope 간 결합 없음, 검색 타입 분리를 검증한다. 실행·검증 결과를 받은 뒤 채택하는 경로와 회귀 게이트는 후속 #1550에서 다룬다.
