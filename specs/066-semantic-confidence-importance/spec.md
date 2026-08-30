# Feature Specification: semantic confidence 영속화 및 importance 게이트

**Feature Branch**: `jee1/fix-semantic-confidence-importance-triple`
**Created**: 2026-08-25
**Status**: Ready for Planning
**Issue**: [#805](https://github.com/jee1/memento/issues/805)
**Parent Epic**: [#803](https://github.com/jee1/memento/issues/803)
**Related**: [#804](https://github.com/jee1/memento/issues/804) (기존 오염 격리)
**Input**: User description: "https://github.com/jee1/memento/issues/805"

## Problem Statement

자동 추출된 semantic triple은 canonicalization과 entity linking 결과로 0~1 confidence를
계산하지만, semantic memory 자체에는 그 값을 저장하지 않는다. 현재 운영 데이터 약 29,000행의
confidence가 모두 비어 있어 품질을 사후 분석하거나 보정할 근거도 없다.

importance는 confidence와 무관하게 원본 episodic importance를 그대로 상속하며, 같은 triple이
반복되면 추가 가산된다. 그 결과 canonicalization에 실패한 파편도 원본 importance가 높으면
검색 상단을 차지한다. 관측 사례에서는 관련성 점수가 낮은 결과 총점의 72%가 importance에서
나왔다. #804가 기존 오염을 격리하더라도 신규 triple 생성 경로를 고치지 않으면 같은 오염이
다시 유입된다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 품질에 맞는 semantic memory 생성 (Priority: P1)

메모리 사용자는 자동 생성된 semantic memory의 confidence와 importance가 실제 triple 품질을
반영하기를 원한다. 품질 신호가 낮은 파편은 높은 원본 importance를 그대로 상속하지 않아야 한다.

**Why this priority**: 신규 재오염을 직접 차단하고 검색 결과의 신뢰도를 회복하는 핵심 동작이다.

**Independent Test**: 같은 원본 importance에서 정상 triple과 canonicalization 실패 triple을
각각 처리해, 저장된 confidence가 비어 있지 않고 저품질 triple의 importance가 더 낮은지 확인한다.

**Acceptance Scenarios**:

1. **Given** 모든 품질 검사를 통과해 저장 게이트를 넘은 triple, **When** semantic memory가
   생성되면, **Then** 계산된 confidence가 0~1 범위의 값으로 저장된다.
2. **Given** 동일한 양의 원본 importance를 가진 정상 triple과 canonicalization 실패 triple,
   **When** 둘 다 명시적 설정으로 저장을 허용하면, **Then** 실패 triple의 confidence와
   importance가 정상 triple보다 낮다.
3. **Given** confidence가 1보다 작고 원본 episodic importance가 양수인 triple, **When** semantic
   importance를 정하면, **Then** boost 전 importance는 원본 episodic importance와 aggregate
   confidence의 곱이며 원본 importance보다 낮다.
4. **Given** 원본 episodic importance가 명시적으로 0인 triple, **When** semantic importance를
   정하면, **Then** 기본값으로 대체하거나 반복 boost로 되살리지 않고 최종 importance를 0으로
   유지한다.

---

### User Story 2 - 중복 병합에서도 품질 할인 유지 (Priority: P2)

메모리 운영자는 같은 사실이 다시 관측되거나 유사한 semantic memory에 병합되더라도 최신 품질
신호가 남고, 반복 횟수 가산이 저품질 triple의 importance 할인을 지우지 않기를 원한다.

**Why this priority**: 신규 생성만 고치면 정확한 triple 중복과 유사 중복 경로에서 같은 오염이
계속 발생한다.

**Independent Test**: 신규 생성, 정확한 triple 중복, 유사 중복의 세 경로에 같은 입력을 보내
모두 confidence가 갱신되고 동일한 importance 품질 불변식을 만족하는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 기존 semantic memory와 정확히 같은 triple이 다시 관측됨, **When** 기존 항목을
   갱신하면, **Then** 기존 aggregate confidence와 새 confidence를 수락된 증거 수로 가중한
   평균이 저장된다.
2. **Given** 기존 semantic memory와 유사한 triple이 병합됨, **When** 기존 항목을 갱신하면,
   **Then** 같은 가중 평균 confidence와 quality-adjusted importance가 함께 갱신된다.
3. **Given** 갱신 후 aggregate confidence가 1보다 작고 최신 episodic importance가 양수인
   semantic memory, **When** 새 증거가 병합되면, **Then** 반복 증거 boost를 적용하지 않고 최종
   importance를 원본 episodic importance보다 낮게 유지한다.
4. **Given** 갱신 후 aggregate confidence가 정확히 1이고 boost 전 importance가 양수인 semantic
   memory, **When** 새 증거가 병합되면, **Then** 반복 증거 boost를 적용할 수 있다.
5. **Given** 수락된 증거가 기존 semantic memory에 병합됨, **When** 갱신이 완료되면,
   **Then** `num_times`는 정확히 1 증가하고 검색이 발생하지 않았으므로 `recall_count`는
   변경되지 않는다.
6. **Given** 기존 증거와 새 증거의 episodic importance가 다름, **When** 새 증거를 병합하면,
   **Then** 가장 최근에 수락된 episodic importance를 원본값으로 사용한다.
7. **Given** 관계 방향 검증을 통과한 뒤 semantic memory 갱신은 성공하고 출처 관계 생성은 운영상
   실패함, **When** 처리를 종료하면, **Then** 갱신된 confidence·importance·`num_times`는 유지하고
   관계 실패를 관측 가능하게 남긴다.
8. **Given** 서로 다른 원본·호출의 수락 증거가 같은 semantic memory에 동시에 병합됨, **When**
   모든 처리가 완료되면, **Then** 각 confidence가 aggregate 평균에 한 번씩 반영되고
   `num_times`가 독립 evidence occurrence 수만큼 증가한다.
9. **Given** semantic 품질 갱신 뒤 관계 방향·타입 검증 오류가 아닌 관계 또는 임베딩 운영 실패가
   발생함, **When** 자동 변환 결과를 기록하면, **Then** 원본 episodic memory를 성공 처리하고 전체
   semantic 갱신을 자동 재시도 대상으로 만들지 않는다.
10. **Given** 같은 triple이 서로 다른 owner 또는 project의 episodic memory에서 추출됨, **When**
    semantic 중복을 찾으면, **Then** 서로 병합하지 않고 각 scope에 별도 semantic memory를 둔다.
11. **Given** 같은 scope에 사용자가 직접 만든 구조화 semantic memory가 있음, **When** 자동 triple이
    같은 사실을 표현하면, **Then** 사용자 지정 confidence·importance를 덮어쓰지 않고 자동 추출
    전용 semantic memory를 별도로 처리한다.
12. **Given** `origin_source`가 비어 있는 legacy semantic memory, **When** 자동 병합 후보를
    판단하면, **Then** 기존 `extracted_from` 관계가 있는 경우에만 자동 생성 항목으로 인정한다.
13. **Given** exact KG 대표 또는 유사 후보가 soft-delete된 semantic memory임, **When** 자동
    triple을 처리하면, **Then** 삭제 항목을 갱신하거나 복구하지 않고 활성 후보 검색 또는 신규
    생성으로 계속한다.
14. **Given** legacy semantic 후보의 subject·predicate·object가 비어 있거나 KG 대표의 구조화 값과
    KG key가 다름, **When** 중복을 판단하면, **Then** 손상 후보를 건너뛰고 다른 활성 후보 검색
    또는 신규 생성으로 계속한다.
15. **Given** 같은 scope에 여러 자동 semantic 후보가 모두 유사도 조건을 만족함, **When** 병합
    대상을 선택하면, **Then** exact 구조 일치를 우선하고 동률이면 생성시각과 ID 순으로 하나를
    안정적으로 선택한다.
16. **Given** 한 episodic 처리 묶음의 중복 정규화 triple 또는 여러 triple이 같은 semantic
    memory로 귀결됨, **When** 수락 증거를 반영하면, **Then** 가장 높은 confidence의 대표 하나만
    반영해 `num_times`를 1 증가시키고 같은 semantic ID를 결과에 중복해 넣지 않는다.
17. **Given** 많은 수락 증거 중 하나 이상이 confidence 1 미만인 semantic memory, **When** 이후
    confidence 1인 증거가 매우 많이 병합되면, **Then** aggregate confidence는 표현 가능한 1 미만
    값을 유지하고 반복 boost 자격을 다시 얻지 않는다.
18. **Given** 신규 semantic memory의 기본 항목 저장 뒤 KG 연결 저장이 운영상 실패함, **When**
    해당 triple 처리를 종료하면, **Then** 기본 항목 저장도 되돌려 고아 semantic을 남기지 않고
    같은 묶음의 다음 유효 triple을 계속 처리한다.
19. **Given** exact 후보는 없지만 적격 유사 후보가 있고 필요한 embedding 비교를 완료할 수 없음,
    **When** 병합 대상을 결정하면, **Then** 판정 불가를 불일치로 간주해 새 semantic을 만들지 않고
    해당 triple만 운영 실패로 제외한다.
20. **Given** 다른 owner/project 또는 사용자 작성 semantic이 같은 predicate를 가짐, **When** 유사
    후보를 찾으면, **Then** 부적격 후보의 semantic 내용이나 embedding을 읽지 않고 현재 scope의
    적격 자동 후보만 비교한다.
21. **Given** 같은 SPO의 전역 KG 대표가 다른 scope·사용자 작성·삭제·손상 항목을 가리킴, **When**
    현재 scope에 적격 자동 semantic이 없어 새 항목을 만들면, **Then** 전역 KG 대표권 없이 scoped
    semantic을 정상 생성하고 이후 scoped 후보 검색으로 재사용한다.
22. **Given** 같은 scope의 동일 triple에 대한 첫 증거가 동시에 처리됨, **When** 두 호출 모두
    후보 없음에서 생성을 시도하면, **Then** 하나의 활성 자동 semantic으로 수렴하고 두 독립 증거를
    그 항목의 aggregate confidence와 `num_times`에 각각 한 번 반영한다.
23. **Given** 병합 후보 선택 뒤 갱신 전에 후보의 scope·활성 상태·provenance가 바뀜, **When**
    갱신을 시도하면, **Then** 바뀐 후보를 수정하지 않고 한 번 다시 대상을 판정하며 안전한 대상을
    확정하지 못하면 해당 triple을 제외한다.
24. **Given** legacy semantic의 non-NULL confidence가 유한한 0~1 값이 아님, **When** 자동 병합
    후보를 평가하면, **Then** 해당 행을 갱신하거나 값을 보정하지 않고 다른 적격 후보 검색 또는
    신규 생성으로 계속한다.
25. **Given** legacy semantic의 `num_times`가 양의 정수가 아니거나 정확히 1 증가시킬 수 없음,
    **When** 자동 병합 후보를 평가하면, **Then** 해당 행을 갱신·clamp·초기화하지 않고 다른 적격
    후보 검색 또는 신규 생성으로 계속한다.
26. **Given** 서로 다른 episodic importance의 독립 증거가 같은 semantic에 동시에 병합됨, **When**
    모든 primary 변경이 완료되면, **Then** 마지막으로 커밋된 evidence occurrence의 episodic
    importance를 최종 importance의 원본값으로 사용한다.

---

### User Story 3 - 근거 있는 저장 게이트 운영 (Priority: P3)

메모리 운영자는 confidence 분포를 확인한 뒤 저품질 triple의 저장 여부를 판단하고, 경계값과
같은 점수 때문에 의도하지 않은 파편이 저장되지 않기를 원한다.

**Why this priority**: 임의 계수나 임계값은 정상 기억까지 버릴 수 있으므로 실제 분포와 명시적
경계 동작이 필요하다.

**Independent Test**: 대표 표본의 confidence·canonicalization 결과·저장 결과 분포를 만들고,
선택한 경계 정책이 표본과 경계값 입력에서 일관되게 동작하는지 확인한다.

**Acceptance Scenarios**:

1. **Given** confidence가 유효 저장 하한보다 낮은 triple, **When** 자동 추출 결과를 처리하면,
   **Then** semantic memory를 생성하거나 갱신하지 않고 반복 횟수도 늘리지 않는다.
2. **Given** confidence가 기본 저장 하한 0.7과 정확히 같은 triple, **When** 자동 추출 결과를
   처리하면, **Then** semantic memory를 생성하거나 갱신하지 않는다.
3. **Given** confidence 또는 importance 정책을 변경하려는 운영자, **When** 변경 근거를 검토하면,
   **Then** 정상·canonicalization 실패 표본별 분포와 선택 이유를 확인할 수 있다.
4. **Given** 저장 하한 이하 triple이 제외됨, **When** 처리 결과를 확인하면, **Then** 기존 skipped
   통계와 구조화 로그에서 제외 사실을 확인할 수 있고 triple 원문은 새 저장소에 남지 않는다.
5. **Given** 운영 confidence 분포를 검증함, **When** 결과를 기록하거나 테스트 자료를 준비하면,
   **Then** 저장소에는 집계 수치·식별자·해시와 합성 픽스처만 남고 운영 원문이나 파생 코퍼스는
   포함되지 않는다.
6. **Given** 사용자 지정 저장 하한이 0 또는 1임, **When** triple을 처리하면, **Then** 하한 0은
   confidence 0만 제외하고 하한 1은 모든 triple을 제외한다.
7. **Given** 한 처리 묶음의 일부 triple에서 유한한 0~1 confidence를 계산하지 못함, **When** 묶음을
   처리하면, **Then** 해당 triple만 제외하고 나머지 유효 triple은 계속 처리한다.
8. **Given** 원본 memory가 없거나 episodic이 아니거나 soft-delete 상태임, **When** 자동 semantic
   갱신을 요청하면, **Then** 첫 semantic 변경 전에 전체 요청을 검증 오류로 거부한다.
9. **Given** 추출 결과의 triple 목록이 비어 있음, **When** 자동 semantic 갱신을 요청하면,
   **Then** 원본 조회나 상태 변경 없이 기존의 0건 처리 결과를 반환한다.
10. **Given** 많은 후보 중 일부만 활성·동일 scope·자동 provenance 조건을 만족함, **When** 유사
    semantic을 찾으면, **Then** 부적격 후보는 embedding 비교 전에 제외하고 입력 triple의
    subject·object embedding은 해당 triple 처리 동안 각각 한 번만 계산한다.
11. **Given** triple이 저장 하한, 계산 오류 또는 운영 실패로 제외됨, **When** 구조화 로그와 호출자
    오류를 기록하면, **Then** 원본 subject·predicate·object·content·embedding을 포함하지 않고
    원본 ID·묶음 내 위치·사유만으로 식별한다.
12. **Given** 원본·공통 입력 검증을 통과했지만 처리 묶음의 모든 primary semantic 변경이 운영
    실패로 커밋되지 않음, **When** 원본 변환 상태를 정하면, **Then** 성공으로 표시하지 않아 안전한
    전체 재시도를 허용한다. 하나라도 primary 변경이 커밋된 묶음은 성공 상태를 유지하고 전체 자동
    재시도를 만들지 않는다.
13. **Given** 비어 있지 않은 triple 묶음과 유한한 0~1 범위 밖의 사용자 지정 유사도 하한,
    **When** 자동 semantic 갱신을 요청하면, **Then** 원본 조회나 어떤 상태 변경보다 먼저 전체
    요청을 검증 오류로 거부하고 값을 clamp·기본값으로 대체하지 않는다.
14. **Given** 유효한 유사도 하한과 그 하한에 정확히 같은 유사도 점수, **When** 유사 후보를
    판정하면, **Then** 해당 subject 또는 object 비교를 일치로 인정한다. 하한 0은 모든 유효 점수를,
    하한 1은 정확히 1인 점수만 일치로 인정한다.
15. **Given** 적격 후보와의 유사도 계산 결과가 유한한 0~1 값이 아님, **When** 병합 대상을
    결정하면, **Then** 그 결과를 clamp하거나 불일치로 간주해 신규 semantic을 만들지 않고 해당
    triple만 판정 불가로 제외한 뒤 다음 유효 triple을 처리한다.
16. **Given** 추출 triple의 subject·predicate·object 중 하나가 문자열이 아니거나 정규화 후
    공백만 남음, **When** 자동 semantic 갱신을 처리하면, **Then** 해당 triple을 후보 조회·embedding·
    상태 변경 전에 제외하고 원본 필드로 되돌아가 KG 식별자를 만들지 않는다.
17. **Given** 추출 결과 자체가 없거나 `triples`가 배열이 아님, **When** 자동 semantic 갱신을
    요청하면, **Then** 이를 빈 배열로 바꾸지 않고 원본 조회나 상태 변경 전에 전체 요청을 검증
    오류로 거부한다. 실제 빈 배열만 기존 no-op 결과를 반환한다.
18. **Given** 입력 필드는 유효하지만 predicate canonicalization 또는 entity linking이 예외를
    내거나 비문자열·빈 정규화 값을 반환함, **When** 해당 triple을 처리하면, **Then** raw 값으로
    되돌아가지 않고 그 triple만 후보 조회·embedding·상태 변경 전에 제외한 뒤 다음 triple을 계속
    처리한다.
19. **Given** 한 triple의 canonicalization과 entity linking이 성공함, **When** confidence 계산부터
    후보 판정·KG 식별·semantic 저장까지 진행하면, **Then** 같은 호출에서 만든 단일 정규화 결과를
    모든 단계가 재사용해 경로마다 서로 다른 triple을 보지 않는다.
20. **Given** 한 묶음에 여러 유효 triple과 중복·제외 triple이 섞여 있음, **When** primary 변경과
    결과 ID를 확정하면, **Then** coalescing 뒤 각 대상의 첫 입력 위치 순서로 처리·반환하고 묶음
    내부 병렬 완료 순서에 따라 결과가 바뀌지 않는다.
21. **Given** canonicalization이 비어 있지 않은 fallback 값과 `success=false`를 정상 반환함,
    **When** 해당 triple의 confidence와 저장 여부를 정하면, **Then** fallback 값을 정규화
    snapshot에 유지하고 실패 상태를 품질 감점으로 반영하되 운영 실패로 제외하지 않는다.
22. **Given** 비어 있지 않은 triple 목록의 `extractionInfo` 또는 필수 `steps` boolean이 잘못됨,
    **When** 자동 semantic 갱신을 요청하면, **Then** 원본 조회·confidence 계산·통계 기록·상태
    변경 전에 전체 요청을 검증 오류로 거부한다. 실제 빈 triple 배열은 이 검증 없이 no-op한다.
23. **Given** 유효 confidence를 계산한 triple이 저장 하한, coalescing 또는 이후 운영 실패로
    생성·갱신되지 않음, **When** 기존 confidence 분포 통계를 기록하면, **Then** 그 confidence를
    원본 입력 위치당 정확히 한 번 포함한다. confidence 계산 전 실패한 입력은 표본에 넣지 않는다.
24. **Given** 생성·갱신·제외·coalescing이 섞인 한 처리 묶음, **When** 결과 통계를 확정하면,
    **Then** 각 원본 triple 위치는 created·updated·skipped·duplicate 중 정확히 하나로 분류되고
    네 수치의 합은 원본 triple 수와 일치한다.
25. **Given** 비어 있지 않은 유효 요청의 옵션 객체가 처리 도중 외부에서 변경됨, **When** 이후
    triple의 저장 하한·유사도 하한·episodic importance를 결정하면, **Then** 호출 시작 시 검증한
    동일한 policy snapshot을 사용하고 변경값은 다음 호출부터만 반영한다.
26. **Given** 하나 이상의 primary 변경이 커밋된 뒤 기존 통계 기록 또는 구조화 로그가 예외를 냄,
    **When** 호출 결과와 원본 변환 상태를 확정하면, **Then** 커밋 결과·반환 ID·성공 상태·재시도
    여부를 바꾸거나 원래 처리 오류를 관측 오류로 대체하지 않는다.
27. **Given** 관계 방향·타입 계약이 현재 원본과 자동 semantic 대상에 맞지 않음, **When** 비어
    있지 않은 요청을 처리하면, **Then** 어떤 primary 변경보다 먼저 계약 오류를 전파한다. 계약을
    통과한 뒤의 관계·임베딩 운영 실패는 서로 독립적으로 격리하고 완료 순서를 보장하지 않는다.
28. **Given** 생성·갱신·제외·coalescing 결과가 여러 semantic 대상으로 귀결됨, **When** 반환
    semantic ID 목록을 확정하면, **Then** created 또는 updated가 커밋된 각 고유 대상 ID만 첫 성공
    원본 위치 순으로 한 번 반환하고 skipped·duplicate만 가진 대상은 포함하지 않는다.
29. **Given** primary 커밋 뒤 `extracted_from`과 `supported_by` 관계 중 하나가 이미 존재하거나
    운영상 실패함, **When** 출처 관계 쌍을 기록하면, **Then** 각 방향을 독립적으로 시도하고 중복은
    성공한 no-op으로 처리하며 한 방향의 실패가 다른 방향이나 primary 결과를 취소하지 않는다.
30. **Given** 비어 있지 않은 `triples` 배열에 sparse 위치, `null` 또는 비객체 항목이 섞여 있음,
    **When** 자동 semantic 갱신을 처리하면, **Then** 해당 원본 위치만 confidence 계산 전 skipped로
    분류하고 나머지 유효 위치를 계속 처리한다.
31. **Given** 비어 있지 않은 요청의 episodic ID가 비문자열·공백이거나 선택적 수치 옵션이 `null`·
    boolean·숫자 문자열임, **When** 호출 입력을 검증하면, **Then** 값을 변환하거나 기본값으로
    대체하지 않고 원본 조회 전에 전체 요청을 거부한다. 옵션 미제공과 `undefined`만 기본값을 쓴다.
32. **Given** 비어 있지 않은 요청의 triple 배열·triple 객체·필수 extraction metadata가 처리
    도중 외부에서 변경됨, **When** 이후 위치를 처리하고 결과를 대사하면, **Then** 개별 triple
    처리를 시작하기 전에 캡처한 입력 순서·필드·metadata snapshot만 사용하고 변경값은 다음 호출부터
    반영한다.
33. **Given** primary 커밋 뒤 만들려는 동일 방향 출처 관계가 이미 존재함, **When** 관계 생성을
    시도하면, **Then** 성공한 no-op으로 정산하고 기존 관계의 confidence·metadata·생성시각을
    변경하지 않는다.
34. **Given** primary 커밋 뒤 관계와 임베딩 후속 작업이 서로 다른 순서로 완료되거나 실패함,
    **When** semantic 갱신 호출이 반환되면, **Then** 모든 예정된 후속 작업의 성공·실패가 이미
    정산되어 있고 이후 분리 실행이 호출 결과를 바꾸지 않는다.
35. **Given** 비어 있지 않은 추출 결과의 선택적 `failureReason`이 알려진 코드가 아니거나
    `rawLLMOutput`이 포함됨, **When** 자동 semantic 갱신을 요청하면, **Then** 잘못된 failure reason은
    원본 조회 전에 요청 전체를 거부하고 raw LLM 출력은 snapshot·관계 metadata·DB·로그에 전달하지
    않는다.
36. **Given** 아직 성공 상태가 아닌 episodic 원본의 semantic primary 변경 뒤 성공 상태 기록이
    실패함, **When** 해당 원본의 변환을 종료하면, **Then** 같은 DB 커밋 단위의 primary 변경도 모두
    되돌리고 성공 수치와 semantic ID를 반환하지 않아 다음 자동 재시도가 증거를 중복 가산하지
    않는다.
37. **Given** 한 원본의 수락된 semantic evidence occurrence와 지연되거나 실패하는 출처 관계가
    함께 있음, **When** 원본 성공 metadata를 확정하면, **Then** `confidence_avg`는 현재 호출에서
    primary 커밋된 coalesced occurrence의 confidence만으로 계산하고 관계 행의 존재·값에 의존하지
    않는다. 수락된 occurrence가 없으면 이 필드를 생략한다.
38. **Given** 실제 빈 triple 배열을 받은 semantic 갱신 서비스와 같은 결과를 받은 자동 변환
    워크플로, **When** 각각 처리하면, **Then** 전자는 조회·상태 변경 없는 0건 no-op을 반환하고
    후자는 기존 `no_triple` 실패·retry metadata 경로를 사용하며 semantic primary와 후속 작업을
    실행하지 않는다.
39. **Given** 아직 성공 처리되지 않은 같은 episodic 원본을 두 정상 자동 변환 호출이 동시에
    선택함, **When** 두 호출이 성공 전환을 시도하면, **Then** 하나만 semantic evidence와 성공
    상태를 커밋하고 다른 호출은 자신의 primary 변경을 되돌려 같은 원본 증거를 중복 가산하지
    않는다. 명시적 강제 재처리 호출은 기존대로 호출마다 새 occurrence다.
40. **Given** 원본의 conversion commit unit이 성공적으로 커밋된 뒤 관계·임베딩·관측 후속 단계가
    실패함, **When** 외부 변환 결과를 확정하면, **Then** 원본을 failed로 강등하거나 자동 재시도
    대상으로 만들지 않고 커밋된 성공 결과를 유지한다.
41. **Given** 이미 성공한 원본을 명시적으로 강제 재처리하는 시도가 no-triple 또는 pre-commit
    실패로 끝남, **When** 해당 시도의 결과를 기록하면, **Then** 이번 시도는 실패로 관측하되 원본의
    기존 성공 상태·metadata와 기존 semantic evidence는 그대로 유지하고 정상 자동 재시도 대상으로
    만들지 않는다.
42. **Given** 같은 episodic 원본을 수동 변환 도구와 예약 배치가 각각 처리함, **When** 동일한 추출
    결과와 실패를 주입하면, **Then** 두 진입점은 같은 primary 원자성·성공 상태·retry·결과 집계
    계약을 적용한다.
43. **Given** 아직 성공하지 않은 원본의 자동 변환이 no-triple·malformed 추출 결과 또는 pre-commit
    운영 실패로 끝남, **When** 실패 상태를 기록하면, **Then** 기존 retry count를 원자적으로 한 번
    증가시키고 기존 backoff·최대 재시도·abandoned 정책을 적용하되 동시 성공을 덮어쓰지 않는다.
44. **Given** 자동 변환이 원본 snapshot으로 semantic 계산을 마친 뒤 원본의 content·importance·
    scope 또는 활성 상태가 바뀜, **When** conversion commit을 시도하면, **Then** stale primary를
    되돌리고 실패·retry를 기록하지 않아 변경된 원본을 다음 호출이 새로 처리하게 한다.
45. **Given** 비어 있지 않은 묶음의 모든 위치가 정책상 저장 제외되거나 triple 단위 입력·운영
    실패로 제외됨, **When** 원본 변환 상태를 정하면, **Then** 정책 제외만 있으면 성공 처리하고
    하나 이상의 입력·운영 실패가 있으면 기존 failed/retry 경로를 사용한다.
46. **Given** 정규화·confidence·embedding 비교 같은 fallible 계산이 필요한 자동 변환, **When**
    원본 성공 상태와 semantic primary를 커밋하면, **Then** 해당 계산은 쓰기 트랜잭션을 열기 전에
    끝나고 트랜잭션 안에서는 snapshot 재검증과 DB 변경만 수행한다.
47. **Given** 후보 계산 뒤 commit 재검증에서 대상 후보의 자격이 바뀜, **When** 허용된 1회 후보
    재판정을 수행하면, **Then** 현재 transaction을 먼저 rollback·종료하고 transaction 밖에서 새
    후보 snapshot과 필요한 비교를 계산한 뒤 별도 transaction으로 한 번만 다시 commit한다.
48. **Given** 예약 batch가 한 원본의 변환을 시작한 뒤 실행 시간 제한에 도달함, **When** batch를
    중단하면, **Then** 시작한 원본은 conversion commit과 예정된 후속 작업을 끝까지 정산하고 새
    원본은 시작하지 않으며 미시작 원본의 상태·retry·결과 수치는 바꾸지 않는다.
49. **Given** 한 batch의 서로 다른 원본 중 하나가 변환 실패함, **When** 시간 제한이 남아 있음,
    **Then** 실패한 원본만 자체 commit·retry 계약으로 정산하고 이미 완료된 원본을 되돌리거나 이후
    원본 처리를 중단하지 않으며 batch 집계는 실제 종결된 원본만 한 번씩 센다.
50. **Given** pre-commit 실패의 semantic primary rollback은 성공했지만 실패 상태·retry 전이
    transaction 자체가 commit되지 못함, **When** 호출을 종료하면, **Then** 성공이나 retry 증가를
    만들어 내지 않고 원본 상태를 기존 값으로 유지해 다음 정상 실행이 다시 선택할 수 있게 한다.
51. **Given** conversion commit은 완료됐지만 관계·embedding 후속 작업 정산 전에 프로세스가
    종료됨, **When** DB를 다시 열면, **Then** 커밋된 semantic primary와 원본 성공 tuple을 유지하고
    원본 전체 자동 retry나 failed 강등을 만들지 않으며 커밋되지 않은 후속 결과를 성공으로 꾸미지
    않는다.
52. **Given** 오래된 failed 원본 다수가 아직 backoff 중이고 그 뒤에 즉시 처리 가능한 원본이 있음,
    **When** 제한된 크기의 예약 batch 대상을 고르면, **Then** retry 적격성을 먼저 적용한 뒤
    `created_at`과 ID 순으로 batch limit을 채워 backoff 원본이 처리 가능한 원본을 굶기지 않는다.
53. **Given** failed 원본의 명시된 retry metadata가 JSON이 아니거나 retry count·시각·backoff 값의
    타입 또는 범위가 잘못됨, **When** 예약 batch 대상을 고르면, **Then** 이를 retry count 0으로
    보정하지 않고 해당 원본을 비파괴적으로 제외해 추출·상태 변경 없이 기존 경고로 관측한다.
54. **Given** failed 원본에 유효한 `last_attempt`와 `next_retry_after_days`가 저장됨, **When** retry
    가능 시각을 판정하면, **Then** 저장된 지연을 현재 설정으로 소급 변경하지 않고 정확한 만료
    시각부터 적격으로 인정한다.
55. **Given** batch 대상 조회 뒤 원본이 성공·abandoned·삭제 상태가 되거나 content·importance·scope·
    type이 바뀜, **When** 해당 원본의 추출을 시작하려 하면, **Then** 최신 상태를 먼저 재검증해
    extractor를 호출하지 않고 그 실행을 skipped로 한 번 정산하며 상태·retry를 바꾸지 않는다.
56. **Given** batch 크기·chunk 크기·retry 설정 또는 시간 설정이 허용 타입·범위를 벗어나거나
    `parallelism`이 1이 아님,
    **When** 예약 batch를 시작하면, **Then** 대상 조회와 원본 상태 변경 전에 설정 오류로 종료하고
    값을 clamp하거나 실행 중 기본값으로 대체하지 않는다.
57. **Given** 아직 시도되지 않은 원본과 `maxRetries=1`, **When** 첫 genuine pre-commit 실패가
    발생하면, **Then** retry count를 1로 기록하고 즉시 abandoned로 전이해 두 번째 자동 시도를
    만들지 않는다.
58. **Given** `maxRetries`보다 짧은 유효 backoff 배열, **When** 여러 실패 뒤 다음 retry 지연을
    기록하면, **Then** 첫 실패부터 배열 순서대로 사용하고 배열을 소진한 뒤에는 마지막 값을
    반복하며 abandoned 전이에는 다음 retry 지연을 남기지 않는다.
59. **Given** `triple_extracted`와 `triple_extracted_status`가 서로 모순되거나 알려지지 않은 상태를
    가진 원본, **When** 예약 batch 대상을 고르면, **Then** 해당 원본을 비파괴적으로 제외해 limit·
    extractor·outcome을 소비하지 않고 기존 경고로 관측한다.
60. **Given** chunk 완료 뒤 남은 timeout 예산이 `chunkDelayMs`보다 짧음, **When** 다음 chunk를
    준비하면, **Then** 남은 예산을 넘는 지연을 예약하지 않고 deadline에서 timeout으로 종료해 다음
    원본을 시작하지 않는다.
61. **Given** 예약 batch 실행이 설정 snapshot을 확정한 뒤 호출자가 원본 설정 객체나 backoff
    배열을 변경함, **When** 남은 대상을 선택·처리하고 실패 지연을 기록하면, **Then** 현재 실행은
    시작 시 검증한 값만 사용하고 변경값은 다음 실행부터 반영한다.
62. **Given** 예약 batch 설정의 `parallelism`이 1보다 큼, **When** 실행을 시작하면, **Then** 대상
    조회 전에 설정 오류로 종료하고 원본 병렬 처리나 묵시적 직렬 fallback을 수행하지 않는다.
63. **Given** batch 대상 목록을 확정한 뒤 일부 원본이 stale로 제외되거나 새 원본이 retry due가 됨,
    **When** 현재 실행을 계속하면, **Then** 확정 목록을 보충 조회하지 않고 새 적격 원본은 다음
    execute에 맡긴다.
64. **Given** 선택 원본 수가 `chunkSize`로 나누어떨어지지 않거나 `chunkSize`보다 작음, **When**
    chunk를 만들면, **Then** 선택 순서의 연속 구간으로만 분할하고 마지막 비어 있지 않은 나머지
    chunk를 한 번 처리하며 빈 chunk를 만들지 않는다.
65. **Given** 실행 중 시스템 wall clock이 앞이나 뒤로 이동함, **When** retry 적격성과 timeout을
    판정하면, **Then** 대상 적격성은 시작 시 캡처한 wall-clock 시각으로 고정하고 timeout은 단조
    경과시간으로 판단해 새 원본 시작 여부가 clock jump로 바뀌지 않는다.
66. **Given** 처리 가능한 대상이 없거나 timeout이 첫 원본 전에 발생한 실행과 하나 이상의 원본을
    종결 처리한 실행, **When** batch-level `success`를 확정하면, **Then** 전자는 false이고 후자는
    원본별 success·failed·skipped 구성과 무관하게 true이며 job-level 치명 오류는 false다.
67. **Given** 선택적 batch 설정이 누락되거나 `undefined`인 실행과 `null`·boolean·숫자 문자열 등
    잘못된 런타임 타입이 명시된 실행, **When** 실행 정책을 확정하면, **Then** 전자는 기존 기본값을
    사용하고 후자는 대상 조회 전에 설정 오류로 거부한다.
68. **Given** 소수 일수 backoff와 timezone을 포함한 유효 retry 시각, **When** due time을 계산하면,
    **Then** 일 단위로 반올림하지 않고 정확한 24시간 배수로 계산하며 정확한 due 시각부터 적격이다.
69. **Given** batch가 선택한 source의 content가 비문자열·공백이거나 non-NULL importance가 유한한
    0~1 값이 아님, **When** extractor 직전 입력을 검증하면, **Then** extractor와 semantic 변경 없이
    genuine pre-commit 실패로 정산해 기존 retry·abandoned 정책을 적용한다.
70. **Given** failed 또는 abandoned 원본이 이후 성공하거나 failed 원본이 abandoned로 전이함,
    **When** source 상태 metadata를 기록하면, **Then** 새 상태의 정규 형태로 전체 교체해 이전
    상태 전용 키를 남기지 않는다.
71. **Given** 일부 원본을 종결한 뒤 source 단위로 격리할 수 없는 chunk 또는 job orchestration
    오류가 발생함, **When** batch 결과를 확정하면, **Then** 이미 종결된 결과만 보존하고 현재 미확정·
    미시작 원본의 outcome을 합성하지 않은 채 실행을 중단하며 batch-level `success`는 false다.
72. **Given** 마지막 시작 원본이 deadline 뒤에 정산되지만 남은 원본이 없는 실행과 deadline 때문에
    다음 원본을 시작하지 못한 실행, **When** 결과 시간을 확정하면, **Then** 두 실행 모두 실제 종료
    시각과 비음수 duration을 기록하되 `timeoutOccurred`는 후자에만 true다.
73. **Given** failed 또는 abandoned 전이가 durable commit된 원본과 stale·성공·상태 기록 실패
    원본이 섞여 있음, **When** batch `retryCounts`를 확정하면, **Then** 현재 실행에서 실패 전이가
    commit된 원본만 새 persisted retry count로 한 번 포함한다.
74. **Given** 안전 정수 범위를 벗어난 count 설정·retry metadata 또는 현재 `maxRetries` 이상 retry
    count를 가진 failed 원본, **When** 설정과 대상을 검증하면, **Then** 값을 반올림·감소·자동
    abandoned 처리하지 않고 설정 오류 또는 비파괴 대상 제외로 정산한다.
75. **Given** 같은 batch job 인스턴스의 두 execute가 겹쳐 같은 source를 후보로 선택함, **When**
    두 실행을 완료하면, **Then** 각 실행의 시간·설정·candidate·결과는 서로 격리되고 source
    conversion은 기존 단일 승자 계약으로 한 번만 커밋된다.
76. **Given** 여러 source가 같은 semantic을 순서대로 생성·갱신하거나 일부 source가 rollback됨,
    **When** batch semantic 집계를 확정하면, **Then** durable primary occurrence만 created 또는
    updated에 더하고 같은 최종 semantic ID라도 서로 다른 commit occurrence는 각각 센다.
77. **Given** success·failed·skipped와 job-level 치명 오류가 섞인 실행, **When** batch 결과를
    반환하면, **Then** top-level `processed`는 `details.processed`와 같고 후자는
    `details.success + details.failed + details.skipped`와 같으며 미확정 원본은 어느 값에도 없다.
78. **Given** 내부 생성 semantic service를 쓰는 같은 batch job 인스턴스가 서로 다른 DB handle로
    순차 또는 겹쳐 execute됨, **When** semantic update 의존성을 사용하면, **Then** 각 실행은 자신에게
    전달된 DB에 바인딩된 의존성만 사용하고 한 DB의 source·semantic·결과가 다른 DB 실행에 섞이지 않는다.
79. **Given** 잘못된 batch 설정 또는 schema 준비·DB-bound 서비스 생성·대상 조회 실패, **When**
    execute preflight를 수행하면, **Then** 설정은 어떤 DB 접근보다 먼저 거부하고 이후 초기화 실패는
    processed 0의 job-level 치명 오류로 반환하며 source outcome을 합성하지 않는다.
80. **Given** extractor가 malformed 결과·비배열 `triples`·잘못된 `failureReason` 또는 유효한 빈
    triple 결과를 반환함, **When** source 실패를 기록하면, **Then** malformed 결과는 기존
    `llm_parse_fail`, 유효한 빈 결과는 허용된 사유 또는 `no_triple`로 정규화하고 raw output은
    metadata·batch 오류에 복사하지 않는다.
81. **Given** 호출자가 반환된 batch 결과의 Date·배열·Map을 변경한 뒤 같은 job 인스턴스를 다시
    execute함, **When** 다음 결과를 확인하면, **Then** 이전 호출자의 변경은 다음 실행의 timing·
    errors·warnings·retryCounts·집계에 영향을 주지 않는다.

### Edge Cases

- confidence가 정확히 0이면 유효한 저장 하한에서 제외되고, 정확히 1이면 수락되어 1로 저장된다.
- confidence가 기본 저장 하한 0.7과 정확히 같으면 저장하지 않으며, 기존 semantic memory의
  반복 횟수나 aggregate confidence도 바꾸지 않는다.
- 기존 semantic memory의 confidence가 비어 있으면 과거 값을 0으로 간주하지 않는다. 처음 새로
  수락된 confidence를 기존 `num_times` 전체와 새 증거의 대표값으로 사용해 aggregate를
  초기화한다.
- 원본 episodic importance가 없으면 기존 기본값 0.5를 사용하지만, 명시적인 0은 그대로 보존하고
  반복 boost로 양수로 바꾸지 않는다.
- 사용자 지정 confidence 저장 하한이 유한한 0~1 범위를 벗어나면 semantic memory를 변경하기
  전에 명확한 검증 오류로 거부한다.
- 비어 있지 않은 triple 묶음의 사용자 지정 유사도 하한이 유한한 0~1 범위를 벗어나면 원본 조회나
  semantic memory 변경 전에 전체 요청을 검증 오류로 거부한다. 빈 묶음은 기존 no-op 계약을
  우선한다.
- 유사도 점수가 하한과 정확히 같으면 일치로 인정한다. 하한 0은 모든 유효한 0~1 점수를, 하한 1은
  정확히 1인 점수만 일치로 인정한다.
- 계산된 유사도가 `NaN`·무한대 또는 0~1 범위 밖이면 그 후보를 불일치로 축소하거나 값을 clamp하지
  않는다. 안전한 대상을 결정할 수 없으므로 해당 triple을 판정 불가로 제외한다.
- 추출 triple의 subject·predicate·object는 문자열이어야 하며 정규화 후 각각 하나 이상의 비공백
  문자를 가져야 한다. 이 조건을 만족하지 않으면 raw 필드로 fallback하지 않고 해당 triple만
  제외한다.
- 추출 결과 또는 `triples` 컨테이너가 없거나 배열이 아니면 malformed 요청이며 빈 추출 결과로
  축소하지 않는다. 실제 빈 배열만 원본 조회 없는 no-op으로 취급한다.
- 유효한 입력 triple이라도 canonicalization·entity linking이 예외를 내거나 비문자열·빈 결과를
  만들면 해당 triple만 제외한다. 부분 정규화 값과 raw 값을 섞어 KG key나 semantic 내용을 만들지
  않는다.
- 한 입력 triple의 canonicalization·entity linking 결과는 한 번 만든 immutable snapshot으로
  confidence, 후보 검색, KG 식별 및 저장에 재사용한다. 단계별 재실행 결과를 혼합하지 않는다.
- canonicalization·entity linking이 `success=false`와 함께 유효한 비공백 fallback 값을 반환하면
  이는 정규화 계약 실패가 아니라 낮은 품질 신호다. snapshot의 값은 유지하고 success flag로
  confidence를 감점하며, 예외·비문자열·빈 결과에만 운영 실패 격리를 적용한다.
- 비어 있지 않은 triple 목록은 `extractionInfo.steps.canonicalization`과 `entityLinking`의 boolean
  계약을 만족해야 한다. malformed metadata가 primary 저장 뒤 관계 단계에서 뒤늦게 실패하게 두지
  않으며, 실제 빈 배열은 metadata 검증보다 no-op을 우선한다.
- 유효하게 계산된 confidence는 저장·병합 결과와 무관하게 원본 입력 triple당 한 번 기존 분포
  통계에 포함한다. 정규화 snapshot을 만들지 못해 confidence 자체가 없는 입력은 포함하지 않는다.
- 원본 triple 하나는 created·updated·skipped·duplicate 중 하나의 종결 결과만 가진다. coalesced
  그룹의 대표만 primary 결과 또는 skipped를 가지며 나머지는 대표의 커밋 성공 여부와 무관하게
  duplicate로 계산해 묶음 전체 합계를 보존한다.
- 실제 빈 triple 배열의 no-op을 먼저 판정한 뒤, 비어 있지 않은 요청은 episodic ID·importance의
  제공 여부와 값, confidence·similarity 하한을 한 번 복사·검증한 policy snapshot만 사용한다.
  호출자가 원본 옵션을 변경해도 진행 중인 묶음의 판단은 바뀌지 않는다.
- 기존 통계 기록이나 구조화 로그가 실패해도 이미 정해진 primary 결과·반환 ID·원본 변환 상태를
  바꾸지 않고 원래 예외를 가리지 않는다. 관측 실패를 위한 신규 저장소나 재시도 경로는 만들지
  않는다.
- 관계 방향·타입처럼 입력과 대상 종류로 판정 가능한 계약은 첫 primary 변경 전에 검증한다.
  검증 뒤 관계와 임베딩은 primary 커밋 이후의 독립적인 후속 작업이며 서로의 완료를 기다리거나
  성공 조건이 되지 않는다.
- 반환 semantic ID는 created·updated가 커밋된 고유 대상만 첫 성공 원본 위치 순으로 한 번 담는다.
  skipped·duplicate는 ID를 추가하지 않고, 후속 관계·임베딩·관측 실패도 이미 확정한 목록을 바꾸지
  않는다.
- primary 뒤의 `extracted_from`과 `supported_by` 관계는 각각 독립적으로 생성을 시도한다. 기존
  중복은 성공한 no-op이며, 한 방향의 운영 실패는 다른 방향 시도나 primary 결과를 막지 않는다.
- 비어 있지 않은 `triples` 배열의 sparse 위치, `null`, 배열 또는 다른 비객체 항목은 해당 원본
  위치만 confidence 계산 전 제외한다. 컨테이너 전체를 거부하거나 항목을 객체로 강제 변환하지
  않는다.
- 비어 있지 않은 요청에서 episodic ID는 비공백 문자열이어야 한다. 선택적 수치 옵션은 미제공 또는
  `undefined`일 때만 기존 기본값을 사용하며 `null`·boolean·숫자 문자열은 검증 오류다.
- container·metadata 검증 뒤 개별 triple 처리를 시작하기 전에 triple 배열의 길이·순서, 각 triple의 세 필드와
  처리에 필요한 extraction metadata를 값 snapshot으로 캡처한다. 호출 중 원본 객체 변경을 읽지
  않으며 사용하지 않는 필드까지 범용 deep clone하지 않는다.
- 이미 존재하는 동일 방향 출처 관계는 진짜 no-op이다. 중복 시 기존 관계 confidence·metadata·
  생성시각을 갱신하지 않으며 동시 생성 경쟁의 unique 충돌도 같은 성공 no-op으로 정산한다.
- primary 뒤 예정된 관계·임베딩 작업은 서로 독립적으로 실행하되 semantic 갱신 호출이 반환되기
  전에는 모두 성공 또는 실패로 정산되어야 한다. 반환 뒤 detached 작업으로 결과를 뒤늦게 바꾸지
  않는다.
- 비어 있지 않은 요청의 선택적 `failureReason`은 미제공·`undefined` 또는 기존에 정의된 failure
  reason 코드만 허용한다. 알 수 없는 문자열과 비문자열은 공통 metadata 검증 오류이며,
  `rawLLMOutput`은 semantic 갱신 snapshot·관계 metadata·DB·로그로 복사하지 않는다.
- 원본 episodic 한 건의 자동 변환에서는 수락된 semantic primary 변경과 원본 성공 상태 기록을
  같은 DB 커밋 단위로 확정한다. 성공 상태 쓰기가 실패하면 해당 원본의 primary 변경과 성공 결과를
  모두 되돌려 자동 재시도를 안전하게 유지한다. 관계·임베딩은 커밋 뒤 best-effort 후속 작업이다.
- 원본 성공 metadata의 `confidence_avg`는 현재 호출에서 primary 커밋된 coalesced evidence
  occurrence의 confidence만 평균한다. 커밋 뒤 생성되는 관계 행을 다시 읽지 않으며 수락된
  occurrence가 없으면 필드를 생략한다.
- 실제 빈 triple 배열은 semantic 갱신 서비스에서는 조회 없는 no-op이지만 자동 변환
  워크플로에서는 기존 `no_triple` 실패·retry 경로다. 어느 쪽도 semantic primary나 후속 작업을
  실행하지 않는다.
- 같은 미변환 원본을 정상 자동 변환 호출이 동시에 처리하면 성공 전환의 단일 승자만 evidence를
  커밋한다. 패한 호출은 자신의 primary를 되돌리고 승자의 성공 상태를 덮어쓰지 않으며, 명시적
  강제 재처리는 호출마다 새 occurrence라는 기존 의미를 유지한다. 패한 호출은 기존 skipped
  outcome으로 정산하고 failed나 retry로 세지 않는다.
- conversion commit unit이 커밋된 시점은 해당 시도의 성공 여부에 대한 point of no return이다.
  이후 후속 작업·관측 실패는 원본을 failed로 강등하거나 자동 재시도를 만들지 않는다.
- 이미 성공한 원본의 명시적 강제 재처리가 commit 전에 실패하면 이번 시도만 실패로 관측하고 기존
  성공 tuple과 semantic evidence를 보존한다. 실패한 강제 시도가 정상 자동 retry 자격을 만들지
  않는다.
- 수동 변환 도구와 예약 배치를 포함해 원본 변환 상태를 기록하는 모든 자동 episodic→semantic
  진입점은 같은 conversion commit·retry·outcome 계약을 사용한다. 직접 semantic 갱신 서비스의
  상태 비소유 경계는 그대로 유지한다.
- 아직 성공하지 않은 원본의 genuine pre-commit 실패는 기존 retry count를 원자적으로 한 번
  증가시키고 기존 backoff·최대 재시도·abandoned 전이를 적용한다. 동시 성공 패자와 stale source
  snapshot은 실패 시도가 아니므로 count나 상태를 바꾸지 않는다.
- 처리에 사용한 원본의 content·importance·owner/project·type·활성 상태가 commit 전에 바뀌면
  semantic primary와 결과를 되돌린다. 시작 snapshot은 호출 내부 계산 일관성에만 사용하고 변경된
  원본에 stale evidence를 커밋하는 권한은 주지 않는다.
- primary 0건 묶음에서 저장 하한 같은 정책 제외만 있으면 정상 성공이다. sparse·malformed triple,
  정규화·confidence·후보 판정 실패 같은 입력·운영 실패가 하나라도 있으면 기존 failed/retry
  경로를 사용한다.
- LLM 추출, 정규화, confidence 및 후보 판정용 입력 embedding 계산·비교는 conversion write
  transaction 밖에서 완료한다. transaction은 원본·후보 snapshot 재검증과 primary·성공 tuple DB
  변경만 포함해 외부 지연 동안 write lock을 유지하지 않는다. semantic embedding 후속 작업은
  기존 post-commit 경계를 유지한다.
- 한 묶음은 coalescing 뒤 대상별 첫 입력 위치 순서로 primary 변경과 고유 semantic ID 반환을
  확정한다. 묶음 내부 병렬화로 커밋·반환 순서를 바꾸지 않으며 서로 다른 호출의 동시성은 유지한다.
- 사용자 지정 저장 하한이 0이면 confidence 0은 strict 경계로 제외하고 양수만 수락하며, 저장
  하한이 1이면 confidence 1을 포함한 모든 triple을 제외한다.
- 계산된 confidence가 `NaN`·무한대 또는 0~1 범위 밖이면 해당 triple을 저장하거나 병합하지 않고
  기존 skipped 통계와 구조화 로그에 기록한 뒤 같은 묶음의 다음 triple을 처리한다.
- 제공된 episodic importance가 `NaN`·무한대 또는 0~1 범위 밖이면 묶음의 첫 semantic 변경 전에
  전체 요청을 검증 오류로 거부한다.
- 정확한 triple 중복이 semantic memory가 아닌 다른 대표 항목을 가리키면 기존 분기 동작을
  유지하고 잘못된 항목을 갱신하지 않는다.
- 정확한 KG 대표 항목이 다른 owner/project에 속하거나 사용자 작성 semantic이면 그 항목을
  갱신하지 않고 동일 scope의 자동 semantic 후보 검색 또는 신규 생성으로 계속 진행한다.
- owner 또는 project가 다른 semantic memory는 triple과 embedding이 같아도 병합하지 않는다.
  `NULL` scope 값은 다른 `NULL`과만 같은 scope로 취급한다.
- 사용자 작성 provenance가 있거나 자동 생성 근거를 확인할 수 없는 semantic memory는 자동
  confidence·importance 집계 대상에서 제외한다.
- `origin_source`가 비어 있는 legacy semantic memory는 기존 `extracted_from` 관계가 있을 때만
  자동 생성 항목으로 취급하며, 관계도 없으면 이번 기능에서 provenance를 추정하거나 보정하지
  않는다.
- soft-delete된 semantic memory는 exact KG 대표 또는 유사 후보여도 갱신·복구하지 않고 활성
  후보 검색 또는 신규 생성으로 계속한다.
- 원본 episodic memory가 없거나 타입이 다르거나 soft-delete 상태이면 confidence 계산이나
  semantic 상태 변경 전에 전체 요청을 거부한다.
- 한 처리 묶음에서 원본 episodic의 owner/project가 변경되더라도 모든 triple은 처리 시작 시
  검증한 동일한 scope snapshot을 사용해 서로 다른 scope로 나뉘지 않는다.
- semantic 갱신 서비스가 받은 triple 목록이 비어 있으면 원본 episodic 검증을 포함한 추가 조회나
  상태 변경 없이 기존 no-op 결과를 반환한다. 자동 변환 경계는 FR-078을 따른다.
- 구조화 triple 필드가 비어 있는 legacy semantic 후보나 KG key와 실제 semantic triple이 다른
  stale 대표 항목은 건너뛰며 정상 triple 처리를 실패시키지 않는다.
- 여러 활성 scoped 자동 후보가 조건을 만족하면 exact 구조 일치를 우선하고, 같은 단계 후보는
  `created_at` 오름차순 뒤 ID 오름차순으로 하나를 결정한다.
- 한 처리 묶음에서 일부 triple만 저장 하한을 통과하면, 통과한 항목만 생성·갱신하고 나머지는
  건너뛴다.
- 제외된 triple은 분석 편의를 이유로 별도 영속화하지 않으며 기존 로그의 민감정보 처리 정책을
  그대로 따른다.
- 운영 DB 표본은 읽기 전용으로만 조회하고 원문·파생 표본을 저장소에 복사하지 않는다.
- 같은 episodic 처리 묶음에서 정규화 결과가 같은 triple이 반복되거나 exact·유사 경로가 같은
  semantic memory로 귀결되면 하나의 증거 occurrence로 합친다. 가장 높은 유효 confidence를
  대표값으로 사용하고 동률이면 입력 순서가 앞선 triple을 선택하며, 기존 duplicate 통계로
  합쳐진 건수를 관측한다.
- 같은 semantic memory를 갱신하는 요청이 동시에 실행되어도 마지막 쓰기가 앞선 confidence 평균이나
  `num_times` 증가분을 덮어쓰지 않는다.
- aggregate confidence가 한 번이라도 1보다 작아졌다면 이후 confidence 1 증거가 매우 많이
  추가되어도 수치 반올림으로 정확히 1이 되거나 boost 대상이 되지 않는다.
- aggregate confidence가 1인 semantic memory의 반복 횟수가 매우 커져도 importance는 0~1
  범위를 벗어나지 않는다.
- confidence 저장 후 관계 방향·타입 검증 오류가 아닌 관계 생성이나 임베딩 생성 후속 작업이
  운영상 실패해도 이미 저장된 confidence·importance·`num_times`를 되돌리지 않으며 실패는 관측
  가능해야 한다.
- 위 운영성 후속 실패는 원본 episodic 변환을 실패 상태로 바꾸거나 전체 semantic 갱신의 자동
  재시도를 예약하지 않는다. 관계 방향·타입 검증 오류는 기존 계약대로 호출자에게 전파한다.
- 신규 semantic 기본 항목과 그 KG 연결은 하나의 primary 저장 단위다. KG 쓰기 예외가 발생하면
  기본 항목도 되돌리고 해당 triple을 기록·제외한 뒤 다음 유효 triple을 처리한다. 기존 전역 SPO
  충돌로 현재 scope에 맞는 KG 대표를 얻지 못한 경우는 scoped fallback 대상이며 쓰기 실패로
  간주하지 않는다.
- 유사 후보 검색은 활성·scope·provenance·predicate 조건을 먼저 적용한다. 제외 후보에는 embedding
  비교를 수행하지 않고, 한 triple의 정규화된 subject·object 입력 embedding은 후보마다 다시
  계산하지 않는다.
- exact·유사 후보 조회가 실패하거나 적격 후보의 필수 similarity 증거가 없어 대상을 안정적으로
  결정할 수 없으면 이를 후보 없음으로 바꾸지 않는다. 해당 triple은 상태 변경 없이 운영 실패로
  제외하고 다음 triple을 처리한다. 적격 후보가 0건이면 정상적인 후보 없음으로 신규 생성할 수
  있다.
- 결과의 created·updated·semantic ID는 primary 저장이 커밋된 뒤에만 반영한다. rollback된 triple은
  skipped에 한 번만 반영하고 ID를 반환하지 않으며, 커밋 뒤 후속 관계·임베딩 실패가 발생한
  triple은 성공한 primary 변경으로 한 번만 집계한다.
- 다른 scope·사용자 작성·soft-delete 후보는 유사 후보 내용과 embedding을 읽기 전에 제외한다.
  전역 KG 대표는 자격 판정에 필요한 최소 식별·scope·구조 정보만 확인하고 부적격 대표의 content를
  비교나 로그에 사용하지 않는다.
- 제외·실패 로그와 호출자 오류에는 raw triple·semantic content·embedding을 포함하지 않는다.
  원본 memory ID, 묶음 내 triple 위치 및 정규화된 사유 코드만 사용하고 신규 감사 저장소는 만들지
  않는다.
- 운영 실패 때문에 primary 변경이 하나도 커밋되지 않은 묶음은 원본을 성공 처리하지 않는다.
  primary 변경이 하나라도 커밋된 뒤 나머지 triple이 운영 실패하면 원본은 성공 처리하고 기존
  로그로 부분 실패를 관측하되 전체 자동 재시도는 하지 않는다. 정책상 제외만 발생한 0건 묶음은
  운영 실패가 아니므로 정상 성공이다.
- 같은 SPO의 전역 KG 대표가 현재 scope에 부적합하면 새 scoped semantic은 해당 KG row의 대표권
  없이 생성될 수 있다. 이는 의도된 fallback이며, 해당 semantic은 이후 동일 scope 후보 검색으로
  발견되어야 한다. 새 KG row가 필요한 정상 경로의 쓰기 예외와 구분한다.
- 같은 scope의 동일 triple을 동시에 처음 생성해도 임시 semantic이나 중복 활성 semantic을 남기지
  않고 하나로 수렴한다. 각 독립 호출의 evidence occurrence는 승자 항목에 한 번씩 반영하며 별도
  전역 lock을 추가하지 않는다.
- 후보 선택 후 갱신 전 scope·활성·provenance 자격이 바뀌면 그 후보를 수정하지 않는다. 같은
  triple에서 한 번 다시 대상을 판정하고도 안전한 대상을 커밋하지 못하면 운영 실패로 제외한다.
- legacy semantic confidence가 NULL이면 Q-013을 적용하지만, non-NULL 값이 유한한 0~1 범위가
  아니면 손상 후보로 제외한다. 값을 clamp·초기화·backfill하지 않는다.
- 기존 semantic의 `num_times`가 양의 정수가 아니거나 다음 증가를 정확히 표현할 수 없으면 손상
  후보로 제외한다. 해당 값을 clamp·reset하거나 부정확한 평균을 저장하지 않는다.
- 서로 다른 episodic importance의 병합이 동시에 일어나면 primary 변경의 커밋 순서를 수락 순서로
  사용한다. 마지막으로 커밋된 occurrence의 episodic importance가 최종 importance의 원본값이며,
  별도 event timestamp 정렬이나 새로운 ordering 필드를 추가하지 않는다.
- commit 재검증에서 후보가 바뀌면 열린 transaction 안에서 embedding을 다시 계산하지 않는다.
  transaction 전체를 되돌려 닫고 기존 정규화·입력 embedding을 재사용할 수 있는 범위만 재사용해
  후보 상태와 비교 결과를 transaction 밖에서 한 번 새로 만든 뒤 별도 commit을 시도한다.
- 예약 batch의 시간 제한은 원본 처리 단위 사이에서만 새 작업 시작을 막는다. 이미 시작한 원본을
  중간 취소해 primary·source 상태 또는 후속 작업 정산이 불명확해지게 하지 않으며, 미시작 원본은
  processed·success·failed·skipped·retry 어느 수치에도 포함하지 않는다.
- batch의 각 episodic 원본은 독립 conversion commit unit이다. 한 원본의 추출·검증·commit·상태
  기록 실패가 다른 원본의 커밋 결과를 되돌리거나 남은 원본을 일괄 실패로 집계하지 않는다.
- semantic primary rollback 뒤 failure-state transaction까지 실패하면 persistence가 확인되지 않은
  retry 증가나 abandoned 전이를 결과에 보고하지 않는다. 원본은 직전 영속 상태로 남아 다음 선택을
  허용하고 현재 실행의 오류만 기존 batch·도구 결과와 로그에 남긴다.
- conversion commit 뒤 프로세스 종료는 이미 커밋된 성공을 되돌리지 않는다. 정상 반환한 호출에는
  FR-074의 후속 작업 정산을 요구하지만 비정상 종료 복구를 위한 신규 durable queue·reconciliation
  상태는 추가하지 않으며, 재시작 시 존재하지 않는 관계·embedding 결과를 성공으로 합성하지 않는다.
- 예약 batch의 `batchSize`는 retry backoff·상태·활성 조건을 통과한 원본에만 적용한다. 아직
  적격이 아닌 오래된 원본이 조회 순서 앞에 있어도 뒤의 적격 원본을 같은 실행에서 굶기지 않는다.
- failed 원본의 retry metadata가 명시적으로 존재하지만 JSON 객체·비음수 정수 retry count·유효
  시각·비음수 유한 backoff 계약을 만족하지 않으면 0이나 현재 시각으로 보정하지 않는다. metadata가
  없는 legacy failed 원본은 기존 최초 retry 의미를 유지한다.
- 저장된 `last_attempt`와 `next_retry_after_days`가 있으면 그 합이 retry due time이다. due time과
  현재 시각이 정확히 같으면 적격이고, 미래 `last_attempt`는 현재 실행에서 부적격으로 유지한다.
- batch 대상 목록은 추출 권한이 아니라 후보 snapshot이다. 각 원본은 deadline 확인 뒤 extractor
  호출 직전에 최신 source 자격과 의미 필드를 재검증하며 stale 후보는 상태 변경 없이 skipped로
  정산한다.
- `batchSize`·`chunkSize`·`maxRetries`는 양의 정수이고 `parallelism`은 정확히 1이어야 하며,
  `timeout`·`chunkDelayMs`는 비음수 유한값, `retryBackoffDays`는 비어 있지 않은 비음수 유한값
  배열이어야 한다. 0인 timeout·
  delay·backoff는 각각 새 원본 미시작·무지연·즉시 retry라는 명시적 경계값이다.
- `maxRetries`는 첫 자동 시도를 포함한 최대 실패 시도 수다. 첫 실패는 retry count 1이며 그 값이
  `maxRetries`에 도달하면 같은 실패 상태 commit에서 abandoned가 되어 추가 자동 시도를 만들지
  않는다.
- 실패 뒤 저장할 backoff는 새 retry count가 N이면 배열의 N-1 위치를 사용하고, 배열이 짧으면
  마지막 값을 반복한다. abandoned에는 다음 due time이 없으므로 `next_retry_after_days`를 남기지
  않는다.
- batch 적격 상태는 `triple_extracted`와 `triple_extracted_status`의 허용 조합으로 판정한다.
  완료·abandoned 조합은 정상 제외하고, 그 밖의 모순된 tuple과 알 수 없는 status는 성공·실패 중
  하나로 추정하거나 자동 보정하지 않고 limit 전에 제외해 기존 경고로 관측한다.
- chunk 사이 지연은 남은 timeout 예산을 넘겨 예약하지 않는다. 지연 중 deadline에 도달하면
  timeout을 기록하고 다음 chunk의 첫 원본을 시작하지 않으며, 완료된 원본과 미시작 원본의 기존
  집계 의미를 유지한다.
- 예약 batch는 실행 시작 시 resolved scalar 설정과 `retryBackoffDays` 값 배열을 복사·검증한
  immutable snapshot만 대상 선택·처리·상태 기록·관측에 사용한다. 실행 중 외부 mutation을
  감지하거나 범용 deep clone·설정 버전 저장소를 추가하지 않는다.
- 예약 batch의 `parallelism`은 이번 기능에서 정확히 1만 지원한다. 1보다 큰 값을 무시해 직렬로
  실행하거나 원본·chunk 내부 병렬 실행을 도입하지 않으며, 중첩 execute의 안전성은 기존 단일 승자
  commit 계약으로만 보장한다.
- 한 execute가 처리할 후보는 적격성 선필터와 `batchSize` 적용 뒤 확정한 순서 있는 목록으로
  고정한다. stale·skipped·timeout으로 빈 자리가 생겨도 보충 조회하지 않고, 실행 중 새로 생성되거나
  due가 된 원본은 다음 execute까지 기다린다.
- chunk는 확정 후보 목록을 순서대로 최대 `chunkSize`개의 연속 구간으로 나눈다. 마지막 chunk는
  더 작을 수 있고, 후보가 `chunkSize`보다 적으면 한 chunk이며, 후보가 없으면 chunk도 없다.
- retry 적격성의 기준 wall-clock 시각은 execute 시작 시 한 번 고정하고 timeout은 단조 경과시간
  예산으로 판단한다. 각 source 상태 전이 metadata의 시각은 해당 전이에서 캡처한 동일 UTC 시각을
  재사용하며 시스템 clock jump로 현재 실행의 대상·deadline을 다시 계산하지 않는다.
- batch-level `success`는 원본별 품질 성공률이 아니라 실행이 하나 이상의 원본을 종결 처리했는지를
  나타내는 기존 의미를 유지한다. processed가 0이거나 job-level 치명 오류이면 false이고, 치명 오류가
  없으며 processed가 양수이면 모든 원본이 failed·skipped여도 true이며 세부 결과는 기존 카운트와
  오류로 구분한다.
- 선택적 batch 설정은 미제공 또는 `undefined`일 때만 기존 기본값을 사용한다. 명시된 `null`·boolean·
  숫자 문자열·잘못된 컨테이너와 sparse backoff 배열은 기본값이나 coercion으로 숨기지 않는다.
- `timeout`과 `chunkDelayMs`는 밀리초, `retryBackoffDays`는 24시간 단위다. 유효한 소수 기간은
  반올림하지 않고 계산하며, timezone 없는 시각·표현 범위를 넘는 due time은 손상 metadata로
  비파괴 격리한다.
- batch source의 content는 비공백 문자열이어야 하고 non-NULL importance는 유한한 0~1 값이어야
  한다. NULL importance만 기존 기본값 0.5를 사용하며 손상값은 extractor 전에 실패·retry로 정산한다.
- source 상태 metadata는 success·failed·abandoned별 정규 형태로 전체 교체한다. 이전 상태 전용
  키를 병합해 남기지 않으며 기존 성공 원본의 실패한 강제 재처리는 원래 metadata를 그대로 보존한다.
- source 단위로 격리할 수 없는 chunk·job 오류는 치명 오류다. 이미 종결된 prefix만 결과에 남기고
  현재 미확정·미시작 원본을 failed·processed로 합성하지 않으며 실행을 즉시 중단한다.
- `endTime`과 `duration`은 시작한 원본의 정산과 치명 오류 포착이 끝난 실제 반환 경계에서 한 번
  확정한다. deadline을 넘긴 사실만으로 timeout을 만들지 않고 새 원본·chunk 시작이 실제로 막힌
  경우에만 `timeoutOccurred`를 true로 남긴다.
- batch `retryCounts`는 현재 execute에서 failed 또는 abandoned 상태 전이가 durable commit된
  source만 포함한다. 성공·stale skipped·정책 제외·상태 기록 실패·치명 오류의 미확정 source에는
  retry 값을 합성하지 않는다.
- count·limit에 쓰는 runtime 값과 persisted retry count는 안전 정수 범위를 만족해야 한다. 현재
  설정의 `maxRetries` 이상인 기존 failed count는 자동 abandoned로 고치지 않고 비파괴 격리한다.
- 같은 job 인스턴스의 겹친 execute는 설정·시계·candidate set·result accumulator를 공유하지 않는다.
  동일 source 경쟁만 기존 conversion 단일 승자 계약으로 수렴시키고 전역 execute mutex를 추가하지
  않는다.
- batch의 semantic created·updated는 고유 최종 row 수가 아니라 commit된 primary outcome occurrence의
  합이다. rollback·미확정 source는 제외하고 같은 semantic의 후속 source 갱신은 별도 updated로 센다.
- 모든 반환 경로에서 top-level `processed`, `details.processed`와 세 source outcome 합은 서로
  대사되어야 한다. job-level 치명 오류가 prefix를 보존하더라도 미확정 source를 숫자에 합성하지 않는다.
- job 인스턴스를 다른 DB handle로 재사용해도 lazily 만든 DB-bound semantic service를 다른 실행에
  재사용하지 않는다. 명시적으로 주입된 service의 DB 정합성은 호출자가 보장한다.
- batch 설정 검증은 schema 준비를 포함한 DB 접근보다 먼저 수행한다. 이후 schema 준비·DB-bound
  service 생성·대상 조회 실패는 processed 0의 job-level 치명 오류이며 source 실패로 바꾸지 않는다.
- extractor 결과가 malformed이면 빈 결과로 축소하지 않고 기존 `llm_parse_fail`로 정산한다. 실제
  빈 triple 배열만 허용된 failure reason 또는 기본 `no_triple`로 retry하며 raw output은 영속·반환하지 않는다.
- 반환 결과의 Date·배열·Map은 execute마다 새 컨테이너다. 호출자의 반환값 mutation은 job 내부
  상태나 이후·겹친 execute 결과를 바꾸지 않는다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 자동 추출 triple마다 저장 여부를 판단하기 전에 단 하나의 confidence를
  계산해야 하며, 그 값은 0~1 범위여야 한다.
- **FR-002**: triple은 confidence가 기본 저장 하한 0.7보다 클 때만 저장할 수 있다. 0.7 이하인
  triple은 semantic memory 생성, 기존 항목 갱신, importance 가산, aggregate confidence 갱신 및
  반복 횟수 증가에서 모두 제외되어야 한다.
- **FR-003**: 사용자 지정 저장 하한이 적용되어도 confidence가 하한과 같으면 제외하고, 하한보다
  큰 경우에만 저장해야 한다.
- **FR-004**: 수락된 신규 semantic memory는 계산된 confidence를 비어 있지 않은 값으로
  저장해야 한다.
- **FR-005**: 수락된 기존 semantic memory 갱신은 정확한 triple 중복과 유사 중복 모두에서 기존
  aggregate confidence와 새 confidence를 수락된 증거 수로 가중한 평균을 저장해야 한다. 각
  수락된 증거는 동일한 가중치를 가지며, 기존 confidence가 비어 있으면 새 confidence로
  초기화해야 한다. 이때 첫 새 confidence를 기존 `num_times` 전체와 새 증거의 대표값으로 간주해
  별도 측정 개수 없이 이후 평균을 누적할 수 있어야 한다.
- **FR-006**: boost 전 semantic importance는 가장 최근에 수락된 episodic importance와 aggregate
  confidence의 곱이어야 한다. 별도 가중 계수, 과거 episodic importance 집계 또는 confidence
  구간별 상한을 추가하지 않아야 한다.
- **FR-007**: 양의 원본 importance와 반복 횟수가 같을 때 confidence가 낮은 semantic memory의
  importance는 confidence가 높은 항목보다 반드시 낮아야 한다.
- **FR-008**: 반복 증거 boost는 새 증거를 반영한 aggregate confidence가 정확히 1이고 boost 전
  importance가 양수인 semantic memory에만 적용해야 한다. aggregate confidence가 1보다 작으면
  boost를 적용하지 않으며, 원본 episodic importance가 양수이면 최종 importance는 그 원본값보다
  낮아야 한다.
- **FR-009**: importance는 모든 입력에서 0~1 범위로 제한되어야 한다.
- **FR-010**: confidence 영속화와 importance 게이트는 신규 생성, 정확한 triple 중복, 유사 중복의
  세 경로에서 동일한 계약을 지켜야 한다.
- **FR-011**: 기존 관계 confidence, semantic 내용, triple 정규화 결과, 관계 방향 및 임베딩 생성
  동작은 변경되지 않아야 한다.
- **FR-012**: 구현 전에 정상·canonicalization 실패·부분 entity-link 표본의 confidence,
  원본 importance, 최종 importance 및 저장 결과 분포를 비교하고 정책 선택 근거를 남겨야 한다.
- **FR-013**: 기존 confidence가 비어 있는 historical semantic memory는 이번 변경에서 일괄
  보정하거나 삭제하지 않아야 한다.
- **FR-014**: `num_times`는 수락된 증거 수의 단일 출처여야 한다. 신규 semantic memory는 첫
  증거를 1로 반영하고, 이후 수락된 증거 occurrence마다 정확히 1 증가해야 한다. 같은 원본·호출에서
  같은 semantic memory로 귀결된 입력은 하나의 occurrence로 계산하며, semantic 병합은 실제 검색
  사용량을 뜻하는 `recall_count`를 변경하지 않아야 한다.
- **FR-015**: 수락된 semantic 생성·갱신 후 관계 방향·타입 검증 오류가 아닌 출처 관계 또는
  임베딩 생성이 운영상 실패해도 저장된 confidence·importance·`num_times`를 유지해야 하며, 후속
  실패를 기존 관측 경로에 기록해야 한다.
- **FR-016**: 제외된 triple은 기존 skipped 통계와 구조화 로그로 관측해야 한다. confidence 구간별
  상시 텔레메트리, 신규 감사 저장소 또는 제외 원문 영속화를 추가하지 않아야 한다.
- **FR-017**: 같은 semantic memory에 대한 동시 병합은 각 수락 증거의 confidence와 `num_times`
  증가를 원자적으로 반영해야 한다. 이를 위해 서로 다른 semantic memory의 갱신까지 전역
  직렬화하지 않아야 한다.
- **FR-018**: 운영 분포 검증은 읽기 전용 조회로 수행하고 저장소에는 집계 수치·식별자·해시만
  기록해야 한다. 자동 검증에 필요한 입력은 합성 픽스처여야 하며 운영 원문이나 파생 코퍼스를
  커밋하지 않아야 한다.
- **FR-019**: 원본 episodic importance가 제공되지 않은 경우에만 기존 기본값 0.5를 사용해야 한다.
  명시적인 0은 신규·정확한 중복·유사 중복 경로 모두에서 0으로 보존하고 confidence 곱이나 반복
  boost가 최종 importance를 양수로 만들지 않아야 한다.
- **FR-020**: 사용자 지정 confidence 저장 하한은 유한한 0~1 값이어야 한다. 범위를 벗어나거나
  유한하지 않은 값은 처리 묶음의 첫 semantic memory 생성·갱신 전에 검증 오류로 거부하고 어떤
  memory 상태도 변경하지 않아야 한다.
- **FR-021**: 계산된 confidence는 저장 하한 비교 전에 유한한 0~1 값인지 확인해야 한다. 유효하지
  않은 confidence의 triple은 생성·갱신·importance·aggregate confidence·`num_times` 변경에서
  제외하고 기존 skipped 통계와 구조화 로그에 기록하되, 같은 묶음의 유효 triple 처리는 계속해야
  한다.
- **FR-022**: 제공된 episodic importance는 유한한 0~1 값이어야 한다. 유효하지 않은 값은 기본값으로
  대체하거나 clamp하지 않고 처리 묶음의 첫 semantic 변경 전에 전체 요청을 검증 오류로 거부해야
  한다.
- **FR-023**: semantic 저장 뒤 관계 방향·타입 검증 오류가 아닌 관계 또는 임베딩 생성의 운영성
  실패가 발생해도 원본 episodic 변환은 성공으로 완료해야 하며, 이미 반영한 semantic 증거를
  포함한 전체 갱신을 자동 재시도 대상으로 표시하지 않아야 한다. 관계 방향·타입 검증 오류의
  기존 전파 동작은 변경하지 않아야 한다.
- **FR-024**: 기존 명시적 강제 재처리 기능은 호환성을 유지해야 한다. 호출자가 이미 성공한 원본을
  강제로 다시 처리하면 각 호출을 새 수락 처리로 간주하는 기존 의미를 유지하며, 이번 기능에서
  별도 idempotency key나 증거 대체 의미를 추가하지 않아야 한다.
- **FR-025**: 새 자동 semantic memory는 원본 episodic memory의 `owner_id`와 `project_id`를
  상속해야 하며, 기존 동작대로 `privacy_scope='private'`를 유지해야 한다. 공개 입력이나 신규
  스키마 필드를 추가하지 않아야 한다.
- **FR-026**: 정확한 중복과 유사 중복 후보는 원본 episodic memory와 `owner_id`·`project_id`가
  각각 null-safe 동등하고, 자동 추출 provenance가 확인되는 semantic memory로 제한해야 한다.
  owner/project가 다른 항목 또는 사용자 작성 항목의 confidence·importance·`num_times`를 변경하지
  않아야 한다.
- **FR-027**: 새 자동 semantic memory는 기존 `origin_source` 필드에 자동 추출 도구와 원본
  episodic memory 식별자를 기록해야 한다. 병합 시 대표 semantic의 기존 provenance를 덮어쓰지
  않고, 개별 증거 출처는 기존 관계로 유지해야 한다.
- **FR-028**: `origin_source`가 비어 있는 legacy semantic memory는 기존 `extracted_from` 관계가
  하나 이상 있을 때만 자동 추출 병합 대상으로 인정해야 한다. 자동 생성 근거가 없는 legacy
  항목은 추정·backfill하거나 갱신하지 않아야 한다.
- **FR-029**: 정확한 KG triple의 대표 memory가 semantic이 아니거나 scope·provenance 조건을
  만족하지 않으면 그 대표 항목을 갱신하지 않고, 동일 scope의 자동 semantic 유사 후보 검색과
  필요 시 신규 생성으로 계속 진행해야 한다.
- **FR-030**: soft-delete된 semantic memory는 정확한 KG 대표 또는 유사 중복 후보에서 제외해야
  한다. 삭제 행의 confidence·importance·`num_times`·`is_deleted`를 변경하지 않고 동일 scope의
  활성 자동 semantic 후보 검색과 필요 시 신규 생성으로 계속해야 한다.
- **FR-031**: 처리 묶음을 시작하기 전에 원본 memory가 존재하고 type이 episodic이며 soft-delete되지
  않았는지 검증해야 한다. 검증 실패는 어떤 confidence 계산이나 semantic·관계 상태 변경보다 먼저
  전체 요청을 거부해야 한다.
- **FR-032**: 원본 episodic memory의 `owner_id`·`project_id`·활성 상태는 처리 묶음 시작 시 한 번
  읽은 snapshot을 모든 triple의 생성·중복 판정에 일관되게 사용해야 한다. 한 묶음 안에서 scope가
  섞이지 않아야 한다. 이 snapshot이 commit 전에 바뀐 경우의 처리는 FR-084를 적용해야 한다.
- **FR-033**: semantic 갱신 서비스가 받은 추출 결과의 triple 목록이 비어 있으면 원본 episodic
  조회·검증, confidence 계산 및 어떤 상태 변경도 수행하지 않고 기존의 created·updated·skipped가
  모두 0인 결과를 반환해야 한다. 자동 episodic 변환 경계의 상태 의미는 FR-078을 적용해야 한다.
- **FR-034**: subject·predicate·object 중 하나라도 비어 있는 legacy semantic memory는 exact·유사
  중복 후보에서 제외해야 한다. 손상 후보 때문에 유효 triple 전체를 실패시키지 않고 다른 후보
  검색 또는 신규 생성으로 계속해야 한다.
- **FR-035**: KG 대표 semantic의 저장된 subject·predicate·object가 조회에 사용한 정규화 KG key와
  일치하지 않으면 stale 대표로 간주해 갱신하지 않아야 한다. 동일 scope의 활성 자동 semantic
  검색과 필요 시 신규 생성으로 계속해야 한다.
- **FR-036**: 병합 후보 선택은 exact 구조 일치를 유사 일치보다 우선해야 한다. 같은 우선순위의
  적격 후보가 여러 개면 `created_at` 오름차순, 그다음 ID 오름차순으로 하나를 결정해 동일한 DB
  상태와 입력에서 항상 같은 semantic memory를 선택해야 한다.
- **FR-037**: aggregate confidence가 한 번이라도 1보다 작아지면 이후 confidence 1 증거를 병합해도
  수치 반올림 때문에 정확히 1로 저장되어서는 안 된다. 수학적 평균이 1보다 작은 동안 저장값도
  표현 가능한 1 미만이어야 하며 반복 boost 자격을 회복하지 않아야 한다.
- **FR-038**: 새 KG row를 등록하는 신규 semantic 경로에서는 기본 항목과 KG 연결 저장을 하나의
  원자적 primary 저장 단위로 처리해야 한다. KG 쓰기 예외가 발생하면 신규 기본 항목을 되돌리고
  해당 triple을 기존 관측 경로에 기록·제외한 뒤 같은 묶음의 다음 유효 triple을 처리해야 한다.
  기존 전역 SPO 대표가 현재 scope에 부적합한 경우는 쓰기 예외나 고아 항목으로 간주하지 않고
  FR-029와 FR-047의 KG 대표권 없는 scoped fallback을 사용해야 한다.
- **FR-039**: 한 episodic 처리 묶음에서 정규화된 subject·predicate·object가 같은 수락 triple은
  하나의 증거 occurrence로 합쳐야 한다. 합쳐진 입력 중 가장 높은 confidence를 대표값으로
  선택하고, 동률이면 입력 순서가 가장 앞선 triple을 선택해야 한다.
- **FR-040**: 한 episodic 처리 묶음의 서로 다른 수락 triple이 exact 또는 유사 판정 뒤 같은
  semantic memory로 귀결되면 해당 semantic에는 confidence·importance·`num_times`를 한 번만
  반영해야 한다. 대표 triple의 관계 메타데이터를 사용하고 결과 ID도 한 번만 반환하며, 합쳐진
  나머지는 신규 저장소 없이 기존 duplicate 통계로 관측해야 한다.
- **FR-041**: 유사 후보는 활성 상태, 원본과 null-safe하게 같은 owner/project, 자동 provenance 및
  predicate 조건을 embedding 비교 전에 만족해야 한다. 정규화된 입력 subject·object embedding은
  한 triple 처리 안에서 각각 최대 한 번 계산해 모든 적격 후보 비교에 재사용해야 하며, 별도
  영속 캐시·신규 의존성·스키마 변경을 추가하지 않아야 한다.
- **FR-042**: exact·유사 후보 조회가 운영상 실패하거나 적격 후보의 필수 similarity 증거를 얻지
  못해 병합 대상을 결정할 수 없으면 그 상태를 후보 없음 또는 불일치로 간주해서는 안 된다. 해당
  triple은 semantic·KG·관계 상태를 변경하지 않고 기존 관측 경로에 운영 실패로 기록·제외한 뒤
  다음 유효 triple을 처리해야 한다. 적격 후보가 실제로 0건인 경우만 신규 생성으로 진행할 수 있다.
- **FR-043**: 처리 결과의 `created`·`updated`·`skipped` 및 semantic ID는 primary 저장 결과와
  일치해야 한다. 커밋된 생성·갱신만 해당 성공 수치와 고유 ID에 한 번 반영하고, triple 단위
  rollback 또는 pre-primary 운영 실패는 `skipped`에 한 번 반영하며 성공 수치나 ID에 포함하지
  않아야 한다. primary 커밋 뒤 후속 관계·임베딩 실패는 이미 성공한 primary 변경으로 한 번만
  집계해야 한다. 원본·공통 입력 검증 오류의 요청 전체 거부 계약은 변경하지 않아야 한다.
- **FR-044**: 유사 후보 발견은 활성·동일 owner/project·자동 provenance·predicate 조건을 후보의
  semantic content 또는 embedding에 접근하기 전에 적용해야 한다. 전역 KG 대표가 이 조건을
  만족하지 않으면 자격 검증에 필요한 최소 식별·scope·구조 정보 외의 content를 읽거나 비교·로그에
  사용하지 않아야 하며 FR-029의 scoped fallback으로 계속해야 한다.
- **FR-045**: 제외·실패를 위한 신규 또는 수정 구조화 로그와 호출자 오류는 raw subject·predicate·
  object·semantic content·embedding을 포함하지 않아야 한다. 기존 원본 memory ID, 묶음 내 입력
  위치와 정규화된 사유만 사용하고 신규 로그 저장소나 원문 hash 저장을 추가하지 않아야 한다.
- **FR-046**: 원본·공통 입력 검증을 통과한 뒤 정책상 제외가 아닌 운영 실패로 primary semantic
  변경이 하나도 커밋되지 않은 묶음은 원본 episodic 변환을 성공으로 표시하지 않아야 한다. 하나
  이상의 primary 변경이 커밋된 묶음은 이후 일부 triple의 pre-primary 또는 후속 운영 실패가 있어도
  성공 상태와 전체 자동 재시도 금지를 유지하고 부분 실패를 기존 관측 경로에 남겨야 한다. 저장
  하한 등 정책상 제외만 있는 묶음은 정상 성공으로 처리해야 한다. primary가 0건인 입력·운영 실패와
  정책 제외의 구체적 분류는 FR-085를 적용해야 한다.
- **FR-047**: 동일 SPO의 전역 KG 대표가 현재 scope·활성·자동 provenance·유효한 구조 및 집계값
  조건을 만족하지 않으면 현재 scope의 신규 자동 semantic은 기존 KG row의 대표권 없이 커밋할 수
  있어야 한다. 이 항목은 이후 동일 scope의 구조·유사 후보 검색으로 다시 발견되어야 하며, 부적격
  전역 대표를 교체하거나 신규 KG row·스키마를 만들지 않아야 한다.
- **FR-048**: 같은 scope의 동일 정규화 triple에 대한 동시 최초 생성은 하나의 활성 자동 semantic
  memory로 수렴해야 한다. 생성 경쟁에서 채택되지 않은 임시 항목은 커밋하지 않고 각 독립 evidence
  occurrence를 채택된 항목의 confidence·importance·`num_times`에 원자적으로 한 번씩 반영해야 한다.
  서로 다른 semantic 생성까지 직렬화하는 신규 전역 lock을 추가하지 않아야 한다.
- **FR-049**: 병합 대상의 활성 상태·owner/project·자동 provenance·구조 일치 자격은 갱신과 같은
  원자적 조건으로 확인해야 한다. 선택 후 자격이 바뀌어 갱신이 적용되지 않으면 동일 triple의 후보
  판정을 최대 한 번 다시 수행하고, 그래도 적격 대상을 안전하게 커밋하지 못하면 해당 triple을
  운영 실패로 제외해야 한다.
- **FR-050**: 기존 자동 semantic의 non-NULL confidence가 유한한 0~1 값이 아니면 exact·유사 병합
  후보에서 제외해야 한다. 손상 행의 confidence·importance·`num_times`를 변경하거나 값을 clamp·
  초기화·backfill하지 않고 다른 적격 후보 검색 또는 신규 생성으로 계속해야 한다. NULL 값에는
  FR-005와 Q-013의 legacy 초기화 계약을 적용해야 한다.
- **FR-051**: 기존 자동 semantic의 `num_times`가 양의 정수가 아니거나 다음 값을 정확히 표현할 수
  없으면 exact·유사 병합 후보에서 제외해야 한다. 손상 값을 clamp·reset하거나 부정확한 aggregate
  confidence를 저장하지 않고 다른 적격 후보 검색 또는 신규 생성으로 계속해야 한다.
- **FR-052**: 서로 다른 episodic importance를 가진 독립 evidence occurrence가 같은 semantic에
  동시에 병합되면 primary 변경의 커밋 순서를 수락 순서로 사용해야 한다. 각 원자적 갱신은 자신의
  episodic importance로 importance를 계산하고, 마지막으로 커밋된 occurrence의 값이 최종 원본
  importance가 되어야 한다. 별도 event-time 정렬 필드나 timestamp 비교를 추가하지 않아야 한다.
- **FR-053**: 비어 있지 않은 triple 묶음의 사용자 지정 similarity threshold는 유한한 0~1 값이어야
  한다. 범위를 벗어나거나 유한하지 않은 값은 원본 조회와 어떤 confidence 계산·상태 변경보다 먼저
  전체 요청을 검증 오류로 거부하고 clamp하거나 기본값으로 대체하지 않아야 한다. 빈 triple 묶음에는
  FR-033의 no-op 계약을 우선 적용해야 한다.
- **FR-054**: 유사도 비교는 유효한 similarity score가 threshold 이상일 때 일치로 판정해야 한다.
  score가 threshold와 같으면 포함하며, threshold 0은 모든 유효한 0~1 score를, threshold 1은
  정확히 1인 score만 일치로 인정해야 한다. exact 구조 일치의 우선순위는 FR-036대로 유지해야 한다.
- **FR-055**: 계산된 similarity score는 threshold 비교 전에 유한한 0~1 값인지 확인해야 한다.
  유효하지 않은 score를 clamp하거나 불일치로 간주해서는 안 되며, 그 때문에 적격 후보의 병합
  대상을 안전하게 결정할 수 없으면 FR-042의 판정 불가 계약에 따라 해당 triple을 상태 변경 없이
  기록·제외하고 다음 유효 triple을 처리해야 한다.
- **FR-056**: 추출 triple의 subject·predicate·object는 각각 문자열이어야 하며 정규화 후 하나
  이상의 비공백 문자를 가져야 한다. 하나라도 조건을 만족하지 않으면 해당 triple을 후보 조회,
  embedding 계산 및 상태 변경 전에 기존 관측 경로로 기록·제외하고 다음 유효 triple을 처리해야
  한다. raw 입력값 강제 변환이나 정규화 전 값으로의 fallback을 KG 식별 또는 저장에 사용하지
  않아야 한다.
- **FR-057**: 자동 semantic 갱신의 추출 결과는 객체이고 `triples`는 배열이어야 한다. 이 계약을
  만족하지 않으면 빈 배열로 보정하지 않고 원본 조회·통계 기록·상태 변경 전에 전체 요청을 검증
  오류로 거부해야 한다. 유효한 실제 빈 배열에는 FR-033의 no-op 계약을 적용해야 한다.
- **FR-058**: 각 입력 triple의 predicate canonicalization과 subject·object entity linking 결과는
  해당 triple 처리에서 각각 한 번 산출한 단일 정규화 snapshot이어야 한다. confidence 계산,
  exact·유사 후보 판정, KG key, semantic content와 구조화 필드 저장은 그 snapshot을 재사용해야
  하며, 호출 간 캐시나 신규 영속 상태를 추가하지 않아야 한다.
- **FR-059**: canonicalization·entity linking이 예외를 내거나 정규화 snapshot의 subject·predicate·
  object 중 하나가 문자열이 아니거나 비어 있으면 해당 triple을 후보 조회·embedding·상태 변경
  전에 기존 관측 경로로 기록·제외해야 한다. 부분 정규화 값, raw 값 또는 강제 변환값으로 처리를
  재개하지 않고 같은 묶음의 다음 유효 triple은 계속 처리해야 한다.
- **FR-060**: 한 처리 묶음의 유효 occurrence는 FR-039·FR-040의 coalescing을 마친 뒤 각 대상의
  가장 이른 원본 입력 위치 오름차순으로 primary 변경을 적용하고 고유 semantic ID를 반환해야 한다.
  묶음 내부 작업 완료 순서가 결과를 바꾸지 않아야 하며, 이를 위해 한 묶음의 primary 변경을
  병렬화하지 않아야 한다. 서로 다른 호출의 항목별 동시성 계약은 FR-017을 유지해야 한다.
- **FR-061**: 유효한 비공백 canonicalization 또는 entity-linking 결과와 `success=false`가 함께
  반환되면 이를 낮은 품질의 정상 snapshot으로 취급해야 한다. 반환값은 KG 식별과 저장에 사용할 수
  있고 success flag는 같은 snapshot에서 confidence 감점에 사용해야 하며, failure flag만으로
  FR-059의 운영 실패 격리를 적용해서는 안 된다. 예외·비문자열·빈 결과에는 FR-059를 적용해야 한다.
- **FR-062**: 비어 있지 않은 triple 목록의 `extractionInfo`는 객체이고 `steps.canonicalization`과
  `steps.entityLinking`은 boolean이어야 한다. 이 계약을 만족하지 않으면 원본 조회·confidence 계산·
  통계 기록·상태 변경 전에 전체 요청을 검증 오류로 거부해야 한다. 실제 빈 배열에는 FR-033을
  우선 적용하고, batch 수준 `steps`를 개별 triple confidence 대신 사용하지 않아야 한다.
- **FR-063**: 기존 confidence 분포 통계에는 유효한 정규화 snapshot에서 계산된 각 원본 입력
  triple의 confidence를 정확히 한 번 기록해야 한다. 저장 하한 제외, coalescing 또는 confidence
  계산 뒤 발생한 운영 실패도 계산값을 표본에서 빼지 않아야 하며, confidence 계산 전에 실패한
  입력에는 값을 합성하거나 기록하지 않아야 한다. 신규 영속 텔레메트리는 추가하지 않아야 한다.
- **FR-064**: 비어 있지 않은 유효 요청의 각 원본 triple 위치는 created·updated·skipped·duplicate
  중 정확히 하나로 분류해야 하며 합계는 원본 triple 수와 같아야 한다. coalesced 그룹은 대표의
  primary 커밋 결과 또는 대표 단위 skipped 한 건과 나머지 duplicate로 계산하고, duplicate는
  대표의 커밋 성공 여부와 무관하게 중복 제거된 입력을 뜻해야 한다. 공개 결과 필드는 변경하지
  않고 기존 내부 duplicate 통계를 사용해야 한다.
- **FR-065**: 실제 빈 triple 배열의 FR-033 no-op을 적용한 뒤, 비어 있지 않은 요청은
  `episodicMemoryId`, episodic importance의 제공 여부와 값, confidence 저장 하한 및 similarity
  하한을 한 번 캡처한 immutable invocation policy snapshot으로 검증·처리해야 한다. 같은 호출의
  모든 triple은 그 snapshot만 사용하고 원본 옵션 객체의 후속 변경은 다음 호출부터만 반영해야
  하며 신규 전역 설정이나 영속 snapshot을 추가하지 않아야 한다.
- **FR-066**: 기존 통계·구조화 로그 같은 관측 부수효과의 실패는 primary 커밋, 원본 위치별 outcome,
  반환 semantic ID, 원본 episodic 성공 상태 또는 전체 재시도 여부를 변경해서는 안 된다. 관측
  실패가 이미 발생한 원래 처리 예외를 대체해서도 안 되며, 이를 위한 신규 영속 로그·재시도 큐·
  공개 상태 필드를 추가하지 않아야 한다.
- **FR-067**: 원본과 자동 semantic 대상의 타입으로 결정 가능한 관계 방향·타입 계약은 비어 있지
  않은 요청의 첫 primary 변경 전에 검증해야 하고 실패 시 기존 계약 오류를 상태 변경 없이
  전파해야 한다. 검증을 통과한 관계 생성과 임베딩 생성은 primary 커밋 뒤 서로 독립적인 후속
  작업으로 취급하며 완료 순서를 보장하지 않고, 어느 한쪽의 운영 실패도 다른 후속 작업이나 이미
  확정한 primary outcome을 취소해서는 안 된다.
- **FR-068**: `semanticMemoryIds`는 created 또는 updated primary outcome이 하나 이상 커밋된 고유
  semantic 대상만 포함해야 한다. 각 ID는 그 대상의 첫 성공 원본 위치 순으로 정확히 한 번
  반환하고 rollback·pre-primary 실패·skipped·duplicate만 가진 입력은 ID를 추가하지 않아야 한다.
  primary 커밋 뒤 후속 실패는 이미 포함된 ID를 제거하거나 중복 추가하지 않아야 한다.
- **FR-069**: primary 커밋 뒤 `extracted_from`과 `supported_by` 관계는 방향별로 독립적으로 생성을
  시도해야 한다. 이미 존재하는 동일 관계는 성공한 no-op으로 취급하고, 한 방향의 운영 실패가 다른
  방향의 시도·성공이나 primary outcome을 막아서는 안 된다. 방향별 실패는 raw triple 없이 기존
  관측 경로에 남기며 관계 쌍 원자화·영속 reconciliation 작업을 추가하지 않아야 한다.
- **FR-070**: 비어 있지 않은 `triples` 배열의 각 원본 위치는 non-null non-array 객체여야 한다.
  sparse 위치나 `null`·배열·기타 비객체 값은 해당 위치를 confidence 계산·후보 조회·상태 변경 전에
  skipped로 한 번 분류하고 나머지 위치를 계속 처리해야 한다. 값을 객체로 강제 변환하거나 전체
  요청 오류로 승격하지 않아야 한다.
- **FR-071**: 실제 빈 triple 배열의 no-op 뒤 비어 있지 않은 요청에서 `episodicMemoryId`는 비공백
  문자열이어야 한다. `episodicImportance`·confidence 저장 하한·similarity 하한은 미제공 또는
  `undefined`일 때만 기존 기본값을 사용하며, 제공된 `null`·boolean·숫자 문자열·기타 비숫자 값은
  변환 없이 원본 조회 전에 전체 요청을 검증 오류로 거부해야 한다. 수치 범위는 FR-020·FR-022·
  FR-053을 적용해야 한다.
- **FR-072**: 비어 있지 않은 요청은 container·metadata 검증 뒤 개별 triple 처리를 시작하기 전에 원본 triple
  배열의 길이와 순서, 각 위치의 subject·predicate·object 및 처리에 필요한 extraction metadata를
  값 snapshot으로 캡처해야 한다. 같은 호출의 confidence·coalescing·관계 metadata·outcome 대사는
  이 snapshot만 사용하고 외부 변경은 다음 호출부터만 반영해야 한다. 사용하지 않는 입력 필드의
  범용 deep clone이나 영속 snapshot은 추가하지 않아야 한다.
- **FR-073**: 이미 존재하는 동일 source·target·relation type의 `extracted_from` 또는 `supported_by`
  관계와 동시 생성 경쟁의 duplicate constraint는 성공한 no-op으로 처리해야 한다. 기존 관계의
  confidence·metadata·생성시각을 갱신하거나 duplicate를 방향별 운영 실패로 집계하지 않아야 하며,
  관계 occurrence 이력·버전 필드를 추가하지 않아야 한다.
- **FR-074**: primary 커밋 뒤 예정된 관계와 임베딩 후속 작업은 서로의 성공에 의존하지 않고 모두
  시도해야 하되, semantic 갱신 호출은 각 작업이 성공 또는 실패로 정산된 뒤 반환해야 한다. 완료
  순서는 보장하지 않으며 detached 후속 실행, 신규 작업 큐 또는 후속 결과 공개 필드를 추가하지
  않아야 한다.
- **FR-075**: 비어 있지 않은 triple 목록의 선택적 `extractionInfo.failureReason`은 미제공·
  `undefined` 또는 기존 `TripleExtractionFailureReason`에 정의된 문자열 코드여야 한다. 알 수 없는
  문자열과 비문자열 값은 원본 조회·confidence·통계·상태 변경 전에 전체 요청을 검증 오류로
  거부해야 한다. `rawLLMOutput`은 semantic 갱신 입력 snapshot, 관계 metadata, DB 또는 이 기능이
  추가·수정하는 로그에 포함하지 않아야 하며 실제 빈 배열에는 FR-033을 우선 적용해야 한다.
- **FR-076**: 원본 episodic 한 건의 자동 변환 워크플로는 해당 원본에서 수락된 모든 semantic
  primary 변경과 원본의 성공 상태 전환을 같은 DB 커밋 단위로 확정해야 한다.
  성공 상태 기록이 실패하면 해당 원본의 primary 변경, created·updated 수치와 반환 semantic ID를
  모두 되돌려야 한다. 아직 성공하지 않은 정상 자동 변환 원본은 실패 상태로 남겨 안전한 전체
  재시도를 허용하고, 기존 성공 원본의 강제 재처리 실패는 FR-081을 적용해야 한다. 관계·임베딩
  후속 작업은 이 커밋 뒤 FR-067·FR-069·FR-074에 따라 실행하며 분산 트랜잭션이나 신규 idempotency
  저장소를 추가하지 않아야 한다.
- **FR-077**: FR-076의 원본 성공 상태 전환은 기존 `triple_extracted=1`,
  `triple_extracted_status='success'` 및 `triple_extraction_metadata`를 하나의 row 변경으로
  확정해야 한다. metadata의 기존 `triple_count`는 원본 입력 위치 수를 유지하고,
  `confidence_avg`는 현재 호출에서 primary 커밋된 coalesced evidence occurrence의 confidence만
  산술 평균하며 수락 occurrence가 없으면 생략해야 한다. 이 값은 커밋 뒤 관계 행에서 재구성하지
  않아야 하며 성공 수치와 semantic ID는 commit 성공 뒤에만 외부 결과에 반영해야 한다.
- **FR-078**: 실제 빈 `triples` 배열은 semantic 갱신 서비스 경계에서는 FR-033의 조회·변경 없는
  0건 no-op이어야 한다. 자동 episodic 변환 워크플로는 semantic 갱신 서비스를 호출하지 않고
  기존 `no_triple` 실패 상태와 retry metadata를 기록해야 하며 semantic primary·관계·임베딩 작업을
  실행하지 않아야 한다. 비어 있지 않지만 정책상 제외만 있는 요청은 FR-046의 정상 성공 의미를
  유지해야 한다.
- **FR-079**: `skipConverted`가 활성인 정상 자동 변환에서 아직 성공 처리되지 않은 같은 episodic
  원본을 여러 호출이 동시에 선택해도 하나의 호출만 conversion commit unit을 커밋해야 한다. 성공
  전환은 해당 호출이 관측한 기존 변환 자격이 아직 유효할 때만 적용하고, 적용되지 않은 호출은
  자신의 semantic primary 변경과 결과를 되돌리며 승자의 성공 상태를 failed로 덮어쓰거나 후속
  관계를 만들지 않아야 한다. 패한 호출은 기존 skipped outcome으로 한 번 정산하고 failed·retry로
  집계하지 않아야 한다. `skipConverted=false`인 명시적 강제 재처리는 FR-024대로 호출마다 새
  occurrence를 수락하며 신규 lease·idempotency 저장소·전역 lock을 추가하지 않아야 한다.
- **FR-080**: conversion commit unit이 커밋된 뒤에는 해당 시도를 성공으로 확정해야 한다. 이후
  관계·임베딩·통계·로그 단계의 실패나 예외는 원본을 failed로 강등하거나 retry count를 늘리거나
  전체 자동 재시도를 허용해서는 안 되며, 커밋된 created·updated·semantic ID를 유지한 채 기존
  best-effort 관측 경로로 정산해야 한다. post-commit 보상 트랜잭션이나 신규 공개 상태를 추가하지
  않아야 한다.
- **FR-081**: 이미 성공 상태인 원본의 `skipConverted=false` 명시적 강제 재처리가 no-triple,
  validation 또는 pre-commit 운영 실패로 conversion commit unit을 확정하지 못하면 이번 호출의
  실패만 기존 결과·로그로 관측해야 한다. 원본의 재처리 전 성공 tuple과 metadata, 기존 semantic
  evidence를 보존하고 failed 상태나 정상 자동 retry 자격으로 바꾸지 않아야 하며, 실패 시도 이력을
  위한 신규 영속 필드를 추가하지 않아야 한다.
- **FR-082**: 원본 episodic의 변환 상태를 기록하는 모든 자동 episodic→semantic 진입점은 FR-076~
  FR-081의 conversion commit unit, single-winner, post-commit success 및 강제 재처리 보존 계약과
  동일한 outcome·retry 의미를 적용해야 한다. 여기에는 명시적 변환 도구와 예약 batch 변환이
  포함되며, 상태를 소유하지 않는 직접 semantic 갱신 서비스는 원본 성공·실패 상태를 쓰지 않아야
  한다. 진입점별로 다른 공개 결과 필드나 별도 상태 저장소를 추가하지 않아야 한다.
- **FR-083**: 아직 성공 상태가 아닌 원본의 자동 변환이 no-triple, 자동 경계 validation 또는
  pre-commit 입력·운영 실패로 conversion commit unit을 확정하지 못하면 기존 failure metadata의
  `retry_count`를 원자적으로 정확히 1 증가시키고 기존 backoff·최대 재시도·`abandoned` 전이 정책을
  적용해야 한다. 이 실패 전이는 원본이 여전히 해당 시도의 변환 자격과 source snapshot을 유지할
  때만 기록하고, 동시 성공·abandoned 상태를 덮어쓰거나 lost update로 retry 증가분을 유실해서는
  안 된다. FR-079의 동시 패자와 FR-084의 stale 시도, FR-081의 기존 성공 강제 재처리 실패는
  retry count를 바꾸지 않아야 한다. failure-state transaction 자체가 commit되지 못한 경우에는
  FR-090을 적용하며 신규 retry 정책·상태·failure code를 추가하지 않아야 한다.
- **FR-084**: 자동 변환은 시작 시 읽은 원본의 존재, type, 활성 상태, content, importance,
  `owner_id`와 `project_id`를 conversion commit unit 안에서 다시 확인해야 한다. 하나라도 달라졌거나
  원본이 사라지면 해당 시도의 semantic primary와 성공 결과를 모두 되돌리고 원본 성공·failed·
  abandoned 상태 및 retry count를 변경하지 않아야 한다. 해당 호출은 기존 skipped outcome으로
  한 번 정산하고 이후 호출이 현재 원본을 새 snapshot으로 처리하게 하며 별도 version 필드·lease·
  전역 lock을 추가하지 않아야 한다. 명시적 강제 재처리도 stale evidence를 커밋해서는 안 된다.
- **FR-085**: 비어 있지 않은 유효 container에서 primary 변경이 0건이면 원본 위치 outcome의 원인을
  구분해야 한다. 유효 confidence가 저장 하한을 넘지 못한 정책 제외만 있으면 FR-046의 정상 성공으로
  처리하고, sparse·비객체·malformed triple, 정규화·confidence·후보 판정 또는 다른 pre-primary
  입력·운영 실패가 하나라도 있으면 FR-083의 failed/retry 경로를 적용해야 한다. 하나 이상의
  primary가 커밋된 묶음은 기존 부분 성공 계약을 유지하며 신규 공개 outcome 종류를 추가하지
  않아야 한다.
- **FR-086**: LLM 추출과 invocation snapshot 이후의 canonicalization·entity linking·confidence,
  후보 판정용 입력 embedding 생성·비교 및 기타 외부·fallible 계산은 conversion write transaction을
  열기 전에 완료해야 한다. write transaction 안에서는 FR-049·FR-079·FR-084의 source·candidate·
  자격 재검증과 coalesced semantic primary·원본 상태 DB 변경만 수행해야 하며, 재검증 실패는 기존
  rollback·최대 1회 후보 재판정 계약과 FR-087의 transaction 경계로 처리해야 한다. semantic embedding은 FR-067·FR-074의
  post-commit 경계를 유지하고, 외부 작업을 transaction 안에서 기다리거나 신규 queue·persistent
  cache·전역 lock을 추가하지 않아야 한다.
- **FR-087**: FR-049의 candidate 자격 재검증이 실패하면 현재 conversion write transaction을 전체
  rollback하고 종료한 뒤 candidate 조회, 필수 embedding 접근과 similarity 비교를 transaction
  밖에서 최대 한 번 다시 수행해야 한다. 재판정 결과는 새 transaction에서 source·candidate를 다시
  검증해 commit하고, 두 번째 재검증도 실패하면 해당 triple을 pre-primary 운영 실패로 제외해야
  한다. 첫 시도의 interim primary·outcome·ID·통계를 외부 결과에 반영하거나 transaction 안에서
  외부 계산을 수행하지 않아야 하며 신규 savepoint·lease·전역 lock을 추가하지 않아야 한다.
- **FR-088**: 예약 batch의 timeout은 episodic 원본 처리 단위 사이에서 적용해야 한다. deadline 전에
  시작한 원본은 conversion commit unit과 정상 프로세스에서 예정된 FR-074 후속 작업 정산을
  완료해야 하고, deadline 이후에는 새 원본을 시작하지 않아야 한다. 미시작 원본은 DB 상태·retry
  count를 변경하지 않고 batch의 processed·success·failed·skipped에 포함하지 않으며 기존 timeout
  표시·경고만 사용해야 한다. 원본 중간 취소·신규 cancellation 상태·checkpoint를 추가하지 않아야 한다.
- **FR-089**: batch에서 각 episodic 원본은 독립 conversion commit unit으로 처리해야 한다. 한
  원본의 추출·검증·primary·상태 전이 또는 후속 작업 실패는 다른 원본의 이미 커밋된 결과를
  rollback하거나 deadline 전에 남은 원본의 처리를 중단해서는 안 된다. batch 집계는 실제로 종결된
  각 원본을 success·failed·skipped 중 기존 의미에 맞는 하나로 정확히 한 번 분류하고, 미시작 원본이나
  chunk 잔여분을 일괄 failed·processed로 만들지 않아야 하며 batch 전체 transaction을 추가하지 않아야 한다.
- **FR-090**: genuine pre-commit 실패에서 semantic primary rollback 뒤 조건부 failure-state·retry
  transaction 자체가 commit되지 못하면 원본의 기존 영속 상태와 retry count를 유지해야 한다.
  persistence가 확인되지 않은 failed·abandoned·retry 증가를 batch·도구 결과에 성공적으로 기록된
  전이로 보고해서는 안 되며, 현재 원본 처리의 failed 결과와 상태 기록 오류는 기존 결과·로그로
  관측하고 다음 실행의 기존 대상 선택을 허용해야 한다. 성공 상태나 semantic primary를 합성하거나
  별도 retry 저장소를 추가하지 않아야 한다.
- **FR-091**: conversion commit unit이 durable commit된 뒤 프로세스가 관계·embedding·관측 후속
  작업 정산 전에 종료되어도 재시작 후 semantic primary와 원본 성공 tuple을 유지해야 한다. 해당
  원본을 failed로 강등하거나 source 전체 자동 retry로 다시 evidence를 가산하지 않고, commit되지
  않은 관계·embedding·로그를 완료된 것으로 합성하지 않아야 한다. 정상 반환 가능한 호출에는
  FR-074를 계속 적용하며 crash recovery 전용 durable queue·reconciliation 상태·보상 transaction을
  추가하지 않아야 한다.
- **FR-092**: 예약 batch 대상은 활성 episodic이면서 현재 변환 상태와 FR-083의 retry 정책상 즉시
  처리 가능한 원본으로 먼저 제한한 뒤 `batchSize`를 적용해야 한다. 적격 원본은 `created_at`
  오름차순과 ID 오름차순으로 결정적으로 선택하고, backoff 중·abandoned·soft-delete·그 밖의
  부적격 원본은 limit을 소비하거나 processed·success·failed·skipped를 만들지 않아야 한다. 이를
  위해 신규 cursor·index·lease·대상 snapshot 저장소를 추가하지 않아야 한다.
- **FR-093**: failed 원본의 `triple_extraction_metadata`가 명시적으로 존재하면 JSON 객체여야 하며,
  존재하는 `retry_count`는 비음수 정수, `last_attempt`는 유효한 시각, `next_retry_after_days`는
  비음수 유한값이어야 한다. 존재하는 값 하나라도 계약을 위반하면 retry count 0·현재 시각·기본
  backoff로 보정하지 않고 FR-092 대상에서 제외하며 원본 ID와 정규화된 사유만 기존 경고에 남겨야
  한다. metadata 또는 선택 필드가 없는 legacy failed 원본은 retry count 0·즉시 due의 기존 최초
  retry 의미를 유지하되, 선택만으로 metadata를 backfill하거나 신규 repair 상태를 추가하지 않아야 한다.
- **FR-094**: failed 원본의 retry 적격성은 대상 선택 시작 시 한 번 캡처한 현재 시각과 비교해야
  한다. 유효한 `last_attempt`와 `next_retry_after_days`가 모두 있으면 저장된 정확한 due time을
  사용하고, 지연 필드가 없으면 기존 `retryBackoffDays`에서 현재 `retry_count`에 대응하는 값을
  사용해야 한다. 현재 시각이 due time 이상일 때만 적격이며 저장된 지연은 이후 설정 변경으로
  소급 재계산하지 않아야 한다. 미래 `last_attempt`는 clamp하지 않고 현재 실행에서 제외해 기존
  경고로 관측하며 신규 clock-skew 상태를 추가하지 않아야 한다.
- **FR-095**: FR-088의 deadline 확인 뒤 각 선택 원본의 extractor를 호출하기 직전에 원본 존재·type·
  활성 상태·content·importance·owner/project·변환 상태와 retry 자격을 다시 읽어 FR-092 선택
  snapshot과 비교해야 한다. 원본이 사라지거나 성공·abandoned·soft-delete·stale 상태가 되면
  extractor·semantic primary·후속 작업을 실행하지 않고 해당 원본을 processed와 skipped에 각각
  정확히 한 번 반영하며 source 상태·metadata·retry count를 변경하지 않아야 한다. 다음 실행이
  최신 상태를 다시 선택하게 하고 신규 lease·lock·version 필드를 추가하지 않아야 한다.
- **FR-096**: 예약 batch는 대상 조회와 원본 상태 변경 전에 resolved 설정을 검증해야 한다.
  `batchSize`·`chunkSize`·`maxRetries`는 양의 정수이고 `parallelism`은 정확히 1이어야 하며,
  `timeout`·`chunkDelayMs`는
  비음수 유한값이어야 하며, `retryBackoffDays`는 하나 이상의 비음수 유한값을 가져야 한다. 명시된
  잘못된 값을 clamp·coerce하거나 기본값으로 대체하지 않고 job-level 설정 오류로 종료해야 한다.
  `timeout=0`은 어떤 원본도 시작하지 않는 timeout, `chunkDelayMs=0`은 무지연, backoff 0은 즉시
  retry로 해석하며 신규 설정·스키마를 추가하지 않아야 한다.
- **FR-097**: `maxRetries`는 아직 시도되지 않은 원본의 첫 자동 시도를 포함한 최대 genuine
  pre-commit 실패 시도 수여야 한다. 실패 상태를 기록할 때 기존 retry count를 1 증가시킨 새 값이
  `maxRetries` 이상이면 같은 조건부 failure-state transaction에서 `abandoned`로 전이하고 이후
  자동 대상에서 제외해야 한다. 따라서 `maxRetries=1`은 첫 실패 직후 abandoned이며, 최초 시도와
  retry를 별도 개수로 더하거나 abandoned 전이를 다음 실행으로 미루지 않아야 한다.
- **FR-098**: genuine pre-commit 실패 뒤 새 retry count가 N이고 N이 `maxRetries`보다 작으면 저장할
  `next_retry_after_days`는 `retryBackoffDays[min(N-1, length-1)]`이어야 한다. 배열보다 많은 retry에는
  마지막 원소를 반복하고 0도 그대로 저장해야 하며, abandoned 전이에는 다음 retry가 없으므로
  `next_retry_after_days`를 기록하거나 이전 값을 유지하지 않아야 한다. 별도 backoff 보간·순환·
  알고리즘을 추가하지 않아야 한다.
- **FR-099**: 예약 batch의 정상 미처리 대상은 `triple_extracted`가 NULL 또는 0이고 status가 NULL
  또는 빈 문자열인 원본, retry 대상은 `triple_extracted`가 NULL 또는 0이고 status가 `failed`인
  원본으로 제한해야 한다. `triple_extracted=1`과 `status='success'`는 완료, status `abandoned`는
  종결 상태로 제외해야 한다. 그 밖의 값·알 수 없는 status·성공 flag와 failed status 같은 모순된
  tuple은 어느 상태로도 추정·보정하지 않고 batch limit 전에 비파괴적으로 제외해 원본 ID와
  정규화된 사유만 기존 경고에 남겨야 하며 신규 repair 상태를 추가하지 않아야 한다.
- **FR-100**: 각 chunk 완료 뒤 다음 chunk가 있을 때만 지연을 고려하고, 지연 직전의 남은 timeout
  예산이 0 이하면 즉시 timeout으로 종료해야 한다. 남은 예산이 양수이면 실제 예약 지연은
  `min(chunkDelayMs, remainingBudget)`를 넘지 않아야 하며, 지연 뒤 deadline에 도달했으면 timeout을
  기록하고 다음 원본을 시작하지 않아야 한다. 이미 완료된 원본과 미시작 원본은 FR-088·FR-089의
  집계 계약을 유지하고 cancellable sleep·checkpoint를 추가하지 않아야 한다.
- **FR-101**: 예약 batch는 execute 시작 시 기본값을 적용한 resolved scalar 설정과
  `retryBackoffDays`의 값 복사본을 하나의 immutable execution policy snapshot으로 만들고 FR-096에
  따라 검증해야 한다. 같은 실행의 대상 조회, retry 적격성·지연 계산, chunk 분할·지연, timeout,
  로그는 모두 그 snapshot만 사용해야 하며 호출자의 설정 객체·배열 후속 mutation은 다음 execute
  호출부터만 반영해야 한다. 범용 deep clone·동적 reload·영속 설정 version을 추가하지 않아야 한다.
- **FR-102**: 이번 기능의 예약 batch는 한 execute 안에서 episodic 원본을 선택 순서대로 한 번에
  하나씩 처리해야 하며 `parallelism`은 정확히 1만 허용해야 한다. 다른 값은 FR-096의 job-level
  설정 오류로 대상 조회 전에 거부하고 무시·clamp·묵시적 직렬 fallback하지 않아야 한다. 원본·chunk
  내부 병렬 실행 또는 신규 동시성 계층을 추가하지 않고, 별도 execute가
  겹치는 경우에는 FR-079의 source 단일 승자 계약을 유지해야 한다.
- **FR-103**: 예약 batch는 FR-092의 선필터·결정적 정렬과 `batchSize` 적용으로 얻은 원본 ID·source
  snapshot의 순서 있는 집합을 현재 execute의 고정 candidate set으로 사용해야 한다. extractor 전
  재검증에서 제외되거나 timeout으로 미시작인 원본이 있어도 같은 execute에서 추가 조회로 빈 자리를
  채우지 않고, 선택 뒤 생성·변경·retry due가 된 원본은 다음 execute에서만 고려해야 한다. 신규
  cursor·lease·동적 top-up 조회를 추가하지 않아야 한다.
- **FR-104**: 고정 candidate set은 선택 순서를 보존한 채 최대 `chunkSize`개의 연속 비중첩 구간으로
  분할해야 한다. 각 원본은 정확히 한 chunk에 속하고 마지막 chunk만 더 작을 수 있으며,
  `chunkSize >= candidateCount > 0`이면 chunk는 하나, candidateCount가 0이면 chunk도 0개여야 한다.
  빈 chunk·padding·round-robin 재배치·chunk 간 재정렬을 하지 않고 FR-100의 지연은 연속한 두
  비어 있지 않은 chunk 사이에만 적용해야 한다.
- **FR-105**: execute 시작 시 retry 적격성·결정적 선택에 사용할 wall-clock 시각과 timeout 경과시간
  측정에 사용할 단조 시계 기준을 각각 한 번 캡처해야 한다. 현재 실행의 due 판정은 시작 wall-clock
  snapshot으로 고정하고 timeout은 단조 경과시간이 예산 이상일 때 발생시켜 실행 중 wall-clock
  이동으로 대상이나 deadline을 재계산하지 않아야 한다. source 성공·실패 상태 전이는 전이 시점에
  캡처한 하나의 UTC 시각을 해당 metadata의 관련 시각 필드에 재사용하고 신규 영속 clock 상태를
  추가하지 않아야 한다.
- **FR-106**: 예약 batch의 공개 `success`는 기존 실행 수준 의미를 유지해야 한다. 실제 종결된
  원본이 하나 이상이어서 `processed > 0`이면 원본별 success·failed·skipped 구성과 timeout 발생
  여부와 무관하게 true여야 한다. 다만 source 단위로 격리할 수 없는 job-level 치명 오류는
  `processed` 값보다 우선해 false여야 하며, 처리 가능한 대상이 없음·첫 원본 전 timeout으로
  `processed=0`인 경우도 false여야 한다. 원본별 품질 결과는 기존 details·errors·warnings로만
  표현하고 신규 status enum이나 성공률 기반 재정의를 추가하지 않아야 한다.
- **FR-107**: 예약 batch의 선택적 설정은 미제공 또는 `undefined`인 필드에만 기존 기본값을 적용해
  resolved execution policy를 만들어야 한다. 명시된 `null`·boolean·숫자 문자열·잘못된 scalar 또는
  array 타입과 원소가 빠진 `retryBackoffDays` 배열은 FR-096의 job-level 설정 오류로 대상 조회 전에
  거부하고 coercion·부분 기본값 대체를 하지 않아야 한다. 신규 설정 필드나 별도 config schema를
  추가하지 않아야 한다.
- **FR-108**: `timeout`과 `chunkDelayMs`는 밀리초, `retryBackoffDays`의 각 값은 정확한 24시간
  단위로 해석해야 한다. FR-096이 허용한 유한한 소수 기간은 정수 일수로 floor·ceil·round하지 않고
  `last_attempt`에 정확한 기간을 더해 due time을 계산하며, 정확한 due 시각부터 적격이어야 한다.
  persisted retry 시각은 timezone을 포함한 유효한 UTC 기준 시각이어야 하고 due 계산이 표현 가능한
  시각 범위를 벗어나면 값을 clamp하지 않고 FR-093의 손상 metadata 격리를 적용해야 한다.
- **FR-109**: batch가 extractor를 호출하기 직전에 선택 source의 content가 정규화 후 비어 있지 않은
  문자열인지, importance가 NULL이거나 유한한 0~1 값인지 검증해야 한다. NULL importance에만 기존
  기본값 0.5를 적용하고 다른 손상값을 coercion·clamp·기본값 대체하지 않아야 한다. 이 검증 실패는
  extractor·semantic·KG·관계 변경 전 genuine pre-commit 실패로 processed·failed에 한 번 반영하고
  FR-083·FR-097·FR-098의 retry·abandoned 전이를 적용하되 raw content를 오류·로그에 포함하지 않아야
  한다. 선택 뒤 값이 바뀐 stale source에는 FR-095를 우선 적용해야 한다.
- **FR-110**: source 상태 전이 commit은 `triple_extracted`, status와 해당 상태의 정규 metadata를
  함께 기록하고 metadata 전체를 새 상태 형태로 교체해야 한다. success metadata는 `triple_count`,
  전이 UTC 시각인 `extracted_at`과 선택적 `confidence_avg`만, failed metadata는 `failureReason`,
  `retry_count`, `last_attempt`, `next_retry_after_days`만, abandoned metadata는 `failureReason`,
  `retry_count`, 같은 전이 시각의 `last_attempt`·`abandoned_at`만 가져야 한다. 이전 상태 전용 키나
  abandoned의 next-retry 값을 병합해 남기지 않아야 하며 FR-081의 실패한 강제 재처리는 상태 전이를
  만들지 않고 기존 성공 metadata 전체를 보존해야 한다.
- **FR-111**: source 단위 계약으로 격리할 수 없는 chunk dispatch·집계·지연 또는 job orchestration
  오류가 발생하면 현재 execute를 즉시 중단하고 job-level 치명 오류로 기록해야 한다. 오류 전에
  durable하게 종결된 source의 outcome·count·ID는 보존하되, 오류 시점의 미확정 source와 남은
  candidate는 processed·failed·skipped·retry로 합성하거나 상태를 변경하지 않아야 한다. 공개
  `success`는 FR-106에 따라 false이고 오류 관측에는 source·chunk 식별자와 정규화된 사유만 사용하며
  raw content를 포함하거나 신규 batch 상태·재개 checkpoint를 추가하지 않아야 한다.
- **FR-112**: 예약 batch의 `startTime`은 execute 진입 시 한 번, `endTime`은 시작한 source 정산과
  job-level 오류 포착이 끝난 반환 경계에서 한 번 확정하고 `duration`은 두 시각의 비음수 차이와
  일치해야 한다. `timeoutOccurred`는 deadline이 새 source·chunk 시작 또는 chunk 사이 지연 완료를
  실제로 막은 경우에만 true여야 하며, 마지막 시작 source가 deadline 뒤에 정산됐지만 남은 작업이
  없는 경우나 timeout과 무관한 치명 오류에는 합성하지 않아야 한다. 문자열 warning 검색으로
  timeout 여부를 재구성하거나 신규 timing 필드를 추가하지 않아야 한다.
- **FR-113**: batch `details.retryCounts`에는 현재 execute에서 failed 또는 abandoned source 상태
  전이가 durable commit된 source ID와 그 전이 뒤 persisted `retry_count`만 source당 한 번 기록해야
  한다. success·stale skipped·정책 제외·동시 성공 패자·failure-state commit 실패·job-level 치명
  오류의 미확정 source는 포함하지 않아야 한다. abandoned의 최종 실패 count는 포함하되 다음 retry
  자격을 뜻하는 값으로 해석하지 않고, 별도 attempt 원장이나 공개 필드를 추가하지 않아야 한다.
- **FR-114**: `batchSize`·`chunkSize`·`maxRetries`는 양의 안전 정수이고 persisted `retry_count`는
  비음수 안전 정수여야 한다. 안전 정수 범위를 벗어난 설정은 FR-096의 대상 조회 전 job-level 설정
  오류, metadata는 FR-093의 비파괴 격리로 처리하고 반올림·wrap·clamp하지 않아야 한다. 유효한 기존
  failed source의 retry count가 현재 execution policy의 `maxRetries` 이상이면 설정 변경만으로
  abandoned 상태를 합성하지 않고 대상에서 제외해 정규화된 경고로 관측하며, abandoned 전이는
  genuine pre-commit 실패를 commit할 때만 FR-097에 따라 만들어야 한다.
- **FR-115**: 같은 `TripleExtractionBatchJob` 인스턴스의 execute 호출이 겹쳐도 각 호출은 자신의
  immutable execution policy, clock snapshot, candidate set, timeout flag, result counts·maps·arrays를
  독립적으로 가져야 한다. 한 호출의 mutation·timeout·치명 오류가 다른 호출의 반환 결과를 바꾸지
  않아야 하며, 두 호출이 같은 source를 선택하면 FR-079의 조건부 conversion commit으로 한 승자만
  primary와 상태를 확정하고 패자는 자신의 execute에서 processed·skipped로 한 번 정산해야 한다.
  이를 위해 job 인스턴스 전역 result accumulator·execute mutex·lease를 추가하지 않아야 한다.
- **FR-116**: batch `semanticMemoriesCreated`와 `semanticMemoriesUpdated`는 현재 execute에서 durable
  commit된 source conversion unit들이 보고한 created·updated primary outcome occurrence의 합이어야
  한다. rollback·policy skip·stale 패자·failure-state commit 실패·job-level 미확정 source는 더하지
  않아야 하고, 같은 semantic row가 한 source에서 생성된 뒤 다른 source에서 갱신되면 created 1과
  updated 1로 각각 세어야 한다. 고유 최종 semantic row 수나 `triple_count`·관계 행으로 재계산하지
  않고 두 수치를 서로 바꾸거나 중복 가산하지 않아야 한다.
- **FR-117**: 예약 batch의 모든 정상·timeout·job-level 오류 반환에서 top-level `processed`는
  `details.processed`와 같고, `details.processed`는 `details.success + details.failed + details.skipped`와
  같아야 한다. 세 outcome은 실제로 종결된 source를 상호배타적으로 한 번씩만 세고, 미확정·미시작
  source와 source 상태로 확정할 수 없는 preflight 실패를 합성하지 않아야 한다. 치명 오류가 durable
  prefix를 보존해도 이 대사 불변식을 유지하고 신규 카운트 필드를 추가하지 않아야 한다.
- **FR-118**: 각 execute는 전달받은 DB handle에 바인딩된 semantic update 의존성을 사용해야 한다.
  job이 내부에서 생성한 DB-bound service는 같은 job 인스턴스의 다른 execute나 다른 DB handle에
  공유·캐시하지 않아야 하며, 겹친 실행도 각자의 DB 경계를 유지해야 한다. 생성자에 명시적으로
  주입된 service는 호출자가 execute DB와 정합한 것으로 간주하되, 내부 lazy singleton·전역 service
  registry·DB 간 복제 로직을 추가하지 않아야 한다.
- **FR-119**: resolved execution policy의 FR-096·FR-107·FR-114 검증은 schema 준비와 service 생성·
  대상 조회를 포함한 어떤 DB 접근보다 먼저 완료해야 한다. 유효 설정 뒤 기존 schema 준비,
  DB-bound dependency 생성 또는 대상 조회가 실패하면 processed와 모든 details outcome을 0으로
  유지한 job-level 치명 오류로 반환하고 source failure·retry·timeout을 합성하지 않아야 한다.
  기존 schema ensure 경계는 재사용하되 신규 migration·health-check 단계나 공개 preflight 상태를
  추가하지 않아야 한다.
- **FR-120**: batch extractor 결과는 non-null non-array 객체이고 `triples`는 배열이며
  `extractionInfo`는 객체여야 한다. 이 계약을 위반하면 결과를 빈 배열로 보정하지 않고 해당 source의
  genuine pre-commit 실패를 기존 `llm_parse_fail`로 기록해 FR-083·FR-097·FR-098을 적용해야 한다.
  실제 빈 `triples` 배열은 유효한 기존 `TripleExtractionFailureReason`만 보존하고 미제공이면
  `no_triple`, 알 수 없거나 비문자열이면 `llm_parse_fail`로 정규화해야 한다. 어느 경로도
  `rawLLMOutput`·임의 오류문·source content를 metadata나 batch 오류에 복사하거나 신규 failure code를
  추가하지 않아야 한다.
- **FR-121**: 각 execute는 `startTime`·`endTime` Date, `errors`·`warnings` 배열과
  `details.retryCounts` Map을 포함한 새 result object graph를 만들어 반환해야 한다. 호출자가 반환
  뒤 이 컨테이너를 변경해도 job 내부 상태, 이미 반환된 다른 결과 또는 이후·겹친 execute 결과가
  바뀌지 않아야 한다. 공개 결과를 deep-freeze·직렬화하거나 신규 immutable wrapper 타입을 추가하지
  않아야 한다.

### Key Entities *(include if feature involves data)*

- **Extracted Triple**: episodic memory에서 자동 추출된 subject·predicate·object와 품질 검사 결과.
- **Semantic Memory**: 정규화된 triple, content, confidence, importance 및 반복 증거 수를 가진
  검색 대상 기억. 전역 SPO 대표가 다른 scope에 있으면 KG 대표권 없이 scoped 후보 검색으로
  관리될 수 있다.
- **Evidence Occurrence**: 같은 semantic 사실을 지지하는 수락된 episodic 처리. 한 원본·호출·대상
  semantic 조합은 최대 한 occurrence이며, 중복 입력은 가장 높은 confidence 하나로 대표한다. 각
  occurrence는 `num_times`와 aggregate confidence에 한 번 반영된다. 기존 명시적 강제 재처리는
  새 호출의 새 occurrence로 간주하며, 검색 사용량과 분리되고 품질 할인을 제거할 수 없다.
- **Quality Gate Policy**: confidence 저장 하한, 경계값 포함 여부, importance 품질 불변식 및 그
  선택을 뒷받침하는 표본 분포. 유사도 하한과 계산 결과의 유효성 경계도 포함한다.
- **Invocation Policy Snapshot**: 한 비어 있지 않은 호출에서 한 번 캡처·검증한 원본 episodic
  식별자, importance 제공 상태와 값, confidence·similarity 하한. 호출 중 외부 옵션 변경과
  무관하게 모든 triple 판단에 같은 값을 제공한다.
- **Invocation Input Snapshot**: container·metadata 검증 뒤 개별 triple 처리를 시작하기 전에 캡처한 원본 위치
  순서, triple의 세 필드와 처리에 필요한 extraction metadata. 같은 호출의 정규화·관계·통계·결과
  대사가 외부 객체 변경과 무관하게 동일한 입력을 보게 한다.
- **Conversion Commit Unit**: 원본 episodic 한 건에서 수락된 semantic primary 변경과 그 원본의
  성공 상태 tuple 및 metadata를 함께 확정하거나 함께 되돌리는 동일 DB 커밋 경계. 정상 자동
  변환의 동시 실행에서는 기존 변환 자격과 source snapshot을 유지한 한 호출만 이 경계를 커밋한다.
  모든 자동 변환 진입점과 batch의 각 원본에 같은 의미로 적용하며 외부 계산과 관계·임베딩 후속
  작업은 포함하지 않는다. candidate 재판정은 이 경계를 rollback·종료한 뒤 새 경계에서 한 번만
  다시 시도한다.
- **Retry Eligibility Snapshot**: 예약 batch 대상 선택 시 한 번 고정한 현재 시각과 기존 source
  상태·retry metadata·설정으로 계산한 처리 가능 여부. 적격성 선필터와 결정적 limit의 근거이며,
  extractor 직전 최신 source 재검증을 대체하지 않는다.
- **Batch Execution Policy Snapshot**: 한 execute 시작 시 기본값 적용 뒤 값으로 복사·검증한 batch,
  chunk, timeout, retry 및 backoff 설정. 대상 선택부터 상태 기록과 관측까지 같은 실행이 일관된
  정책을 사용하게 하며 외부 설정 객체의 후속 mutation과 분리된다.
- **Batch Candidate Set**: retry·상태 적격성, 결정적 정렬과 batch limit 적용 뒤 한 execute에 고정된
  순서 있는 원본 ID·source snapshot 집합. stale 제외나 timeout으로 빈 자리가 생겨도 보충하지 않으며
  chunk 분할과 processed 범위의 상한이 된다.
- **Batch Clock Snapshot**: execute 시작 시 고정한 retry 선택용 wall-clock 시각과 timeout용 단조
  경과시간 기준. persisted UTC attempt timestamp와 역할을 분리해 clock jump가 현재 실행의 선택과
  중단 경계를 바꾸지 않게 한다.
- **Source Transition Metadata**: source의 success·failed·abandoned 상태마다 허용 키가 정해진
  정규 metadata 형태. 상태 전이와 함께 전체 교체되어 stale retry·success 키가 다음 상태의 의미를
  오염시키지 않으며 실패한 강제 재처리에는 새 전이를 만들지 않는다.
- **Batch Result Snapshot**: 한 execute가 독립적으로 누적하고 반환 경계에서 확정하는 timing,
  timeout, source outcome, retry count와 semantic primary occurrence 집계. 겹친 execute나 미확정
  source의 상태를 섞지 않고 durable 결과만 표현하며 반환 컨테이너 mutation은 다른 실행으로
  역전파되지 않는다.
- **Execution DB Binding**: execute 인자로 받은 DB handle과 그 handle로 생성한 semantic update
  의존성의 호출 단위 결합. 같은 job 인스턴스를 재사용해도 다른 DB 실행의 상태와 서비스가 섞이지
  않게 한다.
- **Normalized Triple Snapshot**: 한 입력 triple에 대해 한 번 산출하고 검증한 canonical predicate와
  linked subject·object 및 각 성공 상태. 유효한 fallback 값과 실패 상태도 표현하며 confidence부터
  후보 판정·KG 식별·저장까지 같은 값과 상태를 공유한다.
- **Processing Outcome**: 원본 triple 위치마다 하나만 부여되는 created·updated·skipped·duplicate
  종결 분류. primary 결과와 coalescing 통계가 원본 입력 수와 대사되게 하며, created·updated만
  커밋된 고유 semantic 대상 ID의 반환 근거가 된다.
- **Semantic Provenance**: 자동 추출 항목과 사용자 작성 항목을 구분하는 기존 `origin_source` 및
  `extracted_from` 관계. 자동 품질 집계의 대상 자격을 결정한다.
- **Memory Scope**: `owner_id`와 `project_id`의 null-safe 조합. 자동 semantic 생성·병합 경계를
  제한하며 서로 다른 scope의 증거가 섞이지 않게 한다.

## Scope Boundaries

### In Scope

- 자동 추출 semantic memory의 confidence 영속화
- confidence를 반영한 semantic importance 결정
- 신규·정확한 중복·유사 중복 경로의 일관된 갱신
- 기존 confidence 저장 하한의 경계 동작 및 표본 분포 검증
- 기존 필드를 재사용한 자동 semantic provenance와 owner/project 병합 격리
- 같은 처리 묶음의 증거 coalescing과 신규 semantic primary 저장 원자성
- 후보 선필터와 호출 단위 embedding 재사용
- 판정 불가·부분 실패의 안전한 상태 및 결과 집계
- scope 밖 후보 내용과 실패 로그의 데이터 노출 방지
- 동시 최초 생성 수렴과 갱신 시점 후보 자격 보호
- 손상된 legacy confidence·증거 수의 비파괴 격리
- 유사도 하한·계산 결과와 정규화된 추출 triple의 입력 경계
- 추출 결과 컨테이너 검증, 정규화 실패 격리 및 triple 단위 정규화 snapshot 재사용
- 묶음 내부 coalescing 뒤 결정적인 primary 변경·결과 ID 순서
- 저품질 fallback success flag, 추출 metadata 및 confidence 표본의 명시적 경계
- 원본 triple 단위 결과 분류와 기존 duplicate 통계의 대사 불변식
- 호출 단위 policy snapshot과 관측 부수효과 실패의 결과 비간섭
- 관계 계약 선검증, 독립 후속 작업 및 성공 semantic ID 대사
- 양방향 출처 관계의 독립 시도와 중복 no-op 의미
- sparse·비객체 triple 위치 격리와 선택적 옵션의 런타임 타입 경계
- 호출 단위 triple·필수 extraction metadata 값 snapshot
- 중복 관계의 무변경 no-op과 후속 작업 반환 전 정산
- failure reason 코드 검증과 raw LLM 출력의 semantic 경로 비영속 경계
- 원본 단위 semantic primary 변경·성공 상태의 동일 DB 원자성
- 성공 metadata의 primary outcome 기반 계산과 전체 성공 tuple의 원자성
- 빈 triple의 서비스 no-op·자동 변환 실패 경계 분리
- 동일 원본 정상 자동 변환의 단일 커밋 승자와 post-commit 성공 불변식
- 실패한 명시적 강제 재처리의 기존 성공 상태 보존
- 명시적 변환 도구·예약 batch의 conversion commit 및 retry 의미 일치
- pre-commit 실패의 기존 retry·backoff·abandoned 전이 원자성
- commit 시점 source snapshot 재검증과 stale attempt 무변경 rollback
- primary 0건 묶음의 정책 제외·입력 실패·운영 실패 상태 분류
- 외부·fallible 계산과 conversion write transaction의 경계
- candidate 재판정의 rollback·외부 재계산·새 transaction 경계
- 예약 batch timeout의 원본 단위 중단과 원본별 실패·집계 격리
- failure-state commit 실패와 post-commit 프로세스 종료의 내구성 의미
- retry 적격성 선필터·결정적 batch limit과 손상 metadata 격리
- persisted retry due time과 extractor 직전 source 재검증
- 비종료·암묵 보정을 막는 예약 batch 설정 경계
- 최대 실패 시도 수·backoff 배열 소진·abandoned 전이의 정확한 경계
- 모순된 source 변환 상태 tuple의 limit 전 비파괴 격리
- chunk 지연의 timeout 예산 준수와 실행 단위 설정 snapshot
- 직렬 실행 고정, candidate set 무보충 및 정확한 연속 chunk 분할
- retry·timeout 시계 역할 분리와 기존 batch-level success 의미
- batch 설정의 런타임 default/type 경계와 기간 단위·due 계산
- extractor 전 source payload 검증과 상태별 정규 metadata 교체
- 부분 진행 뒤 job-level 치명 오류의 prefix 보존·무합성 집계
- batch timing·timeout flag의 반환 경계 일관성과 durable retry count 집계
- 안전 정수 count 경계와 현재 max retry를 넘은 failed source의 비파괴 제외
- 겹친 execute의 result 격리와 semantic primary occurrence 기반 batch 집계
- top-level·details source outcome의 전 반환 경로 대사 불변식
- execute별 DB-bound service 격리와 설정·초기화 preflight 순서
- extractor 반환 계약·failure reason 정규화와 반환 컨테이너 mutation 격리
- 해당 동작을 잠그는 회귀 검증

### Out of Scope

- 기존 confidence NULL 행의 일괄 backfill 또는 importance 사후 보정
- #804가 담당하는 기존 오염 데이터 격리·삭제
- confidence 계산 항목이나 배점 자체의 재설계
- 유사도 계산식·embedding 모델·기본 유사도 하한의 재설계
- 검색 랭킹 가중치 변경
- 신규 데이터 필드나 스키마 마이그레이션
- 자동 추출 triple 문장 재조립 품질 개선
- confidence 구간·제외 사유별 상시 텔레메트리 또는 제외 원문 저장
- 운영 원문 또는 운영 데이터에서 파생한 표본·픽스처 커밋
- 명시적 강제 재처리를 idempotent 증거 교체로 재정의하거나 신규 idempotency 저장소를 도입하는 일
- `kg_triple`의 전역 SPO unique 제약을 owner/project 복합 unique로 바꾸는 스키마 마이그레이션
- 기존 semantic 행의 owner/project/origin provenance 일괄 backfill
- soft-delete된 semantic memory의 자동 복구 또는 hard delete 정책 변경
- 호출 간 또는 영속 embedding 캐시, 신규 검색 인덱스 및 후보 검색 아키텍처 재설계
- 신규 인증·권한 모델, durable per-triple retry queue 또는 처리 checkpoint 저장소
- 손상된 legacy confidence·`num_times` 일괄 복구 및 전역 KG 대표 재배정
- triple 추출 결과 공개 계약, canonicalization·entity-linking 알고리즘 또는 Unicode 정책 재설계
- 호출 간 정규화 캐시와 한 처리 묶음 내부 primary 변경 병렬화
- 신규 결과 필드, 영속 confidence 표본 저장소 또는 별도 outcome 원장
- 호출 중 동적 정책 갱신, 관측 실패 전용 저장소·재시도 큐 또는 후속 작업 간 완료 순서 보장
- 양방향 관계 쌍을 위한 분산 트랜잭션·영속 reconciliation 작업 또는 신규 관계 상태 필드
- 숫자 문자열·boolean·`null` 옵션의 강제 변환과 사용하지 않는 요청 필드의 범용 deep clone
- 기존 출처 관계 metadata 갱신·관계 occurrence 이력과 detached 후속 작업 큐
- 신규 failure reason 코드·raw LLM 출력 저장소 또는 원본 간 분산 변환 트랜잭션
- 신규 변환 lease·idempotency 저장소·전역 원본 lock 또는 post-commit 보상 트랜잭션
- 명시적 강제 재처리 attempt 이력·상태 필드 또는 실패 시 기존 성공 tuple 강등
- 진입점별 별도 변환 상태·retry 정책, 신규 source version 필드 또는 retry failure code
- 외부 계산을 위한 write transaction 장기 점유·영속 작업 큐·persistent embedding cache
- 원본 처리 중간 취소·batch 전체 transaction·미시작 원본의 일괄 outcome 생성
- crash recovery 전용 durable 후속 작업 queue·reconciliation 상태·보상 transaction
- batch 대상용 신규 cursor·index·lease·영속 snapshot 또는 retry metadata 자동 repair
- retry 설정의 동적 hot reload·clock-skew 보정 상태·새로운 backoff 알고리즘
- 예약 batch 설정을 위한 신규 공개 필드·환경변수 또는 자동 coercion
- 모순된 변환 상태 tuple의 자동 repair·상태 추정 또는 신규 상태 enum
- cancellable chunk sleep·중간 checkpoint 또는 영속 batch 설정 version
- 원본·chunk 내부 병렬 처리 또는 `parallelism > 1` 지원
- 실행 중 candidate top-up·재조회, 빈 chunk padding 또는 chunk 재정렬
- 영속 monotonic clock·clock-skew 보정 상태 또는 batch success 공개 enum 재설계
- batch 설정 coercion·부분 default merge 또는 신규 설정 schema
- retry 기간 반올림·timezone 추정·overflow clamp 또는 source payload 자동 repair
- source 상태 metadata 병합 이력·attempt 원장 또는 치명 오류 뒤 batch resume checkpoint
- 신규 timing·attempt 공개 필드, warning 문자열 기반 timeout 추론 또는 batch 결과 영속화
- 설정 감소에 따른 failed source 자동 abandoned 전이·retry count 보정 또는 unsafe integer 허용
- job 인스턴스 전역 execute mutex·공유 result accumulator 또는 고유 semantic row 수 재집계
- DB-bound service의 job 전역 lazy singleton·DB 간 복제 또는 신규 service registry
- 신규 batch preflight 상태·health-check·migration과 extractor failure code 확장
- batch result deep-freeze·immutable wrapper·직렬화 계층 또는 호출자 mutation 추적

## Open Questions

| ID | Question | Status | Resolution |
| --- | --- | --- | --- |
| Q-001 | 반복 증거 boost를 어떤 confidence에 허용할 것인가? | Resolved | aggregate confidence가 정확히 1이고 boost 전 importance가 양수인 경우만 boost를 허용하며, confidence가 1 미만이면 boost를 적용하지 않는다. |
| Q-002 | 병합된 semantic memory의 confidence를 어떻게 갱신할 것인가? | Resolved | 수락된 모든 증거를 동일 가중치로 반영한 평균을 저장한다. 기존 값이 비어 있으면 새 confidence로 초기화한다. |
| Q-003 | 기본 confidence 하한 0.7과 같은 triple을 저장할 것인가? | Resolved | 저장하지 않는다. confidence가 하한보다 클 때만 생성·갱신한다. |
| Q-004 | confidence를 importance에 어떤 방식으로 반영할 것인가? | Resolved | boost 전 importance를 적용 대상 episodic importance와 aggregate confidence의 곱으로 계산한다. 별도 계수는 두지 않는다. |
| Q-005 | 병합 후 boost 자격을 개별 증거와 aggregate confidence 중 무엇으로 판단할 것인가? | Resolved | 새 증거를 반영한 aggregate confidence를 사용하며, 그 값이 정확히 1이고 boost 전 importance가 양수일 때만 boost를 허용한다. |
| Q-006 | confidence가 NULL인 기존 semantic memory를 처음 갱신할 때 과거 증거를 어떻게 처리할 것인가? | Superseded by Q-013 | 초기에는 과거 미측정 증거 제외를 선택했으나 별도 측정 개수 없이 `num_times` 평균과 양립하지 않아 Q-013에서 보완했다. |
| Q-007 | aggregate 평균과 반복 boost의 증거 수는 무엇을 기준으로 할 것인가? | Resolved | 수락된 증거를 세는 `num_times`를 사용하고, semantic 병합에서는 `recall_count`를 변경하지 않는다. |
| Q-008 | 여러 episodic 증거의 importance가 다를 때 어떤 값을 원본으로 사용할 것인가? | Resolved | 가장 최근에 수락된 episodic importance를 사용하며 과거 importance를 별도로 집계하지 않는다. |
| Q-009 | semantic 갱신 후 출처 관계 생성이 운영상 실패하면 품질 갱신을 롤백할 것인가? | Resolved | 관계 방향·타입 검증을 통과한 후의 운영 실패라면 롤백하지 않는다. semantic 갱신은 유지하고 관계 실패를 기존 관측 경로에 기록한다. |
| Q-010 | 배포 후 confidence 분포와 제외량을 어떻게 관측할 것인가? | Resolved | 기존 skipped 통계·구조화 로그를 재사용하고 구현 검증용 일회성 집계 리포트만 남긴다. |
| Q-011 | 같은 semantic memory에 여러 증거가 동시에 병합되면 어떤 일관성을 보장할 것인가? | Resolved | 각 병합을 원자적으로 반영해 aggregate confidence와 `num_times` 갱신을 유실하지 않으며 전역 직렬화는 하지 않는다. |
| Q-012 | confidence 분포 검증에 운영 데이터를 어떻게 사용할 것인가? | Resolved | 운영 DB는 읽기 전용 집계만 수행하고 저장소에는 수치·식별자·해시만 남긴다. 테스트는 합성 픽스처만 사용한다. |
| Q-013 | legacy NULL 행에서 과거 미측정 증거와 `num_times` 기반 평균의 충돌을 어떻게 해소할 것인가? | Resolved | 첫 새 confidence를 기존 `num_times` 전체와 새 증거의 대표값으로 초기화하고 이후부터 동일 가중 평균을 누적한다. |
| Q-014 | 원본 episodic importance가 명시적으로 0이면 기본값과 반복 boost를 어떻게 처리할 것인가? | Resolved | 0을 유효한 값으로 보존하고, 값이 제공되지 않은 경우에만 0.5를 사용하며, boost로 0을 양수로 바꾸지 않는다. |
| Q-015 | quality-adjusted importance의 감소 성공을 어떻게 측정할 것인가? | Resolved | boost가 없는 양의 원본 importance 표본에서 최종값은 `원본 importance × aggregate confidence`, 감소량은 `원본 importance × (1 - aggregate confidence)`와 일치해야 한다. |
| Q-016 | 사용자 지정 confidence 저장 하한이 0~1 범위를 벗어나거나 유한하지 않으면 어떻게 처리할 것인가? | Resolved | 상태 변경 전에 검증 오류로 거부한다. 임의 보정이나 clamp는 잘못된 설정을 숨기므로 적용하지 않는다. |
| Q-017 | confidence 계산 결과가 `NaN`·무한대 또는 0~1 범위 밖이면 묶음 전체를 실패시킬 것인가? | Resolved | 해당 triple만 제외하고 기록하며 나머지 유효 triple은 계속 처리한다. |
| Q-018 | 제공된 episodic importance가 유효하지 않으면 기본값·clamp·거부 중 무엇을 적용할 것인가? | Resolved | 전체 요청에서 공유되는 입력이므로 첫 상태 변경 전에 검증 오류로 거부한다. 기본값과 clamp는 잘못된 값을 숨기므로 사용하지 않는다. |
| Q-019 | semantic 저장 뒤 관계·임베딩 운영 실패가 발생하면 전체 변환을 자동 재시도할 것인가? | Resolved | 관계 방향·타입 검증 오류가 아니라면 이미 반영된 증거의 중복 가산을 막기 위해 원본 변환은 성공으로 완료하고 전체 semantic 갱신을 자동 재시도하지 않는다. 후속 실패는 기존 로그로만 관측한다. |
| Q-020 | 사용자 지정 저장 하한 0과 1의 strict 경계는 어떻게 동작하는가? | Resolved | 하한 0에서는 confidence 0만 제외하고, 하한 1에서는 confidence 1을 포함해 모두 제외한다. |
| Q-021 | 이미 성공한 episodic memory의 명시적 강제 재처리를 idempotent 증거 교체로 바꿀 것인가? | Resolved | 바꾸지 않는다. 기존 강제 재처리 계약을 유지해 각 호출을 새 수락 처리로 간주하고, idempotency 재설계는 별도 범위로 남긴다. |
| Q-022 | 자동 semantic 생성·병합에서 owner/project scope를 어떻게 처리할 것인가? | Resolved | 새 항목은 원본 episodic의 owner/project를 상속하고, 중복 후보는 null-safe하게 같은 owner/project로 제한한다. |
| Q-023 | 자동 triple이 사용자 작성 semantic과 일치하면 품질 값을 병합할 것인가? | Resolved | 병합하지 않는다. 사용자 지정 confidence·importance를 보존하고 자동 추출 전용 semantic을 별도로 처리한다. |
| Q-024 | 자동 semantic provenance를 새 스키마 없이 어떻게 식별할 것인가? | Resolved | 신규 항목은 기존 `origin_source`를 사용하고, legacy 항목은 기존 `extracted_from` 관계가 있을 때만 자동 항목으로 인정한다. |
| Q-025 | scope·provenance가 맞지 않는 KG 대표 항목을 찾으면 처리를 중단할 것인가? | Resolved | 해당 대표 항목만 무시하고 동일 scope의 자동 semantic 유사 후보 검색과 신규 생성으로 계속한다. |
| Q-026 | `kg_triple`의 전역 SPO unique 제약도 이번 기능에서 scope별로 마이그레이션할 것인가? | Resolved | 하지 않는다. correctness는 scoped semantic fallback으로 보장하고 KG 스키마 재설계는 별도 범위로 남긴다. |
| Q-027 | soft-delete된 semantic memory가 exact 또는 유사 후보이면 갱신·복구할 것인가? | Resolved | 갱신하거나 복구하지 않는다. 삭제 행은 그대로 두고 활성 scoped 후보 검색 또는 신규 생성으로 계속한다. |
| Q-028 | 원본 memory가 없거나 episodic이 아니거나 soft-delete 상태이면 언제 실패시킬 것인가? | Resolved | confidence 계산과 첫 semantic 변경 전에 전체 요청을 검증 오류로 거부한다. |
| Q-029 | 처리 중 원본 episodic의 owner/project가 바뀌면 각 triple이 어떤 scope를 사용할 것인가? | Resolved | 처리 시작 시 검증한 단일 scope snapshot을 묶음 전체에 사용해 혼합 scope 저장을 막는다. |
| Q-030 | triple 목록이 비어 있어도 원본 episodic을 검증할 것인가? | Resolved | semantic 갱신 서비스 경계에서는 검증하지 않는다. 기존 no-op 계약을 유지해 추가 조회나 상태 변경 없이 0건 결과를 반환하며 자동 변환 경계는 Q-075를 따른다. |
| Q-031 | 구조화 triple 필드가 비어 있는 legacy semantic 후보를 만나면 어떻게 할 것인가? | Resolved | 손상 후보만 제외하고 다른 후보 검색 또는 신규 생성을 계속한다. |
| Q-032 | KG 대표 semantic의 실제 triple이 KG key와 다르면 대표를 신뢰할 것인가? | Resolved | 신뢰하지 않는다. stale 대표를 갱신하지 않고 scoped fallback을 계속한다. |
| Q-033 | 여러 적격 semantic 후보 중 하나를 어떻게 안정적으로 선택할 것인가? | Resolved | exact 구조 일치를 먼저 선택하고, 같은 단계에서는 가장 이른 `created_at`, 그다음 ID 오름차순을 사용한다. |
| Q-034 | 1 미만 aggregate confidence가 반복적인 confidence 1 증거와 수치 반올림으로 정확히 1이 될 수 있는가? | Resolved | 수학적 평균이 1 미만인 동안 저장값도 표현 가능한 1 미만으로 유지해 boost 자격을 다시 얻지 못하게 한다. |
| Q-035 | 신규 semantic 기본 항목 저장 후 KG 쓰기가 실패하면 고아 항목을 유지할 것인가? | Resolved | 유지하지 않는다. 두 쓰기를 하나의 primary 원자 단위로 처리해 KG 예외 시 기본 항목도 되돌리고 다음 triple을 계속 처리한다. |
| Q-036 | 같은 처리 묶음에 동일한 정규화 triple이 반복되면 증거를 몇 번 셀 것인가? | Resolved | 한 번만 센다. 가장 높은 유효 confidence를 대표로 선택하고 동률이면 앞선 입력을 사용한다. |
| Q-037 | 한 처리 묶음의 서로 다른 triple이 같은 semantic으로 귀결되면 어떻게 집계할 것인가? | Resolved | 원본·호출·대상 semantic당 한 occurrence로 합쳐 한 번만 갱신하고, 대표 관계 메타데이터와 기존 duplicate 통계를 사용한다. |
| Q-038 | 유사 후보가 많을 때 embedding 작업 범위를 어떻게 제한할 것인가? | Resolved | 활성·scope·provenance·predicate 선필터 뒤 적격 후보만 비교하고 입력 embedding은 triple당 subject·object 각각 한 번만 계산해 재사용한다. |
| Q-039 | 후보 조회 또는 similarity 증거가 실패·부재해 판정할 수 없을 때 신규 semantic을 만들 것인가? | Resolved | 만들지 않는다. 판정 불가를 후보 없음으로 축소하지 않고 해당 triple을 운영 실패로 제외한다. 적격 후보가 실제로 0건일 때만 생성한다. |
| Q-040 | rollback·후속 실패가 있는 triple을 결과 수치와 semantic ID에 어떻게 반영할 것인가? | Resolved | primary 커밋만 created·updated와 고유 ID에 반영하고 rollback·pre-primary 실패는 skipped에 한 번 반영한다. 커밋 뒤 후속 실패는 primary 성공으로 한 번 집계한다. |
| Q-041 | 다른 scope나 사용자 작성 후보를 가져온 뒤 애플리케이션에서 걸러도 되는가? | Resolved | 안 된다. 후보 content·embedding 접근 전에 scope·활성·provenance·predicate를 제한하고, 전역 KG 대표는 자격 판정용 최소 정보만 확인한다. |
| Q-042 | 제외·실패 관측에 raw triple 또는 semantic 내용을 기록할 것인가? | Resolved | 기록하지 않는다. 원본 ID·묶음 내 위치·정규화된 사유만 기존 구조화 로그와 오류에 사용한다. |
| Q-043 | 원본·공통 입력 검증 뒤 운영 실패로 일부 또는 모든 triple이 커밋되지 않으면 원본 변환 상태를 어떻게 정할 것인가? | Resolved | primary 커밋이 0이고 운영 실패가 있으면 성공 처리하지 않아 전체 재시도를 안전하게 허용한다. 하나라도 커밋되면 성공·전체 자동 재시도 금지를 유지하며 부분 실패를 기록한다. 정책상 제외만 있으면 성공이다. |
| Q-044 | 전역 KG 대표가 scope·provenance·활성·구조·집계값 조건상 병합 부적격일 때 새 scoped semantic의 KG 연결을 어떻게 해석할 것인가? | Resolved | 기존 KG 대표를 유지하고 새 semantic은 KG 대표권 없이 정상 fallback으로 저장한다. 이후 동일 scope 후보 검색으로 재사용하며 고아나 쓰기 실패로 보지 않는다. |
| Q-045 | 같은 scope에서 동일 triple을 동시에 처음 생성하면 몇 개의 semantic을 남길 것인가? | Resolved | 하나만 남긴다. 생성 경쟁의 임시 항목은 커밋하지 않고 모든 독립 evidence occurrence를 채택된 항목에 한 번씩 병합한다. |
| Q-046 | 후보 선택 뒤 scope·활성·provenance가 바뀌면 이전 선택을 갱신할 것인가? | Resolved | 갱신하지 않는다. 원자적 자격 조건이 실패하면 한 번 다시 판정하고도 안전한 대상을 확정하지 못할 때 해당 triple을 운영 실패로 제외한다. |
| Q-047 | legacy semantic의 non-NULL confidence가 유효 범위 밖이면 병합할 것인가? | Resolved | 병합하지 않는다. 손상 후보를 건너뛰고 값을 보정하지 않으며, NULL에만 기존 대표값 초기화 규칙을 적용한다. |
| Q-048 | legacy semantic의 `num_times`가 손상되었거나 정확히 증가시킬 수 없으면 어떻게 할 것인가? | Resolved | 해당 후보를 갱신하지 않고 다른 후보 검색 또는 신규 생성으로 계속한다. clamp·reset·부정확한 평균은 금지한다. |
| Q-049 | 서로 다른 episodic importance의 증거가 동시에 병합될 때 무엇을 “가장 최근 수락”으로 볼 것인가? | Resolved | primary 변경의 커밋 순서를 수락 순서로 보고 마지막 커밋 occurrence의 episodic importance를 사용한다. 별도 event-time 정렬은 추가하지 않는다. |
| Q-050 | 사용자 지정 similarity threshold가 유한한 0~1 값이 아니면 어떻게 처리할 것인가? | Resolved | 비어 있지 않은 묶음은 원본 조회와 상태 변경 전에 전체 요청을 거부하고 clamp·기본값 대체를 하지 않는다. 빈 묶음은 기존 no-op을 우선한다. |
| Q-051 | similarity score가 threshold와 같거나 threshold가 0·1인 경계는 어떻게 판정할 것인가? | Resolved | 기존 `score >= threshold` 의미를 유지한다. 같은 값은 일치이며, 0은 모든 유효 점수, 1은 정확히 1인 점수만 일치다. exact 구조 일치는 계속 우선한다. |
| Q-052 | 계산된 similarity score가 `NaN`·무한대 또는 0~1 범위 밖이면 불일치로 볼 것인가? | Resolved | 보거나 clamp하지 않는다. 해당 후보 판정은 불가이며 안전한 대상을 확정할 수 없으면 Q-039 계약으로 triple을 제외하고 신규 semantic을 만들지 않는다. |
| Q-053 | 추출 triple 필드가 문자열이 아니거나 정규화 후 비면 raw 값으로 저장할 것인가? | Resolved | 저장하지 않는다. 해당 triple을 조회·embedding·상태 변경 전에 제외하고 raw 값 강제 변환이나 fallback으로 KG 식별자를 만들지 않는다. |
| Q-054 | 추출 결과 자체가 없거나 `triples`가 배열이 아니면 빈 결과로 취급할 것인가? | Resolved | 취급하지 않는다. malformed 요청으로 상태 변경 전에 전체 거부하고, 실제 빈 배열에만 기존 no-op을 적용한다. |
| Q-055 | canonicalization·entity linking이 예외를 내거나 잘못된 정규화 값을 반환하면 어떻게 할 것인가? | Resolved | 부분값·raw fallback을 쓰지 않고 해당 triple만 pre-primary 운영 실패로 제외하며 다음 유효 triple을 계속 처리한다. |
| Q-056 | 한 triple의 정규화·링킹을 각 경로에서 다시 계산할 것인가? | Resolved | 다시 계산하지 않는다. 한 번 만든 검증된 snapshot을 confidence, 후보 판정, KG key 및 저장 전 경로에서 재사용한다. |
| Q-057 | 여러 triple의 primary 변경과 결과 ID 순서는 무엇으로 정할 것인가? | Resolved | coalescing 뒤 대상별 가장 이른 원본 입력 위치 순으로 직렬 적용·반환한다. 묶음 내부 완료 순서 경쟁은 허용하지 않고 호출 간 동시성은 유지한다. |
| Q-058 | canonicalization·entity linking이 `success=false`와 유효한 fallback 값을 함께 반환하면 운영 실패로 제외할 것인가? | Resolved | 제외하지 않는다. 유효한 값은 snapshot에 유지하고 failure flag는 confidence 감점으로만 사용한다. 예외·비문자열·빈 결과만 Q-055에 따라 격리한다. |
| Q-059 | 비어 있지 않은 추출 결과의 `extractionInfo.steps`가 없거나 boolean이 아니면 언제 실패시킬 것인가? | Resolved | 원본 조회·confidence·통계·상태 변경 전에 요청 전체를 검증 오류로 거부한다. 실제 빈 배열은 metadata 검증보다 no-op을 우선하며 batch steps를 개별 confidence에 사용하지 않는다. |
| Q-060 | 저장되지 않은 triple의 유효 confidence도 기존 분포 통계에 포함할 것인가? | Resolved | 포함한다. 원본 입력당 계산된 유효 confidence를 한 번 기록하고, 저장 하한·coalescing·후속 운영 실패로 표본을 빼지 않는다. confidence 계산 전 실패에는 값을 만들지 않는다. |
| Q-061 | coalescing과 실패가 섞인 묶음의 created·updated·skipped·duplicate를 어떻게 대사할 것인가? | Resolved | 각 원본 위치를 네 결과 중 하나로만 분류한다. 그룹 대표는 primary 결과 또는 skipped 한 건, 나머지는 대표 성공 여부와 무관하게 duplicate이며 네 합은 원본 triple 수와 같다. |
| Q-062 | 처리 도중 호출 옵션이 변경되면 이후 triple은 어느 값을 사용할 것인가? | Resolved | 빈 배열 no-op 뒤 비어 있지 않은 호출의 episodic ID·importance 제공 상태·값과 두 하한을 한 번 snapshot으로 캡처·검증하고 묶음 전체에서 재사용한다. 외부 변경은 다음 호출부터만 반영한다. |
| Q-063 | primary 처리 뒤 기존 통계 또는 로그 기록 자체가 실패하면 호출 결과를 실패로 바꿀 것인가? | Resolved | 바꾸지 않는다. 관측 실패는 primary 결과·ID·원본 성공/재시도 상태에 영향을 주거나 원래 오류를 가리지 않는 best-effort 부수효과로 격리하며 신규 저장소는 만들지 않는다. |
| Q-064 | 관계 계약 검증과 관계·임베딩 후속 작업은 primary 변경을 기준으로 언제 수행할 것인가? | Resolved | 타입으로 결정 가능한 방향·타입 계약은 첫 primary 변경 전에 검증해 오류를 기존대로 전파한다. 검증 뒤 관계·임베딩은 커밋 후 독립 후속 작업이며 완료 순서나 상호 성공 의존성을 두지 않는다. |
| Q-065 | 결과 카운트와 반환 semantic ID를 어떻게 대사할 것인가? | Resolved | created·updated가 커밋된 고유 대상 ID만 첫 성공 원본 위치 순으로 한 번 반환한다. skipped·duplicate·rollback은 ID를 추가하지 않고 후속 실패도 확정 목록을 바꾸지 않는다. |
| Q-066 | 양방향 출처 관계 중 한 방향이 중복이거나 운영상 실패하면 다른 방향과 primary를 어떻게 처리할 것인가? | Resolved | 두 방향을 독립적으로 시도하고 기존 중복은 성공한 no-op으로 본다. 한 방향 실패는 다른 방향이나 primary를 취소하지 않으며 방향별 실패만 기존 관측 경로에 남긴다. |
| Q-067 | 비어 있지 않은 `triples` 배열의 sparse·`null`·비객체 위치를 전체 요청 오류로 볼 것인가? | Resolved | 전체 요청을 거부하지 않고 해당 원본 위치만 confidence 계산 전 skipped로 분류한다. 나머지 유효 위치를 계속 처리하고 강제 객체 변환은 하지 않는다. |
| Q-068 | 선택적 수치 옵션의 미제공과 `null`·문자열 숫자·boolean을 같은 기본값 경로로 볼 것인가? | Resolved | 보지 않는다. 미제공 또는 `undefined`만 기존 기본값을 사용하고 다른 런타임 타입은 원본 조회 전 검증 오류로 거부한다. episodic ID도 비공백 문자열만 허용한다. |
| Q-069 | 처리 도중 원본 triple 배열·항목·extraction metadata가 변경되면 어느 값을 사용할 것인가? | Resolved | container·metadata 검증 뒤 개별 triple 처리를 시작하기 전에 필요한 배열 순서·triple 필드·metadata를 값 snapshot으로 캡처해 호출 전체에서 재사용한다. 외부 변경은 다음 호출부터만 반영한다. |
| Q-070 | 이미 존재하거나 동시에 생성된 동일 출처 관계의 confidence·metadata를 갱신할 것인가? | Resolved | 갱신하지 않는다. 기존 관계와 duplicate constraint는 무변경 성공 no-op으로 정산하고 관계 occurrence 이력은 추가하지 않는다. |
| Q-071 | 독립적인 관계·임베딩 후속 작업이 끝나기 전에 semantic 갱신 호출을 반환할 것인가? | Resolved | 반환하지 않는다. 모든 예정 작업을 독립적으로 시도하고 성공·실패가 정산된 뒤 반환하되 완료 순서는 보장하지 않고 detached 작업 큐를 추가하지 않는다. |
| Q-072 | 선택적 `failureReason`과 `rawLLMOutput`을 semantic 갱신 경계에서 어떻게 처리할 것인가? | Resolved | failure reason은 미제공 또는 기존 정의 코드만 허용하고 잘못된 값은 비어 있지 않은 요청 전체를 선검증 오류로 거부한다. raw LLM 출력은 snapshot·관계 metadata·DB·이 기능의 로그에 전달하지 않는다. |
| Q-073 | semantic primary 변경 뒤 원본 성공 상태 기록이 실패하면 자동 재시도의 중복 가산을 어떻게 막을 것인가? | Resolved | 원본 한 건의 semantic primary 변경과 성공 상태를 같은 DB 커밋 단위로 묶는다. 상태 기록 실패 시 primary와 성공 결과를 모두 되돌린다. 아직 성공하지 않은 원본은 실패 상태의 전체 재시도를 유지하고 기존 성공 원본의 강제 재처리는 Q-078을 적용하며, 관계·임베딩은 커밋 뒤 수행한다. |
| Q-074 | 성공 상태 metadata의 `confidence_avg`를 관계 행과 primary outcome 중 어디서 계산할 것인가? | Resolved | 커밋 뒤 관계 행에 의존하지 않고 현재 호출에서 primary 커밋된 coalesced evidence occurrence의 confidence만 평균한다. 수락 occurrence가 없으면 필드를 생략하며 전체 기존 성공 tuple과 함께 원자적으로 기록한다. |
| Q-075 | 빈 triple 배열의 no-op은 semantic 갱신 서비스와 자동 변환 워크플로에서 같은 의미인가? | Resolved | 아니다. semantic 갱신 서비스는 조회 없는 0건 no-op이고, 자동 변환은 기존 `no_triple` 실패·retry metadata 경로를 유지한다. 두 경로 모두 semantic primary와 후속 작업은 실행하지 않는다. |
| Q-076 | 같은 미변환 episodic 원본을 정상 자동 변환 호출이 동시에 처리하면 증거를 몇 번 수락할 것인가? | Resolved | 기존 변환 자격을 조건으로 성공 전환한 단일 승자만 한 번 수락한다. 패한 호출은 자신의 primary와 결과를 되돌리고 승자를 덮어쓰지 않는다. 명시적 강제 재처리는 호출마다 새 occurrence라는 기존 의미를 유지한다. |
| Q-077 | conversion commit 뒤 후속 단계가 예외를 내면 원본을 failed로 다시 표시할 것인가? | Resolved | 표시하지 않는다. commit을 해당 시도의 성공 point of no return으로 보고 이후 관계·임베딩·관측 실패는 기존 best-effort 경로로 정산하되 성공 상태·결과·자동 재시도 금지를 유지한다. |
| Q-078 | 이미 성공한 원본의 명시적 강제 재처리가 commit 전에 실패하면 기존 성공 상태를 failed로 덮어쓸 것인가? | Resolved | 덮어쓰지 않는다. 이번 호출만 실패로 관측하고 재처리 전 성공 tuple·metadata와 semantic evidence를 보존하며 정상 자동 retry 자격을 만들지 않는다. 신규 attempt 이력은 추가하지 않는다. |
| Q-079 | 명시적 변환 도구와 예약 batch가 서로 다른 conversion commit·retry 의미를 가져도 되는가? | Resolved | 안 된다. 원본 상태를 쓰는 모든 자동 episodic→semantic 진입점은 같은 원자성·single-winner·post-commit·outcome·retry 계약을 적용한다. 직접 semantic 갱신 서비스는 원본 상태를 소유하지 않는다. |
| Q-080 | 아직 성공하지 않은 원본의 genuine pre-commit 실패는 retry count와 abandoned 전이에 어떻게 반영할 것인가? | Resolved | 기존 retry count를 원자적으로 한 번 증가시키고 기존 backoff·최대 재시도·abandoned 정책을 적용한다. 동시 성공·abandoned 상태는 덮어쓰지 않으며 경쟁 패자·stale 시도·기존 성공 강제 재처리 실패는 count를 바꾸지 않는다. |
| Q-081 | 처리 시작 뒤 원본 content·importance·scope·type·활성 상태가 바뀌어도 이전 snapshot의 semantic evidence를 커밋할 것인가? | Resolved | 커밋하지 않는다. conversion commit 안에서 source snapshot을 다시 확인하고 변경 시 primary와 결과를 rollback해 기존 skipped outcome으로 정산한다. failed·retry를 기록하지 않고 다음 호출이 현재 원본을 새로 처리하게 한다. |
| Q-082 | 비어 있지 않은 묶음의 primary가 0건일 때 모든 skipped 원인을 정상 성공으로 볼 것인가? | Resolved | 아니다. 저장 하한 같은 정책 제외만 있으면 성공이고, malformed 위치·정규화·confidence·후보 판정 등 입력·운영 실패가 하나라도 있으면 기존 failed/retry 경로다. primary가 하나라도 커밋되면 기존 부분 성공 의미를 유지한다. |
| Q-083 | 정규화·confidence·후보 판정용 embedding 비교 같은 fallible 계산을 conversion write transaction 안에서 수행할 것인가? | Resolved | 수행하지 않는다. 외부·fallible 계산을 먼저 끝내고 transaction은 source·candidate 재검증과 DB primary·성공 tuple 변경에만 사용한다. semantic embedding은 기존 post-commit 경계를 유지하며 신규 queue·cache·전역 lock은 추가하지 않는다. |
| Q-084 | candidate commit 재검증 실패 뒤 허용된 1회 재판정을 같은 write transaction 안에서 수행할 것인가? | Resolved | 아니다. 현재 transaction을 전체 rollback·종료하고 transaction 밖에서 후보 상태와 필요한 비교를 한 번 새로 계산한 뒤 별도 transaction으로 재시도한다. 두 번째 재검증도 실패하면 pre-primary 운영 실패로 제외한다. |
| Q-085 | 예약 batch timeout이 원본 처리 도중 도달하면 진행 중인 conversion을 중간 취소할 것인가? | Resolved | 취소하지 않는다. 이미 시작한 원본의 commit과 정상 후속 정산을 마치고 새 원본 시작만 중단한다. 미시작 원본은 상태·retry·batch outcome에 포함하지 않는다. |
| Q-086 | batch의 한 원본 실패가 같은 chunk의 다른 원본과 이미 커밋된 결과에 영향을 주어도 되는가? | Resolved | 안 된다. 각 원본은 독립 commit unit이며 실패는 해당 원본에만 적용한다. deadline 전의 다음 원본은 계속 처리하고 실제 종결된 원본만 기존 outcome으로 한 번 집계한다. |
| Q-087 | pre-commit 실패 뒤 failure-state·retry transaction 자체가 실패하면 retry 증가를 성공한 것으로 간주할 것인가? | Resolved | 간주하지 않는다. semantic primary rollback과 기존 원본 상태를 유지하고 persistence가 확인되지 않은 retry·abandoned 전이를 보고하지 않는다. 현재 호출 실패만 관측하고 다음 실행이 다시 선택하게 한다. |
| Q-088 | conversion commit 뒤 후속 작업 정산 전에 프로세스가 종료되면 원본 성공을 되돌리거나 전체 자동 retry할 것인가? | Resolved | 둘 다 하지 않는다. durable primary와 성공 tuple을 유지하고 미완료 후속 결과를 성공으로 합성하지 않는다. 정상 호출의 반환 전 정산은 유지하되 crash 전용 queue·reconciliation 상태는 추가하지 않는다. |
| Q-089 | 예약 batch limit을 retry 적격성 판정 전과 후 중 언제 적용할 것인가? | Resolved | 활성·상태·backoff 적격성을 먼저 적용한 뒤 `created_at`, ID 순으로 limit을 채운다. 부적격 앞 행이 뒤의 처리 가능 원본을 굶기지 않게 하며 신규 cursor·index는 추가하지 않는다. |
| Q-090 | failed 원본의 명시된 retry metadata가 손상되면 retry count 0으로 처리할 것인가? | Resolved | 처리하지 않는다. 명시된 JSON·타입·범위 오류는 비파괴적으로 대상에서 제외하고 경고하며, metadata나 선택 필드가 없는 legacy 원본만 기존 최초 retry 의미를 유지한다. 자동 repair는 추가하지 않는다. |
| Q-091 | retry due time은 저장된 지연과 현재 설정 중 무엇을 기준으로 계산할 것인가? | Resolved | 저장된 `last_attempt + next_retry_after_days`를 우선하며 정확한 due 경계를 포함한다. 지연 필드가 없는 legacy 원본만 현재 설정을 사용하고 미래 시각은 clamp하지 않는다. |
| Q-092 | batch 대상 조회 뒤 source가 바뀌면 stale content로 extractor를 실행할 것인가? | Resolved | 실행하지 않는다. deadline 확인 뒤 extractor 직전에 source 자격과 의미 필드를 재검증하고 stale 후보는 processed·skipped로 한 번 정산하되 상태·retry는 바꾸지 않는다. |
| Q-093 | 잘못된 batch·chunk·retry·시간 설정을 실행 중 보정할 것인가? | Resolved | 보정하지 않는다. 대상 조회 전에 타입·범위를 검증해 job-level 설정 오류로 종료한다. 0 timeout·delay·backoff의 명시적 경계 의미만 허용하고 신규 설정은 추가하지 않는다. |
| Q-094 | `maxRetries`는 최초 자동 시도를 제외한 추가 retry 수인가, 실패 시도 전체의 상한인가? | Resolved | 최초 자동 시도를 포함한 genuine pre-commit 실패 시도 전체의 상한으로 유지한다. 첫 실패는 count 1이고 새 count가 상한에 도달하면 즉시 abandoned가 되어 `maxRetries=1`은 추가 자동 시도를 만들지 않는다. |
| Q-095 | retry 횟수가 `retryBackoffDays` 길이를 넘으면 지연을 어떻게 정할 것인가? | Resolved | 새 retry count N에는 N-1 위치를 사용하고 배열 소진 뒤 마지막 값을 반복한다. 0은 그대로 허용하며 abandoned에는 다음 retry 지연을 남기지 않고 보간·순환은 추가하지 않는다. |
| Q-096 | `triple_extracted`와 status가 모순되거나 status가 알려지지 않으면 batch가 어느 쪽을 신뢰할 것인가? | Resolved | 어느 쪽도 추정하지 않는다. NULL/0과 NULL/빈 status만 미처리, NULL/0과 failed만 retry 대상으로 인정한다. 완료·abandoned는 정상 제외하고 그 밖의 모순·알 수 없는 tuple은 limit 전에 비파괴적으로 제외해 경고한다. 자동 repair는 하지 않는다. |
| Q-097 | chunk 사이 지연이 남은 timeout 예산보다 길면 전체 지연을 수행할 것인가? | Resolved | 수행하지 않는다. 지연을 남은 예산 이하로 제한하고 deadline에 도달하면 timeout을 기록한 뒤 다음 원본을 시작하지 않는다. 진행 중 원본 중간 취소나 cancellable sleep은 추가하지 않는다. |
| Q-098 | 실행 중 외부에서 batch 설정 객체나 backoff 배열이 바뀌면 현재 실행에 반영할 것인가? | Resolved | 반영하지 않는다. execute 시작 시 resolved scalar와 backoff 값 배열을 복사·검증한 snapshot만 현재 실행에 사용하고 변경값은 다음 실행부터 적용한다. 범용 deep clone이나 설정 version 저장소는 추가하지 않는다. |
| Q-099 | `parallelism`이 1보다 크면 한 execute에서 원본을 병렬 처리할 것인가? | Resolved | 처리하지 않는다. 입력·commit 순서와 SQLite 경계를 보존하기 위해 이번 기능은 정확히 1만 지원하고 다른 값은 대상 조회 전 설정 오류로 거부한다. 값을 무시한 직렬 fallback이나 신규 동시성 계층은 추가하지 않는다. |
| Q-100 | 선택 원본이 stale·skipped가 되면 같은 execute에서 batchSize까지 대상을 보충할 것인가? | Resolved | 보충하지 않는다. 적격성·정렬·limit 적용 뒤 candidate set을 고정하고 빈 자리는 그대로 둔다. 실행 중 새로 적격이 된 원본은 다음 execute에서 처리하며 cursor·top-up 조회는 추가하지 않는다. |
| Q-101 | `chunkSize`보다 적은 나머지와 `chunkSize >= candidateCount`를 어떻게 분할할 것인가? | Resolved | 선택 순서의 연속 비중첩 구간으로만 나눈다. 마지막 chunk는 작을 수 있고 후보가 있으면 한 chunk, 없으면 0개이며 빈 chunk·padding·재정렬을 하지 않는다. |
| Q-102 | retry due와 timeout이 실행 중 wall-clock 이동의 영향을 받아도 되는가? | Resolved | 안 된다. retry 선택은 execute 시작 wall-clock snapshot으로 고정하고 timeout은 단조 경과시간으로 판단한다. source 상태 전이의 관련 timestamp는 전이 시 캡처한 하나의 UTC 시각을 재사용하며 영속 clock 상태는 추가하지 않는다. |
| Q-103 | batch-level `success`를 원본별 성공률에 따라 다시 정의할 것인가? | Resolved | 재정의하지 않는다. 기존처럼 실제 종결된 원본이 하나 이상이면 true이고, processed 0 또는 job-level 치명 오류이면 false다. 모든 원본이 failed·skipped이거나 처리 뒤 timeout이어도 세부 카운트로 표현하며 공개 status enum은 추가하지 않는다. |
| Q-104 | 선택적 batch 설정의 미제공·`undefined`와 명시적 잘못된 런타임 값을 같은 기본값 경로로 볼 것인가? | Resolved | 보지 않는다. 미제공·`undefined`만 기존 기본값을 사용하고 `null`·boolean·숫자 문자열·잘못된 컨테이너·sparse backoff 배열은 대상 조회 전 설정 오류로 거부한다. coercion과 부분 기본값 대체는 하지 않는다. |
| Q-105 | 소수 `retryBackoffDays`와 저장 시각으로 due time을 어떤 단위·정밀도로 계산할 것인가? | Resolved | timeout·delay는 밀리초, backoff는 정확한 24시간 단위로 해석하고 유효한 소수 기간을 반올림하지 않는다. timezone을 포함한 유효 시각만 사용하며 표현 범위를 넘는 due time은 clamp하지 않고 손상 metadata로 격리한다. |
| Q-106 | 선택된 source의 content 또는 stored importance가 손상되어도 extractor를 호출할 것인가? | Resolved | 호출하지 않는다. content는 비공백 문자열, non-NULL importance는 유한한 0~1 값이어야 하며 NULL만 0.5를 쓴다. 위반은 genuine pre-commit 실패로 기존 retry·abandoned 정책에 정산하고 자동 repair하지 않는다. |
| Q-107 | success·failed·abandoned 전이에서 이전 상태 metadata 키를 병합해 보존할 것인가? | Resolved | 보존하지 않는다. 각 상태의 정규 metadata 형태로 전체 교체해 stale failure·success·next-retry 키를 제거한다. 실패한 기존 성공 강제 재처리는 전이를 만들지 않으므로 기존 성공 metadata 전체를 보존한다. |
| Q-108 | 일부 원본 처리 뒤 source 단위로 격리할 수 없는 chunk·job 오류가 나면 남은 chunk를 일괄 failed 처리할 것인가? | Resolved | 하지 않는다. 이미 종결된 prefix만 보존하고 미확정·미시작 원본의 outcome과 retry를 합성하지 않은 채 실행을 중단한다. 이는 job-level 치명 오류이므로 processed가 양수여도 batch success는 false다. |
| Q-109 | batch `endTime`·`duration`과 `timeoutOccurred`를 어느 경계에서 확정할 것인가? | Resolved | 시작한 source 정산과 오류 포착이 끝난 반환 경계에서 실제 종료 시각과 비음수 duration을 한 번 확정한다. timeout flag는 deadline이 새 작업 시작이나 지연 완료를 실제로 막은 경우만 true이며 마지막 source의 늦은 완료나 일반 치명 오류에는 합성하지 않는다. |
| Q-110 | batch `retryCounts`는 시도한 source와 persisted 전이 중 무엇을 나타내는가? | Resolved | 현재 execute에서 failed 또는 abandoned 전이가 durable commit된 source만 새 persisted count로 한 번 포함한다. 성공·stale·동시 패자·상태 기록 실패·미확정 source는 제외하고 abandoned count는 최종 실패 횟수이지 다음 retry 자격으로 해석하지 않는다. |
| Q-111 | count가 안전 정수 범위를 벗어나거나 기존 failed count가 현재 `maxRetries` 이상이면 자동 보정·abandoned 처리할 것인가? | Resolved | 하지 않는다. unsafe 설정은 대상 조회 전 거부하고 unsafe metadata는 비파괴 격리한다. 현재 max 이상인 유효 failed count도 설정 변경만으로 상태를 바꾸지 않고 제외·경고하며, abandoned는 genuine 실패 commit에서만 만든다. |
| Q-112 | 같은 batch job 인스턴스의 execute가 겹치면 result와 source 처리를 어떻게 격리할 것인가? | Resolved | 각 execute는 policy·clock·candidate·timeout·result를 독립 보유한다. 같은 source 경쟁은 기존 conversion 단일 승자로 수렴시키고 패자는 자기 결과에서 processed·skipped 한 번이며, 전역 execute mutex·lease·공유 accumulator는 추가하지 않는다. |
| Q-113 | batch `semanticMemoriesCreated`·`Updated`는 고유 최종 row 수인가 commit occurrence 수인가? | Resolved | 현재 execute의 durable primary outcome occurrence 합이다. 같은 semantic이 다른 source에서 생성 후 갱신되면 created와 updated를 각각 한 번 세며 rollback·미확정 결과는 제외하고 row·관계·triple count로 재계산하지 않는다. |
| Q-114 | top-level `processed`와 details outcome이 오류 반환에서도 어떻게 대사되는가? | Resolved | 모든 반환에서 top-level과 details processed를 같게 하고 details processed는 success·failed·skipped 합과 같게 유지한다. 실제 종결 source만 한 번 세며 미확정·미시작 source나 preflight 실패는 합성하지 않는다. |
| Q-115 | 같은 job 인스턴스를 다른 DB handle로 execute할 때 DB-bound semantic service를 재사용할 것인가? | Resolved | 내부 생성 service는 execute와 전달 DB에만 바인딩하고 다른 실행에 캐시·공유하지 않는다. 명시적으로 주입된 service의 DB 정합성은 호출자 책임으로 두며 registry·DB 복제는 추가하지 않는다. |
| Q-116 | 설정 검증과 schema·service·대상 조회 preflight의 순서와 실패 결과는 무엇인가? | Resolved | 설정을 어떤 DB 접근보다 먼저 검증한다. 유효 설정 뒤 schema 준비·service 생성·대상 조회가 실패하면 processed 0의 job-level 치명 오류로 반환하고 source 실패·retry·timeout을 합성하지 않는다. |
| Q-117 | extractor가 malformed 결과나 잘못된 failure reason을 반환하면 무엇을 저장할 것인가? | Resolved | malformed 결과는 빈 결과로 보정하지 않고 기존 `llm_parse_fail` genuine 실패로 정산한다. 실제 빈 배열은 허용된 사유 또는 기본 `no_triple`을 사용하고 잘못된 사유는 `llm_parse_fail`로 정규화하며 raw output은 저장·반환하지 않는다. |
| Q-118 | 호출자가 반환된 Date·배열·Map을 변경하면 이후 execute 결과에 영향을 줄 수 있는가? | Resolved | 없다. execute마다 새 result object graph를 반환해 호출자 mutation을 격리하되 deep-freeze·immutable wrapper·신규 공개 타입은 추가하지 않는다. |

## Compatibility Notes

- MCP 도구 입력·출력 필드, semantic memory 스키마 및 관계 스키마는 변경하지 않는다.
- confidence가 저장 하한과 같은 입력을 제외하는 동작과 유효하지 않은 사용자 지정 하한·episodic
  importance를 거부하는 동작은 의도된 입력 검증 강화다.
- 유효하지 않은 사용자 지정 similarity threshold를 비어 있지 않은 요청에서 거부하는 것은 의도된
  입력 검증 강화다. 빈 triple 묶음의 기존 no-op은 유지하며, 유효 점수가 threshold와 같은 경우를
  포함하는 기존 비교 의미도 유지한다.
- 유효하지 않은 similarity score와 정규화 후 비어 있는 추출 triple을 불일치나 raw fallback으로
  처리하지 않고 triple 단위로 제외하는 것은 중복 생성과 손상 KG 식별자를 막는 무결성 강화다.
- malformed 추출 결과를 빈 배열로 축소하지 않고 거부하는 것은 내부 서비스 경계의 의도된 입력
  검증 강화다. 정상 추출기가 전달하는 배열과 실제 빈 배열의 no-op 계약은 바뀌지 않는다.
- canonicalization·entity linking 결과를 triple당 한 번 산출해 재사용하고 묶음 내부 순서를 입력
  순서로 고정하는 것은 기존 정규화 알고리즘과 직렬 처리 의미를 명시적으로 잠그는 변경이다. 공개
  필드나 호출 간 동시성은 바뀌지 않는다.
- 유효한 fallback과 `success=false`를 낮은 품질 신호로 유지하므로 기존 canonicalization 실패
  표본을 사용자 지정 하한으로 저장할 수 있는 계약은 보존된다. 예외·잘못된 반환값만 격리한다.
- 비어 있지 않은 결과의 필수 extraction metadata를 선검증하는 것은 primary 커밋 뒤 metadata
  접근 실패를 막는 내부 계약 강화다. 실제 빈 배열의 no-op과 공개 결과 형식은 유지한다.
- 기존 confidence 분포와 duplicate 통계의 표본·대사 의미를 명확히 하되 신규 공개 통계 필드나
  영속 저장소는 추가하지 않는다.
- 비어 있지 않은 호출은 기존 옵션을 한 번 복사해 사용하므로 정상적인 단일 호출 입력·출력은
  바뀌지 않는다. 진행 중 옵션 객체 변경을 같은 묶음에 반영하는 동작은 지원 계약으로 보지 않는다.
- 기존 통계와 로그는 계속 기록을 시도하지만 그 기록 실패가 이미 커밋된 사용자 결과를 실패로
  바꾸지 않는다. 별도 공개 관측 상태나 durable 재시도 계약은 추가하지 않는다.
- 관계 방향·타입 오류의 기존 전파는 유지하되 primary 변경 전에 검출한다. 계약 검증 뒤 관계·
  임베딩의 운영 실패 격리와 완료 순서 비보장은 기존 비동기 후속 처리 의미를 명시한 것이다.
- 반환 semantic ID의 공개 필드 형식은 유지한다. 성공한 고유 대상만 결정적 순서로 반환해 기존
  카운트와 중복 제거 의미를 명확히 한다.
- 양방향 출처 관계는 기존처럼 각각 생성하며 중복을 정상 no-op으로 유지한다. 한 방향 운영 실패를
  다른 방향이나 primary 실패로 확대하지 않고 신규 reconciliation 계약도 추가하지 않는다.
- sparse·비객체 triple 항목은 유효한 배열 안의 항목 단위 오류로 격리한다. malformed 컨테이너의
  전체 거부와 실제 빈 배열 no-op 계약은 유지한다.
- 선택적 수치 옵션은 미제공·`undefined`에만 기존 기본값을 적용한다. `null`·문자열 숫자·boolean을
  암묵적으로 기본값 또는 숫자로 처리하는 동작은 지원 계약으로 보지 않는다.
- 호출 입력의 사용 필드를 값 snapshot으로 고정하지만 공개 입력 형식은 바꾸지 않는다. 호출 중
  원본 객체 변경을 같은 요청에 반영하는 동작은 지원 계약으로 보지 않는다.
- 기존 출처 관계가 중복이면 성공으로 유지하되 관계 row 자체를 갱신하지 않는다. semantic evidence
  occurrence는 `num_times`로 집계하고 관계 occurrence 이력이나 공개 관계 필드는 추가하지 않는다.
- 관계·임베딩 후속 작업은 호출 반환 전에 모두 정산하므로 반환 뒤 숨은 작업이 상태를 바꾸지
  않는다. 작업 간 완료 순서와 한 작업 실패의 격리 의미는 유지한다.
- 선택적 failure reason의 기존 정의 코드는 그대로 지원하고 알 수 없는 런타임 값만 선검증한다.
  디버깅용 raw LLM 출력은 기존 계약대로 semantic 관계·DB에 저장하지 않는다.
- 자동 변환 경로에서 원본 성공 상태와 semantic primary 변경을 같은 DB 커밋으로 묶는 것은 상태
  기록 실패 뒤 중복 재시도를 막는 원자성 강화다. 공개 결과 형식과 명시적 강제 재처리 의미는
  바꾸지 않으며 원본 간 분산 트랜잭션은 도입하지 않는다.
- 성공 metadata의 기존 필드 형식은 유지하되 `confidence_avg`는 post-commit 관계가 아니라 현재
  호출의 커밋된 evidence를 나타낸다. 관계 실패가 성공 metadata를 바꾸는 동작은 지원하지 않는다.
- 빈 triple 배열에 대한 semantic 갱신 서비스의 no-op과 자동 변환의 기존 `no_triple` 실패 처리를
  구분한다. 공개 결과 형식이나 기존 retry metadata 키는 변경하지 않는다.
- 정상 자동 변환의 동일 원본 동시 실행은 하나만 커밋하지만 `skipConverted=false` 명시적 강제
  재처리는 계속 호출마다 새 occurrence다. 성공 커밋 뒤 후속 실패도 원본을 failed로 강등하지 않는다.
- 이미 성공한 원본의 강제 재처리 시도 실패는 기존 성공 tuple을 덮어쓰지 않는다. 이번 호출의 실패
  결과·로그는 유지하지만 정상 자동 변환 대상이나 신규 영속 attempt 이력으로 바꾸지 않는다.
- 명시적 변환 도구와 예약 batch는 기존 공개 결과 형식을 각각 유지하되 같은 source 상태·retry·
  primary 원자성 계약을 적용한다. 직접 semantic 갱신 호출은 계속 source 변환 상태를 변경하지 않는다.
- genuine pre-commit 실패의 기존 retry·backoff·abandoned 정책은 유지한다. 차이는 모든 자동 변환
  진입점에서 증가분을 유실하거나 동시 성공을 덮어쓰지 않도록 원자성을 명시한 것이다.
- 처리 중 원본의 의미 있는 필드가 바뀌면 이전 snapshot 결과를 커밋하지 않는다. stale 시도를
  사용자 실패나 retry로 기록하지 않고 현재 원본의 다음 정상 처리를 허용하는 무결성 강화다.
- primary 0건에서 정책 제외와 입력·운영 실패를 구분하지만 공개 outcome 종류는 늘리지 않는다.
  정책 제외만 있는 기존 정상 성공과 실제 실패의 기존 retry 의미를 보존한다.
- 외부·fallible 계산을 write transaction 밖에 두는 것은 공개 동작을 바꾸지 않고 장기 write lock을
  피한다. transaction 안의 source·candidate 재검증이 기존 동시성 결과를 보존한다.
- candidate 재검증 실패의 1회 재판정은 기존 허용 횟수를 유지하되 열린 transaction을 먼저
  rollback·종료하고 새 transaction으로 재시도한다. 공개 outcome과 retry 횟수는 늘리지 않는다.
- 예약 batch timeout은 이미 시작한 원본의 원자성과 반환 전 후속 정산을 우선하고 새 원본 시작만
  막는다. 미시작 원본을 기존 집계에 포함하지 않으며 공개 timeout 표시와 결과 필드는 유지한다.
- batch의 원본별 실패 격리는 이미 커밋된 다른 원본과 남은 처리 기회를 보존한다. chunk 전체를
  하나의 transaction이나 일괄 failed outcome으로 취급하는 동작은 지원 계약으로 보지 않는다.
- failure-state persistence 자체가 실패하면 확인되지 않은 retry 증가를 보고하지 않고 원본의 기존
  영속 상태를 유지한다. 이는 DB 실패를 성공한 상태 전이로 꾸미지 않는 오류 계약 강화다.
- conversion commit 뒤 프로세스가 종료되어도 durable 성공은 유지한다. 정상 반환의 후속 정산
  계약은 그대로지만 crash 복구용 신규 queue·상태·보상 작업은 공개 호환 범위에 추가하지 않는다.
- 예약 batch가 backoff 중인 오래된 failed 원본을 limit 전에 제거하고 `created_at`·ID 순으로
  적격 원본을 채우는 것은 처리 기아를 막는 내부 선택 정확성 강화다. 공개 batch 결과 필드와
  미시작 원본의 무집계 의미는 유지한다.
- 명시적으로 손상된 retry metadata를 0으로 보정하지 않는 것은 무제한 재시도와 max retry 우회를
  막는 무결성 강화다. metadata가 없는 legacy failed 원본의 기존 최초 retry 호환성은 유지한다.
- 이미 저장된 retry 지연을 현재 설정으로 소급 변경하지 않는다. 지연 필드가 없는 legacy 원본만
  기존 설정 fallback을 사용하며 공개 metadata 키나 backoff 배열 의미는 늘리지 않는다.
- 선택 뒤 바뀐 source를 extractor 전에 skipped로 정산하는 것은 FR-079·FR-084의 stale 무변경
  계약을 더 이른 경계에 적용한 것이다. 공개 outcome 종류나 retry 상태는 추가하지 않는다.
- 명시된 잘못된 batch 설정은 실행 중 보정하지 않고 선검증 오류로 거부한다. 기존 기본값과 0인
  timeout·delay·backoff의 의도된 경계는 유지하며 신규 공개 설정을 추가하지 않는다.
- `maxRetries`는 최초 시도를 포함한 실패 시도 상한이라는 기존 count 전이 의미를 유지한다. backoff
  배열이 짧으면 마지막 값을 반복하고 abandoned에는 stale next-retry 지연을 남기지 않는다.
- 완료·미처리·failed·abandoned의 일관된 flag/status 조합만 자동 처리 자격으로 인정한다. 모순된
  legacy tuple을 임의 상태로 보정하지 않는 것은 중복 evidence를 막는 무결성 강화다.
- chunk 지연은 남은 timeout 예산을 넘지 않고, 실행 중 외부 설정 mutation은 다음 실행부터만
  반영한다. 공개 설정 필드와 원본 단위 timeout·outcome 의미는 바뀌지 않는다.
- 기존 `parallelism` 필드는 내부 원본 병렬 처리 약속이 아니며 이번 기능에서는 값 1만 명시적으로
  지원한다. 다른 값을 조용히 무시하던 동작은 지원 계약으로 보지 않고 대상 조회 전 설정 오류로
  드러내며, 공개 필드 추가나 scheduler 동시성 재설계는 하지 않는다.
- batchSize는 한 execute의 고정 candidate set 상한이다. stale 제외나 timeout으로 처리 수가 줄어도
  실행 중 보충하지 않고, chunk는 그 집합의 선택 순서를 보존한 연속 구간이므로 기존 결정적 처리와
  WAL 지연 의미를 유지한다.
- retry 선택용 wall-clock과 timeout용 단조 경과시간을 분리해 시스템 시계 이동이 현재 실행의
  대상·중단 경계를 바꾸지 않게 한다. 기존 UTC metadata 형식과 공개 timeout 필드는 유지한다.
- batch-level `success`는 기존처럼 처리한 원본 존재 여부를 나타내고 원본별 품질 성공률로 바꾸지
  않는다. 처리 0건·job-level 오류와 원본별 failed·skipped의 구분은 기존 details·errors·warnings로
  유지한다.
- 선택적 batch 설정은 미제공·`undefined`에서만 기존 기본값을 사용한다. 명시된 잘못된 런타임 값을
  기본값으로 숨기거나 숫자로 변환하는 동작은 지원 계약으로 보지 않는다.
- 소수 backoff는 정확한 24시간 배수로 계산하고 persisted retry 시각은 timezone이 명확해야 한다.
  정수 일수 반올림·timezone 추정·표현 범위 초과 clamp는 지원하지 않는다.
- batch source의 NULL importance 기본값은 유지하지만 non-NULL 손상값과 비정상 content를 extractor에
  전달하지 않는다. 이는 기존 retry 경로로 드러나는 입력 무결성 강화이며 공개 필드는 바뀌지 않는다.
- 상태 전이 metadata는 상태별 정규 형태로 교체해 stale 키를 제거한다. 기존 성공 원본의 실패한
  강제 재처리는 상태 전이가 아니므로 이전 성공 tuple과 metadata를 그대로 보존한다.
- source 단위로 격리할 수 없는 치명 오류 뒤 미시작 원본을 일괄 failed로 꾸미지 않는다. 이미
  종결된 prefix는 진단용 세부 결과로 유지하되 batch-level success는 false이고 신규 resume 상태는
  추가하지 않는다.
- 공개 timing 필드와 `timeoutOccurred` 형식은 유지하되 실제 반환 경계와 deadline에 의해 중단된
  사실을 각각 나타내도록 일관성을 고정한다. warning 문구를 timeout 상태의 단일 출처로 보지 않는다.
- 기존 `retryCounts` map은 현재 실행에서 durable하게 기록된 failed·abandoned count만 나타낸다.
  상태 기록에 실패하거나 retry 자격이 없는 source의 추정값을 노출하는 동작은 지원 계약이 아니다.
- count 설정과 persisted retry count를 안전 정수로 제한하고 현재 max 이상 failed source를 자동
  abandoned 처리하지 않는 것은 overflow와 설정 변경에 의한 무근거 상태 전이를 막는 무결성 강화다.
- 겹친 execute의 공개 결과는 호출별로 독립 유지하며 동일 source만 기존 단일 승자 commit으로
  수렴한다. job 인스턴스 전체 직렬화는 새 호환 계약으로 추가하지 않는다.
- semantic 생성·갱신 batch 수치는 고유 row 수가 아니라 기존 source별 primary outcome의 합이다.
  같은 row의 후속 갱신을 별도 updated occurrence로 세는 현재 필드 의미를 유지한다.
- top-level `processed`와 details outcome의 공개 형식은 유지하되 모든 반환 경로에서 실제 종결 source와
  대사되게 한다. preflight 실패나 미확정 source를 failed로 채우는 동작은 지원 계약이 아니다.
- execute 인자로 DB를 받는 기존 형식은 유지한다. 내부에서 만든 semantic service만 해당 execute의
  DB에 한정하고, 명시적 dependency injection의 호출자 바인딩 의미는 바꾸지 않는다.
- 잘못된 설정은 schema ensure보다 먼저 거부하므로 설정 오류 실행의 DB side effect가 0이 된다.
  유효 설정 뒤 기존 초기화·대상 조회 실패는 기존 job-level error 배열과 false success로 표현한다.
- extractor의 정상 result 형식과 기존 failure reason 코드는 그대로 지원한다. malformed 결과와
  알 수 없는 사유를 기존 `llm_parse_fail`로 정규화하는 것은 임의 metadata와 raw output 유출을 막는
  내부 계약 강화이며 공개 enum은 늘리지 않는다.
- 반환 Date·배열·Map의 타입은 유지하지만 execute마다 새 컨테이너를 사용한다. 반환값을 변경해
  이후 실행의 내부 상태를 바꾸는 동작은 지원 계약으로 보지 않으며 deep-freeze는 도입하지 않는다.
- 기존 confidence NULL 행은 읽기·검색 호환성을 유지하며, 새 증거가 병합되기 전까지 값을
  backfill하지 않는다.
- `skip_converted=false` 등 기존 명시적 강제 재처리는 계속 성공 항목도 다시 처리한다. 이를
  idempotent 증거 교체로 바꾸려면 별도 호환성 계획이 필요하다.
- 관계 방향·타입 검증 오류는 기존처럼 호출자에게 전파하며, 운영성 후속 실패만 primary semantic
  저장 경로에서 격리한다.
- 신규 자동 semantic은 원본 owner/project를 상속하지만 공개 도구 필드는 늘리지 않는다. 서로 다른
  scope의 동일 triple은 semantic memory가 분리될 수 있으며 이는 의도된 격리 강화다.
- 사용자 작성 semantic과 provenance를 확인할 수 없는 legacy semantic은 자동 품질 집계로
  덮어쓰지 않는다. 기존 자동 semantic은 `extracted_from` 관계가 있을 때 계속 병합할 수 있다.
- `kg_triple`의 전역 SPO unique 제약은 유지한다. 대표 항목이 현재 scope에 부적합하면 scoped
  semantic 검색으로 우회하므로 스키마 호환성은 유지된다.
- soft-delete 항목의 기존 복구·삭제 계약은 바꾸지 않으며 자동 semantic 갱신에서는 후보에서만
  제외한다.
- 같은 원본의 같은 호출에서 같은 semantic으로 귀결된 입력을 한 occurrence로 합치는 것은 중복
  가산을 막는 의도된 정확성 강화다. 공개 결과 구조는 유지하되 같은 semantic ID를 중복 반환하지
  않는다.
- 새 KG row가 필요한 신규 semantic의 기본 항목과 KG 연결은 함께 성공하거나 함께 실패한다.
  이미 다른 scope의 전역 KG 대표가 있는 scoped fallback은 KG 대표권 없이 정상 저장되며, 관계·
  임베딩 같은 후속 작업의 기존 격리 계약과 공개 스키마는 변경하지 않는다.
- 판정 불가를 신규 생성으로 바꾸지 않고 커밋 결과만 반환 통계에 반영하는 것은 의도된 무결성
  강화다. 공개 결과 필드는 늘리지 않는다.
- 실패 로그에서 raw triple·content를 제외하고 scope 밖 후보 content 접근을 막는다. 신규 인증
  체계나 공개 권한 계약은 추가하지 않고 기존 owner/project 경계만 더 일찍 적용한다.
- primary 커밋이 전혀 없는 운영 실패 묶음만 기존 실패 상태를 사용한다. 일부라도 커밋된 묶음의
  성공·자동 전체 재시도 금지는 중복 증거 방지를 위해 유지한다.
- 동시 최초 생성은 같은 scope에서 한 항목으로 수렴하지만 서로 다른 scope의 동일 SPO는 계속 별도
  semantic으로 유지된다. 전역 KG unique와 공개 결과 계약은 변경하지 않는다.
- 기존 confidence·`num_times` 손상 행을 자동 병합 대상에서 제외하는 것은 신규 오염 방지이며,
  해당 legacy 값을 복구하거나 삭제하는 동작은 추가하지 않는다.
- 동시 병합의 “최신 episodic importance”는 primary 커밋 순서로 결정한다. 새로운 timestamp 정렬
  계약이나 공개 필드는 추가하지 않는다.

## Dependencies and Assumptions

- 기존 confidence 계산 결과를 품질 신호의 단일 출처로 사용한다.
- 기존 저장 하한 기능과 기본값 0.7을 재사용하되, 저장 조건은 하한 초과로 통일한다. 새 설정
  항목은 추가하지 않는다.
- 사용자 지정 저장 하한은 유한한 0~1 값으로 제한하며, 잘못된 값은 자동 보정하지 않는다.
- 사용자 지정 similarity threshold도 유한한 0~1 값으로 제한하고 잘못된 값은 자동 보정하지 않는다.
  빈 triple 묶음은 모든 공통 입력 검증보다 기존 no-op 계약을 우선한다.
- 유사도 계산은 유효한 0~1 값을 반환하며 threshold 이상을 일치로 보는 기존 의미를 유지한다고
  가정한다. 이 범위를 벗어난 결과는 계산 실패로 격리하고 유사도 계산식 자체는 재설계하지 않는다.
- 추출 triple은 정상적으로 문자열 필드를 제공한다고 가정하되, LLM 경계에서 런타임 타입과 정규화
  후 비공백 여부를 확인한다. 잘못된 필드를 문자열로 강제 변환하거나 raw 값으로 저장하지 않는다.
- 정상 추출 경로는 배열 형태의 `triples`를 제공하지만 자동 semantic 갱신 경계도 이를 독립적으로
  검증한다. upstream 보정에 의존해 malformed 컨테이너를 성공 no-op으로 숨기지 않는다.
- canonicalization과 entity linking은 triple별 정규화 snapshot을 만들 때만 실행하고, 그 결과가
  유효하지 않으면 해당 triple을 격리한다. 호출 간 캐시나 알고리즘 변경은 필요하지 않다.
- `success=false`여도 반환된 정규화 값이 유효하면 정상적인 저품질 결과이며, snapshot은 값과
  success flag를 함께 보존한다고 가정한다. batch `extractionInfo.steps`는 개별 confidence의 출처가
  아니다.
- 비어 있지 않은 정상 추출 결과는 relation metadata에 필요한 boolean `extractionInfo.steps`를
  제공한다. 잘못된 metadata를 기본값으로 합성하지 않으며 실제 빈 배열만 이를 읽지 않는다.
- 기존 confidence 통계는 계산된 입력 품질 분포를, duplicate 통계는 coalescing된 원본 입력 수를
  나타낼 수 있다고 가정한다. 두 통계를 위한 신규 공개 필드나 영속 데이터는 필요하지 않다.
- 호출 옵션은 외부에서 변경 가능한 객체일 수 있으므로 비어 있지 않은 요청의 처리 전에 필요한
  값만 한 번 복사한다. 실행 중 동적 변경을 감지하거나 전역 정책 버전을 저장할 필요는 없다.
- 기존 통계와 logger는 관측용 부수효과이며 primary 데이터·호출 결과의 정확성을 결정하지 않는다고
  가정한다. 관측 실패를 위한 별도 영속 복구 경로는 이번 기능에 필요하지 않다.
- 관계 방향·타입은 검증된 episodic 원본과 자동 semantic 대상 종류로 primary 전에 판정할 수
  있다고 가정한다. 검증 뒤 관계·임베딩 작업 사이에는 완료 순서나 트랜잭션 결합이 필요하지 않다.
- 공개 semantic ID 목록은 성공한 고유 primary 대상의 식별에 사용하며 원본 위치별 outcome 전체를
  표현하는 원장으로 사용하지 않는다.
- `extracted_from`과 `supported_by`는 기존 중복 허용 의미를 유지하는 독립적인 best-effort 후속
  관계다. 한 방향 실패 복구를 위한 영속 조정 작업은 이번 기능에 필요하지 않다.
- 유효한 배열 안의 각 위치는 독립 입력 단위이며 sparse·비객체 위치도 원본 개수와 outcome 대사에
  포함된다고 가정한다.
- 선택적 수치 옵션은 런타임에서 `undefined`만 미제공으로 해석하고 다른 타입을 coercion
  하지 않는다. episodic ID도 trim 결과가 비어 있지 않은 문자열이어야 한다.
- 호출 입력은 첫 await 전에 필요한 값만 복사하면 이후 외부 mutation으로부터 격리할 수 있다고
  가정한다. 사용하지 않는 `rawLLMOutput` 같은 필드는 처리 snapshot에 포함할 필요가 없다.
- 기존 relation unique 계약은 같은 source·target·type 관계를 하나만 허용하므로 duplicate는 기존
  row 갱신 없이 성공 no-op으로 처리할 수 있다고 가정한다.
- 관계·임베딩 후속 작업은 호출자가 결과를 받기 전에 모두 settle할 수 있으며, 두 작업을 서로
  독립적으로 정산하는 데 durable queue나 완료 순서 계약이 필요하지 않다.
- `TripleExtractionFailureReason`의 기존 코드 집합을 런타임 허용 목록으로 재사용한다. 새 사유 코드나
  raw LLM 출력 영속화는 이 기능의 품질 판정에 필요하지 않다.
- 원본 episodic 성공 상태와 semantic primary 변경은 같은 SQLite 연결의 동일 DB 데이터이므로 원본
  한 건 단위 커밋으로 묶을 수 있다고 가정한다. 관계·임베딩은 커밋 뒤 수행하고 원본 간 원자성은
  요구하지 않는다.
- 기존 성공 전환은 `triple_extracted`, `triple_extracted_status`, `triple_extraction_metadata`를
  한 row 변경으로 기록할 수 있으며 metadata는 관계 행 없이 현재 호출의 primary outcome으로
  계산할 수 있다고 가정한다.
- 정상 자동 변환은 기존 `skipConverted` 자격을 성공 전환 조건으로 다시 확인할 수 있고, 같은 원본의
  동시 패자 transaction은 semantic primary를 함께 rollback할 수 있다고 가정한다. 강제 재처리는
  이 단일 승자 규칙의 대상이 아니다.
- 자동 변환 오케스트레이터는 conversion commit 완료 여부를 후속 실패 처리와 구분할 수 있다고
  가정한다. commit 뒤 오류는 실패 상태 writer로 보내지 않고 기존 관측 경로에서 정산한다.
- triple 추출 0건은 기존 자동 변환 정책상 `no_triple` 실패이며, semantic 갱신 서비스의 빈 배열
  no-op과 별도 경계에서 처리된다.
- 강제 재처리 전에 성공 상태였던 원본은 이번 시도의 no-triple·validation·pre-commit 실패와
  무관하게 기존 성공 tuple을 복원할 수 있다고 가정한다. 시도 실패 관측은 기존 호출 결과와 로그로
  충분하며 별도 영속 attempt 이력은 필요하지 않다.
- 명시적 변환 도구와 예약 batch는 같은 DB의 원본 상태와 semantic primary를 변경하므로 동일한
  conversion commit·retry 불변식을 적용할 수 있다고 가정한다. 직접 semantic 갱신 서비스는 원본
  상태 transition을 소유하지 않는다.
- 기존 failure metadata의 `retry_count`, backoff와 최대 재시도·abandoned 정책을 모든 genuine
  pre-commit 자동 변환 실패에 재사용할 수 있다. 상태 조건부 원자 갱신 외의 신규 정책은 필요하지
  않다.
- source snapshot 일치 여부는 기존 원본의 content·importance·owner/project·type·활성 상태와 변환
  자격을 같은 commit에서 다시 읽어 판정할 수 있으며 신규 version column이 필요하지 않다.
- 각 원본 위치의 기존 outcome과 정규화된 실패 사유로 정책 제외와 입력·운영 실패를 구분할 수
  있다고 가정한다. 공개 outcome enum이나 per-triple 원장은 필요하지 않다.
- LLM·정규화·confidence·후보 판정용 입력 embedding 비교 결과는 write transaction 전에 메모리에
  유지할 수 있고, transaction 안의 source·candidate 재검증으로 계산 이후 동시 변경을 안전하게
  검출할 수 있다. semantic embedding은 기존 post-commit 후속 작업으로 남는다.
- candidate 자격 재검증 실패 뒤의 유일한 재판정은 현재 transaction을 rollback한 다음 같은
  invocation snapshot과 정규화 결과를 유지한 채 최신 후보 상태·필수 비교를 transaction 밖에서
  다시 계산할 수 있다고 가정한다. 새 commit transaction에서도 자격이 바뀌면 더 재시도하지 않는다.
- 예약 batch는 deadline을 원본 시작 전에 확인할 수 있고, 시작한 원본을 완료할 때까지 deadline을
  초과할 수 있음을 허용한다. 미시작 원본은 다음 실행의 기존 대상 조회로 다시 선택할 수 있다.
- batch 결과의 기존 success·failed·skipped·processed 수치는 원본별 종결 결과를 합산할 수 있으며,
  한 원본 실패 뒤에도 같은 DB 연결로 다음 독립 원본을 안전하게 처리할 수 있다고 가정한다.
- semantic primary rollback과 failure-state·retry 전이는 별도 transaction 경계로 구분할 수 있다.
  후자까지 commit되지 않으면 기존 source row가 다음 실행의 대상 자격을 유지한다고 가정한다.
- SQLite durable commit 뒤 프로세스 종료는 semantic primary와 source 성공 tuple을 함께 보존한다.
  재시작이 미완료 후속 작업을 자동 성공·실패 상태로 합성하지 않는다고 가정한다.
- 기존 대상 조회는 active episodic과 retry due 조건을 batch limit 전에 적용하고 `created_at`과
  ID로 안정적인 순서를 만들 수 있으며, 이 기능만을 위한 cursor·index가 필요하지 않다고 가정한다.
- failed 원본의 retry metadata 부재는 legacy 최초 retry를 뜻할 수 있지만, 명시된 JSON·필드의
  잘못된 값은 신뢰 가능한 retry 자격을 제공하지 않는다고 가정한다.
- failure writer가 저장한 `next_retry_after_days`는 해당 실패 occurrence의 확정된 지연이고,
  `last_attempt`와 함께 정확한 due time을 계산할 수 있다고 가정한다.
- batch는 extractor 호출 전에 source row의 자격과 의미 필드를 다시 읽을 수 있으며 이 선검증은
  conversion commit 안의 FR-084 재검증을 대체하지 않는다고 가정한다.
- 예약 batch 설정은 대상 조회 전에 모두 resolved되며, 기존 기본값 적용 뒤 타입·범위를 한 번
  검증할 수 있다고 가정한다.
- 기존 retry count는 첫 genuine pre-commit 실패에서 1이 되고 `maxRetries` 도달 실패가 같은
  failure-state transaction에서 abandoned로 전이할 수 있다고 가정한다.
- `retryBackoffDays`는 첫 실패에 첫 원소를 대응시키고 배열 길이가 부족하면 마지막 원소를 반복해도
  되는 기존 단계형 일정이며, abandoned metadata에는 다음 retry due 정보가 필요하지 않다.
- 정상 미처리 tuple은 NULL/0 flag와 NULL/빈 status, retry tuple은 NULL/0 flag와 failed status로
  판별할 수 있다. 그 밖의 조합은 신뢰 가능한 자동 처리 자격을 제공하지 않는다고 가정한다.
- chunk 사이 지연 직전에 timeout의 남은 예산을 계산할 수 있고, deadline까지 제한된 지연 뒤 다음
  원본을 시작하지 않아도 기존 timeout 결과 계약을 유지할 수 있다고 가정한다.
- execute 시작 시 resolved 설정의 scalar와 backoff 배열을 값으로 복사할 수 있으며, 현재 실행 중
  동적 설정 변경을 지원할 필요가 없다고 가정한다.
- `parallelism`은 기존 설정 모양을 유지하지만 현재 예약 batch의 원본 처리 동시성은 1이라고
  가정한다. 동일 원본을 겹쳐 실행하는 별도 execute는 FR-079의 조건부 commit으로 수렴할 수 있다.
- 대상 조회 결과는 한 execute 동안 메모리에 유지 가능한 크기이며 stale 제외로 생긴 빈 자리를
  보충하지 않아도 다음 예약 실행이 새 적격 원본을 처리할 수 있다고 가정한다.
- 선택 결과는 `chunkSize` 연속 slice로 나눌 수 있고, 빈 candidate set에는 지연이나 빈 chunk가
  필요하지 않다고 가정한다.
- 런타임은 timeout 판단에 사용할 단조 경과시간 원천과 persisted metadata용 UTC wall clock을
  제공하며, 단일 execute 동안 전역 시계 보정 상태를 저장할 필요가 없다고 가정한다.
- 기존 batch 소비자는 `success`와 원본별 `details.success`를 다른 의미로 사용하며, `processed > 0`
  기반 실행 성공 의미를 유지하되 job-level 치명 오류가 이를 override하는 것이 공개 결과 호환성에
  필요하다고 가정한다.
- 선택적 batch 설정의 미제공·`undefined`는 기존 기본값을 뜻하지만 명시된 다른 런타임 타입은
  호출자 오류로 구분할 수 있다고 가정한다.
- retry backoff의 day는 24시간 duration이며 기존 writer가 timezone이 명확한 UTC 시각을 저장한다고
  가정한다. 유효한 소수 duration을 정수 일수로 줄일 필요가 없다.
- batch target source는 extractor 전에 content와 importance의 런타임 계약을 검증할 수 있고,
  위반을 기존 genuine pre-commit failure writer로 정산할 수 있다고 가정한다.
- source 상태 metadata의 소비자는 현재 status에 해당하는 정규 키만 필요하며 이전 상태의 키를
  같은 JSON 객체에 누적할 필요가 없다고 가정한다.
- chunk·job orchestration 오류는 source 단위 실패와 구분할 수 있고, 오류 전 durable outcome prefix를
  유지한 채 나머지 candidate를 다음 execute에 맡길 수 있다고 가정한다.
- batch 결과는 execute별 로컬 accumulator로 만들 수 있고 반환 직전 실제 종료 시각과 duration을
  한 번 확정할 수 있다고 가정한다. timeout 여부는 warning 문자열이 아니라 deadline 제어 흐름에서
  직접 기록할 수 있다.
- failure-state writer의 commit 성공 여부와 새 persisted retry count를 호출자가 구분할 수 있어
  durable 전이만 현재 execute의 `retryCounts`에 넣을 수 있다고 가정한다.
- 런타임은 안전 정수 판정을 제공하고 기존 query·metadata 검증에서 unsafe count를 상태 변경 전에
  제외할 수 있다고 가정한다. 현재 max보다 큰 failed count를 자동 전이할 필요는 없다.
- 동일 job 인스턴스의 겹친 execute가 있더라도 policy·clock·candidate·result 객체를 호출별로 만들 수
  있고 shared semantic update dependency는 FR-079의 DB 조건부 commit을 우회하지 않는다고 가정한다.
- source conversion 결과의 created·updated 수치는 commit 성공 뒤 확정되며 batch는 이를 단순 합산해
  primary occurrence 수를 나타낼 수 있다고 가정한다. 고유 row 재조회는 필요하지 않다.
- 기존 batch 소비자는 top-level `processed`와 details outcome을 대사해 진단하므로 모든 반환에서
  `processed = details.processed = success + failed + skipped`를 유지할 수 있다고 가정한다.
- 내부 생성 `SemanticMemoryUpdateService`는 DB handle에 결합되며 execute마다 필요한 경우 생성해도
  되는 가벼운 orchestration 의존성이라고 가정한다. 명시적 주입 service의 DB 정합성은 호출자가 보장한다.
- resolved 설정 검증은 DB 접근 없이 가능하고, 기존 schema ensure·service 생성·대상 조회는 source
  처리를 시작하기 전 순차 preflight로 구분할 수 있다고 가정한다.
- extractor의 런타임 결과는 trust boundary이므로 TypeScript 타입과 별개로 최소 container 계약과
  기존 failure reason 허용 목록을 검증할 수 있다고 가정한다.
- batch result의 Date·배열·Map은 execute별로 새로 만들 수 있으며 반환 뒤 job이 해당 컨테이너를
  다시 참조할 필요가 없다고 가정한다.
- 한 묶음의 coalesced occurrence는 가장 이른 원본 입력 위치 순으로 직렬 반영한다. 이 순서는 결과
  ID와 동일 호출 안의 수락 순서를 결정하지만 서로 다른 호출의 항목별 원자적 병합을 막지 않는다.
- 계산된 confidence 오류는 triple 단위로 격리하지만, 요청 전체에 적용되는 episodic importance와
  confidence 저장 하한 오류는 어떤 triple도 변경하기 전에 거부한다.
- 기존 semantic memory 필드가 confidence 저장을 지원하므로 스키마 변경은 필요하지 않다.
- 원본 episodic memory의 기존 `owner_id`·`project_id`를 scope의 단일 출처로 사용한다. process와
  session은 provenance이지만 병합 격리 키로 추가하지 않는다.
- 신규 자동 provenance는 기존 `origin_source`를 재사용하고, legacy 자동 provenance는 기존
  `extracted_from` 관계로만 판별한다. 관계와 provenance가 모두 없는 항목을 자동이라고 추정하지
  않는다.
- 원본 episodic의 존재·타입·활성 상태와 owner/project는 묶음 시작 시 검증한 동일 row snapshot을
  사용한다.
- 병합된 semantic memory의 confidence는 수락된 증거별 confidence의 동일 가중 평균이다. 과거
  관측별 confidence는 기존 관계 데이터에 남는다.
- 기존 confidence가 비어 있는 항목은 첫 새 confidence를 기존 `num_times` 전체의 대표값으로
  사용한다. 이번 기능은 과거 미측정 증거를 재계산하거나 별도 집계 필드를 추가하지 않는다.
- `num_times`는 semantic 사실의 증거 횟수이고, `recall_count`는 실제 검색 사용량이라는 기존
  의미를 유지한다.
- 동일 호출에서 같은 semantic으로 귀결되는 입력은 독립 증거가 아니라 하나의 occurrence로
  간주한다. 대표 confidence는 최댓값을 사용하고 관계 메타데이터는 같은 대표 입력을 따른다.
- 후보 검색 최적화는 호출 안의 입력 embedding 재사용으로 한정한다. 호출 간 캐시나 신규 인덱스는
  정확성 검증에 필요하지 않으므로 도입하지 않는다.
- 기존 결과 통계와 변환 성공·실패 상태가 primary 커밋 여부 및 부분 실패를 표현할 수 있다고
  가정한다. 별도 per-triple 재시도 상태나 checkpoint는 추가하지 않는다.
- 기존 구조화 로그는 원본 ID·입력 위치·정규화된 사유만으로 운영 실패를 추적할 수 있다고 가정하며,
  raw triple·content·embedding을 진단 필드로 요구하지 않는다.
- 전역 KG row는 동일 SPO의 대표를 최대 하나만 가질 수 있지만, scope가 다른 semantic 자체는 KG
  대표권 없이 기존 scoped 구조·유사 후보 검색으로 다시 찾을 수 있다고 가정한다.
- 기존 semantic의 `num_times`는 양의 정수이고 다음 증가를 정확히 표현할 수 있을 때만 aggregate
  confidence 가중치로 신뢰한다. confidence NULL 외의 손상 집계값은 이번 기능에서 복구하지 않는다.
- 운영 데이터의 라이선스·민감정보 경계는 헌법의 코퍼스 규칙을 따르며, 구현 검증 결과는 원문을
  재배포하지 않는 집계만 남긴다.
- importance 변환은 가장 최근에 수락된 episodic importance와 aggregate confidence의 곱을
  사용한다. FR-012 표본 분포는 이 결정이 예상한 할인과 순서를 만드는지 검증하는 근거로
  사용한다.
- episodic importance가 제공되지 않은 경우에만 0.5를 사용하고 명시적인 0은 품질 계산과 boost
  이후에도 0으로 유지한다.
- #804는 기존 오염을 처리하고, 이 기능은 배포 이후 재유입을 차단한다.
- 관계 방향·타입 검증을 통과한 뒤 발생한 관계·임베딩 운영 실패는 semantic 품질 반영 뒤의 후속
  실패이며 원본 변환의 자동 재시도 조건이 아니다. 명시적 강제 재처리의 기존 의미는 변경하지
  않는다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 수락된 신규 및 갱신 semantic memory 표본의 100%가 0~1 범위의 비어 있지 않은
  confidence를 가진다.
- **SC-002**: 신규 생성, 정확한 triple 중복, 유사 중복의 세 경로 모두에서 동일한 confidence 및
  importance 계약이 100% 충족된다.
- **SC-003**: 서로 다른 episodic importance를 순서대로 병합하는 검증에서 boost 전 importance가
  소수점 여섯째 자리까지 `가장 최근에 수락된 episodic importance × aggregate confidence`와
  일치한다.
- **SC-004**: 갱신 후 aggregate confidence가 1보다 작고 원본 episodic importance가 양수인 모든
  검증 사례에서 반복 횟수와 무관하게 boost가 0이며, 최종 importance가 원본 episodic
  importance보다 낮다.
- **SC-005**: confidence가 저장 하한 이하인 검증 사례의 100%가 제외되며, semantic 항목,
  aggregate confidence 갱신 또는 반복 횟수를 만들지 않는다.
- **SC-006**: boost가 없는 대표 저품질 표본에서 최종 importance가 소수점 여섯째 자리까지
  `원본 episodic importance × aggregate confidence`와 일치하고, 감소량이
  `원본 episodic importance × (1 - aggregate confidence)`와 일치한다.
- **SC-007**: 기존 semantic 생성·병합·관계·임베딩 동작의 회귀 검증이 모두 통과한다.
- **SC-008**: 수락·제외·정확한 중복·유사 중복 검증 사례에서 `num_times` 변화량이 수락된 증거
  수와 100% 일치하고, semantic 병합으로 인한 `recall_count` 변화량은 0이다.
- **SC-009**: 관계 방향·타입 검증을 통과한 뒤 관계 또는 임베딩 생성이 운영상 실패하는 검증에서
  저장된 confidence·importance·`num_times`는 성공 시점 값과 일치하고, 실패 기록은 누락 없이 1건
  이상 확인된다.
- **SC-010**: 구현 검증 리포트가 정상·canonicalization 실패·부분 entity-link 표본별 confidence,
  저장 여부 및 최종 importance를 집계하고, 제외 원문을 새 데이터 저장소에 남기지 않는다.
- **SC-011**: 동일 semantic memory에 서로 다른 원본·호출의 N개 증거를 동시에 병합하는 검증에서
  `num_times`가 정확히 N 증가하고, 최종 confidence가 N개 새 값과 기존 측정값의 동일 가중 평균에
  소수점 여섯째 자리까지 일치하며 `recall_count` 변화량은 0이다.
- **SC-012**: 저장소 변경분에서 운영 원문·파생 표본은 0건이고, 모든 자동 검증 입력은 합성
  데이터이며, 운영 분포 결과는 집계 수치·식별자·해시만 포함한다.
- **SC-013**: confidence가 비어 있고 `num_times=N`인 기존 항목에 confidence C인 증거를 처음
  병합하면 저장 confidence는 C, `num_times`는 N+1이며, 다음 병합부터 N+1을 기존 가중치로
  사용하는 결과가 소수점 여섯째 자리까지 일치한다.
- **SC-014**: episodic importance가 명시적으로 0인 신규·정확한 중복·유사 중복 검증의 최종
  importance는 모두 0이고, 값이 제공되지 않은 검증의 boost 전 importance는 소수점 여섯째
  자리까지 `0.5 × aggregate confidence`와 일치한다.
- **SC-015**: 사용자 지정 confidence 저장 하한에 -0.1, 1.1, `NaN`, 양·음의 무한대를 각각
  입력한 검증은 모두 상태 변경 전에 실패하며 semantic memory 행의 변화량은 0이다.
- **SC-016**: 유효 triple과 유효하지 않은 confidence 결과를 함께 처리하는 검증에서 유효하지 않은
  triple의 semantic 상태 변화량은 0, skipped 증가량은 1이고, 같은 묶음의 모든 유효 triple은
  정상 처리된다.
- **SC-017**: episodic importance에 -0.1, 1.1, `NaN`, 양·음의 무한대를 각각 입력한 검증은 모두
  첫 semantic 상태 변경 전에 실패하며 memory 행과 관계 행의 변화량은 0이다.
- **SC-018**: 저장 하한 0 검증에서 confidence 0은 제외되고 0보다 큰 값은 수락되며, 저장 하한 1
  검증에서는 confidence 1을 포함한 모든 값이 제외된다.
- **SC-019**: 관계 방향·타입 검증을 통과한 뒤 관계 또는 임베딩 후속 작업이 운영상 실패하는
  검증에서 원본 episodic memory는 성공 상태이고 자동 retry count 변화량은 0이며, 해당 호출의
  semantic `num_times` 증가량은 수락된 증거 수와 정확히 일치한다. 관계 방향 검증 오류 회귀
  사례는 기존처럼 호출자에게 전파된다.
- **SC-020**: 기존 공개 입력·출력 필드와 데이터베이스 스키마의 변경량은 0이고, 명시적 강제
  재처리 회귀 검증은 기존처럼 성공 항목을 다시 처리한다.
- **SC-021**: 같은 triple을 서로 다른 owner 또는 project에서 처리하는 검증에서 각 scope의
  semantic memory가 별도로 존재하고, 한 scope 처리로 다른 scope 행의 confidence·importance·
  `num_times` 변화량은 0이다.
- **SC-022**: 새 자동 semantic memory의 `owner_id`·`project_id`는 원본 episodic 값과 일치하고
  `privacy_scope`는 `private`이며, `origin_source`는 자동 추출 도구와 원본 episodic ID를 식별할 수
  있다.
- **SC-023**: 같은 scope의 사용자 작성 구조화 semantic과 동일한 자동 triple을 처리하는 검증에서
  사용자 작성 행의 confidence·importance·`num_times` 변화량은 0이고 자동 추출 전용 semantic이
  별도로 생성 또는 갱신된다.
- **SC-024**: `origin_source`가 비어 있는 legacy semantic 검증에서 `extracted_from` 관계가 있는
  항목만 병합되고, 관계가 없는 항목의 confidence·importance·`num_times` 변화량은 0이다.
- **SC-025**: KG 대표 memory가 다른 scope이거나 사용자 작성 항목인 검증에서 그 대표 행의 변화량은
  0이고, 처리 결과는 현재 scope의 자동 semantic ID를 반환한다.
- **SC-026**: soft-delete된 exact KG 대표와 유사 semantic 후보 검증에서 삭제 행의 모든 필드
  변화량은 0이고, 처리 결과는 동일 scope의 활성 자동 semantic ID를 반환한다.
- **SC-027**: 존재하지 않는 원본 ID, semantic 타입 원본 ID, soft-delete된 episodic 원본 ID를 각각
  사용한 검증은 confidence 계산 전에 실패하며 memory·KG triple·관계 행의 변화량은 모두 0이다.
- **SC-028**: 여러 triple 처리 중 원본 episodic의 owner/project 변경을 모사한 검증에서 해당 호출이
  생성·갱신한 semantic memory의 owner/project 조합은 처리 시작 snapshot과 같은 한 종류뿐이다.
- **SC-029**: 빈 triple 목록 검증의 결과는 created·updated·skipped가 모두 0이고 semantic ID 목록은
  비어 있으며, 원본·semantic·KG triple·관계 테이블의 조회 및 쓰기 변화량은 0이다.
- **SC-030**: subject·predicate·object 중 하나가 비어 있는 legacy 후보를 포함한 검증에서 손상 행의
  변화량은 0이고 유효 triple은 다른 활성 후보에 병합되거나 새 semantic으로 생성된다.
- **SC-031**: KG key와 대표 semantic의 저장 triple이 다른 검증에서 stale 대표 행의 변화량은 0이고
  결과 semantic ID는 동일 scope의 유효 자동 semantic을 가리킨다.
- **SC-032**: exact·유사 후보 순서가 다른 동일 데이터셋으로 검증을 반복해도 exact 후보가 항상
  우선되고, 같은 단계의 복수 후보에서는 `created_at`과 ID가 가장 앞선 동일 항목이 100% 선택된다.
- **SC-033**: `num_times`가 큰 confidence 1 항목에 confidence 1 미만 증거를 한 번 병합한 뒤
  confidence 1 증거를 반복 병합하는 합성 검증에서 aggregate confidence는 항상 1 미만이고 boost
  적용 횟수는 0이다.
- **SC-034**: 신규 semantic 기본 항목 저장 뒤 KG 쓰기 예외를 주입한 검증에서 해당 triple의
  memory·KG triple·관계 행 변화량은 모두 0이고, 같은 묶음의 다음 유효 triple은 정상 처리된다.
- **SC-035**: 한 묶음에 같은 정규화 triple을 K번 넣은 검증에서 대상 semantic의 `num_times`
  증가량과 aggregate confidence 반영 횟수는 각각 1이며, 가장 높은 confidence가 대표값으로
  사용되고 결과 semantic ID는 한 번만 나타난다.
- **SC-036**: 한 묶음의 exact·유사 입력 여러 개가 같은 semantic으로 귀결되는 검증에서 해당
  semantic의 `num_times` 증가량은 1이고, 합쳐진 나머지 수만큼 기존 duplicate 통계가 증가하며
  대표 관계 메타데이터는 최고 confidence 입력과 일치한다.
- **SC-037**: 전체 후보 중 선필터를 통과한 후보가 M개인 합성 검증에서 부적격 후보의 embedding
  비교 횟수는 0, 입력 embedding 계산은 triple당 최대 2회, 후보 embedding 비교 입력은 최대
  `2 × M`개다.
- **SC-038**: exact 후보가 없고 적격 유사 후보의 필수 embedding 조회·계산 실패를 주입한 검증에서
  해당 triple의 memory·KG·관계 행 변화량은 0, `skipped` 증가량은 1이며 같은 묶음의 다음 유효
  triple은 정상 처리된다. 적격 후보가 0건인 대조군은 신규 semantic을 생성한다.
- **SC-039**: primary 저장 rollback, pre-primary 운영 실패, primary 커밋 뒤 후속 실패를 각각
  주입한 검증에서 앞의 두 사례는 created·updated 증가량과 반환 semantic ID가 0이고 `skipped`가
  각각 1 증가하며, 마지막 사례는 성공 수치와 고유 ID가 각각 한 번만 반영된다.
- **SC-040**: 다른 owner/project·사용자 작성·soft-delete 후보를 포함한 검증에서 해당 후보의
  semantic content 조회와 embedding 비교 횟수는 모두 0이고, 현재 scope의 적격 자동 후보만
  병합 대상 또는 신규 생성 판단에 사용된다.
- **SC-041**: 제외·후보 판정 불가·primary rollback·후속 실패 검증에서 새로 발생한 구조화 로그와
  호출자 오류의 raw subject·predicate·object·semantic content·embedding 출현 건수는 0이며,
  각 사건은 원본 ID·입력 위치·정규화된 사유로 구분된다.
- **SC-042**: 모든 triple이 pre-primary 운영 실패한 검증은 원본을 성공 상태로 만들지 않고 primary
  행 변화량이 0이다. 하나를 커밋한 뒤 다른 triple이 운영 실패한 검증은 원본이 성공 상태이고 전체
  자동 retry count 변화량이 0이며, 정책상 제외만 있는 검증도 성공 상태다.
- **SC-043**: 동일 SPO의 전역 KG 대표가 다른 scope·사용자 작성·soft-delete·손상 집계값 항목인 각
  검증에서 기존 KG row와 대표 ID의 변화량은 0이고, 현재 scope에 KG 대표권 없는 활성 자동
  semantic이 정확히 1개 생성되며 다음 동일 scope 호출은 그 semantic을 갱신한다.
- **SC-044**: 같은 scope의 동일 triple을 N개 독립 호출이 동시에 처음 처리하는 검증에서 활성 자동
  semantic은 정확히 1개이고 `num_times`는 N이며, aggregate confidence는 N개 confidence의 동일
  가중 평균과 소수점 여섯째 자리까지 일치하고 미채택 semantic 행은 0개다.
- **SC-045**: 후보 선택 뒤 soft-delete·scope 변경·자동 provenance 제거를 각각 모사한 검증에서
  변경된 후보의 confidence·importance·`num_times` 변화량은 0이다. 재판정으로 적격 대상을 찾은
  경우만 그 대상이 한 번 갱신되고, 찾지 못한 경우 `skipped`가 1 증가한다.
- **SC-046**: non-NULL confidence가 -0.1, 1.1, `NaN`, 양·음의 무한대인 legacy 후보 검증에서
  손상 행의 모든 필드 변화량은 0이고, 유효 triple은 다른 적격 후보에 병합되거나 새 semantic으로
  생성된다. confidence NULL 대조군은 Q-013 결과를 유지한다.
- **SC-047**: `num_times`가 0·음수·소수이거나 다음 증가를 정확히 표현할 수 없는 legacy 후보
  검증에서 손상 행의 모든 필드 변화량은 0이고 부정확한 aggregate confidence 저장 건수는 0이며,
  유효 triple은 다른 적격 후보에 병합되거나 새 semantic으로 생성된다.
- **SC-048**: 서로 다른 episodic importance의 N개 독립 증거를 같은 semantic에 동시에 병합하고
  커밋 순서를 제어한 검증에서 최종 importance는 마지막 커밋 occurrence의 episodic importance와
  최종 aggregate confidence로 계산한 값에 소수점 여섯째 자리까지 일치한다.
- **SC-049**: 비어 있지 않은 triple 묶음의 similarity threshold에 -0.1, 1.1, `NaN`, 양·음의
  무한대를 각각 입력한 검증은 원본 조회와 첫 상태 변경 전에 모두 실패하고 memory·KG triple·관계
  행 변화량은 0이다. 같은 잘못된 값과 빈 triple 묶음의 대조군은 조회 없이 0건 결과를 반환한다.
- **SC-050**: similarity score가 threshold와 정확히 같은 검증은 100% 일치로 판정되고, threshold
  0에서는 유효 점수 0과 1이 모두 일치하며 threshold 1에서는 점수 1만 일치한다. 같은 데이터의
  exact 구조 후보는 similarity 비교 없이 항상 먼저 선택된다.
- **SC-051**: 적격 후보의 similarity score가 `NaN`·양·음의 무한대·-0.1·1.1인 각 검증에서
  해당 triple의 memory·KG·관계 행 변화량은 0, `skipped` 증가량은 1이고 신규 semantic 생성량은
  0이다. 같은 묶음의 다음 유효 triple은 정상 처리된다.
- **SC-052**: subject·predicate·object 각각에 non-string, 빈 문자열, 공백 문자열 또는 정규화 후
  빈 값을 넣은 검증에서 해당 triple의 후보 조회·embedding 호출·memory·KG·관계 행 변화량은
  모두 0이고 `skipped`만 1 증가한다. 같은 묶음의 다음 유효 triple은 정상 처리된다.
- **SC-053**: 추출 결과가 `null`·비객체이거나 `triples`가 누락·비배열인 각 검증은 원본 조회와
  통계 기록 전에 실패하고 memory·KG triple·관계 행 변화량은 0이다. `triples=[]` 대조군만 조회
  없이 created·updated·skipped가 모두 0인 결과를 반환한다.
- **SC-054**: 한 유효 triple을 신규·exact·유사 경로로 각각 처리한 검증에서 predicate
  canonicalization 호출은 1회, subject·object entity linking 호출은 각각 1회이며, 후보 조회의
  정규화 값과 최종 저장 구조화 값은 같은 snapshot과 100% 일치한다.
- **SC-055**: canonicalization·subject linking·object linking의 예외 및 비문자열·빈 결과를 각각
  주입한 검증에서 해당 triple의 후보 조회·embedding·memory·KG·관계 행 변화량은 모두 0이고
  `skipped`만 1 증가한다. 같은 묶음의 다음 유효 triple은 정상 처리된다.
- **SC-056**: 중복·제외를 섞은 N개 입력을 반복 검증하면 coalesced 대상의 primary 커밋 순서와
  고유 semantic ID 배열이 매번 각 대상의 가장 이른 원본 입력 위치 오름차순과 일치하고, 한 묶음
  안에서 동시에 실행 중인 primary 변경의 최대 개수는 1이다.
- **SC-057**: 유효한 비공백 fallback과 `success=false`를 반환하는 canonicalization·entity-linking
  합성 검증에서 해당 값은 snapshot과 KG·semantic 구조화 필드에 100% 일치하고, confidence는 같은
  snapshot의 failure flag 감점을 반영한다. 사용자 지정 하한을 넘으면 primary 처리되며 skipped는
  증가하지 않는다.
- **SC-058**: 비어 있지 않은 triple 목록에 누락·비객체 `extractionInfo`, 누락·비객체 `steps`,
  non-boolean step 값을 각각 넣은 검증은 원본 조회·confidence·통계·상태 변경 전에 실패한다.
  같은 metadata와 `triples=[]`인 대조군은 조회 없이 0건 결과를 반환한다.
- **SC-059**: 유효 confidence를 계산한 뒤 저장 하한 제외, coalescing, 후보 판정 운영 실패 및
  primary rollback을 각각 발생시킨 검증에서 confidence 통계 표본은 원본 입력당 정확히 1개이며,
  정규화 실패로 confidence를 계산하지 못한 입력의 표본 증가량은 0이다.
- **SC-060**: 생성·갱신·정책 제외·운영 실패·coalescing을 섞은 N개 입력 검증에서
  `created + updated + skipped + duplicates = N`이고 각 위치의 중복 분류는 0건이다. primary가
  실패한 coalesced 그룹도 대표는 skipped 1건, 나머지는 duplicates로 대사된다.
- **SC-061**: N개 triple 처리 중 첫 triple 뒤 원본 옵션의 episodic importance와 두 하한을
  변경하는 검증에서 모든 N개 판단값은 호출 시작 snapshot과 100% 일치하고, 변경값은 다음 호출의
  첫 triple부터 적용된다. 실제 빈 배열 대조군은 옵션 접근 없이 0건 결과를 반환한다.
- **SC-062**: primary 커밋 뒤 통계 기록과 debug·warn·error 로그가 각각 예외를 내도록 한 검증에서
  커밋 행, created·updated·skipped·duplicate, semantic ID, 원본 성공 상태와 자동 retry count는
  관측 실패가 없는 대조군과 100% 일치하며 원래 처리 예외가 있는 경우 그 오류가 유지된다.
- **SC-063**: 관계 방향·타입 계약 오류 검증은 첫 memory·KG·관계 변경 전에 실패한다. 계약 통과
  뒤 관계와 임베딩 운영 실패를 각각 또는 동시에 주입한 검증에서는 primary 결과와 다른 후속 작업의
  실행 여부가 대조군과 일치하고, 두 작업의 완료 순서를 성공 조건으로 요구하지 않는다.
- **SC-064**: 복수 생성·갱신·rollback·정책 제외·coalescing을 섞은 검증에서 반환 semantic ID는
  created·updated가 커밋된 고유 대상 집합과 100% 일치하고 각 ID는 한 번만 나타나며 순서는 각
  대상의 첫 성공 원본 위치 오름차순이다.
- **SC-065**: primary 커밋 뒤 양방향 관계 각각에 중복·운영 실패를 교차 주입한 검증에서 두 방향의
  시도 횟수는 각각 1이고 중복은 오류로 집계되지 않는다. 한 방향 실패 시 다른 방향 성공 건수와
  primary 행·outcome·semantic ID·원본 성공 상태는 실패 없는 대조군과 100% 일치한다.
- **SC-066**: 유효 triple 사이에 sparse 위치·`null`·배열·문자열을 각각 넣은 N개 위치 검증에서
  해당 위치는 confidence 표본과 상태 변화량이 0이고 skipped가 각각 1 증가한다. 나머지 유효 위치는
  정상 처리되며 created·updated·skipped·duplicate 합은 N이다.
- **SC-067**: 비어 있지 않은 요청의 episodic ID에 비문자열·공백을, 각 선택적 수치 옵션에 `null`·
  boolean·숫자 문자열을 넣은 검증은 원본 조회·confidence·통계·상태 변경 전에 모두 실패한다.
  같은 입력과 실제 빈 배열의 대조군만 옵션 접근 없이 0건 결과를 반환한다.
- **SC-068**: N개 triple 요청의 입력 snapshot 확정 뒤 원본 배열의 길이·순서, triple 필드와 필수
  extraction metadata를 변경하는 검증에서 confidence 표본·coalescing·관계 metadata·outcome은
  호출 시작 snapshot과 100% 일치하고 변경값은 다음 호출의 첫 위치부터 적용된다.
- **SC-069**: 기존 동일 관계와 동시 duplicate constraint를 양방향에 각각 주입한 검증에서 호출은
  성공하고 관계 row 수·confidence·metadata·생성시각의 변화량은 모두 0이며 duplicate 운영 실패
  집계도 0이다.
- **SC-070**: 관계와 임베딩 후속 작업을 지연시키고 성공·실패를 교차 주입한 검증에서 semantic
  갱신 promise가 반환되는 시점에는 예정된 작업의 정산 수가 100%이고, 반환 뒤 추가 상태·로그·
  outcome 변화량은 0이며 작업 완료 순서는 성공 조건에 영향을 주지 않는다.
- **SC-071**: 비어 있지 않은 요청의 `failureReason`에 각 기존 정의 코드·미제공 값을 넣은 검증은
  정상 처리되고 알 수 없는 문자열·비문자열 값은 원본 조회 전에 모두 실패한다. 모든 검증에서
  `rawLLMOutput`의 snapshot·관계 metadata·DB·이 기능 로그 출현 건수는 0이다.
- **SC-072**: 아직 성공하지 않은 한 원본의 하나 이상 semantic primary 변경 뒤 성공 상태 쓰기
  실패를 주입한 검증에서 해당 원본의 memory·KG primary 행, created·updated와 반환 semantic ID
  변화량은 모두 0이고 원본은 성공 상태가 아니다. 같은 원본의 다음 자동 재시도는 각 evidence
  occurrence를 정확히 한 번만 반영한다.
- **SC-073**: 수락·coalescing·정책 제외를 섞고 관계 생성을 지연·실패시킨 검증에서 성공 row의
  `triple_extracted=1`, `triple_extracted_status='success'`, `triple_count`와 `confidence_avg`는
  primary commit outcome과 100% 일치한다. 관계 행의 유무·confidence를 바꿔도 `confidence_avg`는
  변하지 않고 수락 occurrence가 0이면 해당 키가 없다.
- **SC-074**: 같은 빈 추출 결과를 semantic 갱신 서비스와 자동 변환 경계에 각각 넣은 검증에서
  전자는 조회·쓰기·후속 작업 0건의 0건 결과를 반환하고, 후자는 semantic·KG·관계·embedding
  변화량 0인 채 원본에 기존 `no_triple` 실패 상태와 retry metadata를 정확히 한 번 기록한다.
- **SC-075**: 아직 성공 처리되지 않은 같은 원본을 `skipConverted=true`인 N개 호출이 동시에
  처리한 검증에서 원본 성공 전환은 1건, semantic evidence occurrence와 관계 쌍은 각각 1회분이며
  패한 호출은 각각 skipped 한 건이고 failed·retry·created·updated·semantic ID 증가량은 0이다.
  `skipConverted=false` 대조군은 기존대로 N개 호출을 각각 새 occurrence로 반영한다.
- **SC-076**: conversion commit 뒤 관계·임베딩·통계·로그 예외를 각각 또는 함께 주입한 검증에서
  원본 성공 tuple, committed primary 행, created·updated·semantic ID는 실패 없는 대조군과 100%
  일치하고 failed 상태 write와 자동 retry count 증가량은 모두 0이다.
- **SC-077**: 기존 성공 원본의 명시적 강제 재처리에 no-triple, validation 오류와 pre-commit
  운영 실패를 각각 주입한 검증에서 이번 호출의 failed 결과는 1건이지만 원본 성공 tuple·metadata,
  기존 semantic·KG·관계 행은 재처리 전과 100% 일치하고 정상 자동 retry 대상 증가량은 0이다.
- **SC-078**: 동일한 성공·정책 제외·no-triple·pre-commit·post-commit 실패 시나리오를 명시적
  변환 도구와 예약 batch에 각각 적용한 검증에서 source 상태 tuple, retry count, primary 행 변화와
  각 진입점의 기존 outcome 수치는 의미상 100% 일치하고 직접 semantic 갱신 호출의 source 상태
  변화량은 0이다.
- **SC-079**: 아직 성공하지 않은 같은 원본의 N개 genuine pre-commit 실패를 순차·동시 실행한
  검증에서 유실 없는 `retry_count` 증가량은 N이고 기존 최대 재시도에서 정확히 한 번 abandoned로
  전이한다. 같은 경쟁에서 success가 먼저 커밋된 대조군은 이후 failed·abandoned write와 retry
  증가량이 0이다.
- **SC-080**: 원본 snapshot 확정 뒤 content·importance·owner/project·type·활성 상태를 각각
  변경하거나 원본을 제거한 검증에서 해당 시도의 semantic·KG primary, source 상태, created·updated·
  semantic ID와 retry count 변화량은 모두 0이고 skipped만 1 증가하며, 다음 호출은 변경된 현재
  원본 snapshot만 사용한다.
- **SC-081**: primary 0건인 합성 묶음에서 저장 하한 정책 제외만 있는 검증은 success이고 retry
  증가량이 0이다. sparse·malformed·정규화·confidence·후보 판정 실패를 각각 하나 이상 포함한
  검증은 failed이며 retry count가 정확히 1 증가하고, primary 1건 대조군은 부분 성공이다.
- **SC-082**: 외부 추출·정규화·confidence·후보 판정용 입력 embedding 생성·비교를 지연시킨
  검증에서 열린 conversion write transaction 중 해당 작업 호출 수는 0이다. 계산 뒤 source·candidate를
  변경한 검증은 stale primary를 0건 커밋하고, 변경이 없는 대조군은 기존 primary·성공 결과와 100%
  일치한다. semantic embedding은 commit 뒤에 시작한다.
- **SC-083**: candidate 자격을 첫 commit 재검증 전에 한 번 변경한 검증에서 첫 transaction의
  primary·outcome·ID 변화량은 0이고, transaction 밖 재판정과 새 transaction은 각각 정확히 1회다.
  두 번째 재검증도 실패한 대조군은 추가 재판정 없이 skipped 1건의 pre-primary 운영 실패이며 열린
  write transaction 중 embedding·similarity 호출 수는 0이다.
- **SC-084**: 예약 batch가 원본 A 처리를 시작한 뒤 deadline에 도달하도록 한 검증에서 A의 commit과
  예정 후속 작업 정산은 100% 완료되고 A만 기존 outcome 하나에 집계된다. 미시작 원본 B~N의 source·
  semantic·KG·관계·retry 변화량과 processed·success·failed·skipped 포함 건수는 모두 0이며 기존
  timeout 표시는 설정된다.
- **SC-085**: 같은 batch의 원본 A 성공, B 실패, C 성공을 순서대로 주입한 검증에서 A와 C의 committed
  primary·source 성공 tuple은 유지되고 C 처리 횟수는 1이다. B만 기존 실패·retry 계약을 적용받으며
  batch의 processed와 success·failed·skipped 합계는 실제 종결 원본 수와 정확히 일치한다.
- **SC-086**: genuine pre-commit 실패의 primary rollback 뒤 failure-state transaction commit
  실패를 주입한 검증에서 semantic·KG primary, source status·metadata·retry count 변화량은 모두
  0이고 현재 실행의 failed 결과와 상태 기록 오류는 각각 기존 결과·로그에 나타난다. 다음 실행의
  대상 조회에는 해당 원본이 다시 포함된다.
- **SC-087**: conversion commit 직후 후속 관계·embedding 정산 전에 프로세스 종료를 모사하고 DB를
  다시 연 검증에서 committed semantic·KG primary와 source 성공 tuple은 종료 전 값과 100% 일치하고
  failed write·retry 증가·evidence 재가산은 0건이다. 종료 전에 commit되지 않은 후속 행은 완료된
  것으로 합성되지 않는다.
- **SC-088**: `created_at`이 앞선 backoff·abandoned·soft-delete 원본 K개와 뒤의 적격 원본 N개를
  두고 `batchSize=N`으로 실행한 검증에서 선택·처리 대상은 적격 N개와 100% 일치하고 ID 동률 순서는
  오름차순이며, 앞의 K개가 소비한 limit과 processed·success·failed·skipped 건수는 모두 0이다.
- **SC-089**: failed 원본의 retry metadata에 비JSON, 배열, 음수·소수 retry count, 잘못된 시각,
  음수·`NaN`·무한 backoff를 각각 넣은 검증에서 extractor·source·semantic·KG·관계·retry 변화량은
  모두 0이고 원본 ID와 정규화된 사유의 경고가 각각 1건 이상 확인된다. metadata 부재 대조군은
  retry count 0인 적격 원본으로 한 번 처리된다.
- **SC-090**: 저장된 due time 직전·정확한 시각·직후를 비교한 검증에서 직전만 제외되고 나머지는
  적격이다. 실행 설정의 backoff 값을 바꿔도 저장된 due time은 변하지 않으며, 지연 필드가 없는
  대조군만 새 설정을 사용하고 미래 `last_attempt` 원본의 상태 변화량은 0이다.
- **SC-091**: batch 선택 뒤 source를 성공·abandoned·soft-delete·삭제하거나 content·importance·
  owner/project·type을 각각 바꾼 검증에서 extractor·semantic·KG·관계·retry 변화량은 모두 0이고
  각 원본은 processed와 skipped에 정확히 1건씩만 반영된다. 변하지 않은 대조군은 한 번 처리되며
  commit 시 FR-084 재검증도 수행된다.
- **SC-092**: 양의 정수가 아닌 `batchSize`·`chunkSize`·`maxRetries`, 1이 아닌 `parallelism`,
  음수·비유한 `timeout`·`chunkDelayMs`, 빈 배열 또는 음수·비유한 원소를 가진
  `retryBackoffDays` 검증은 대상
  조회와 source·semantic·KG·관계 상태 변경 전에 모두 설정 오류로 종료된다. 0 timeout은 timeout
  표시와 0건 집계, 0 delay·backoff는 각각 무지연·즉시 retry로 정상 처리된다.
- **SC-093**: `maxRetries=1`인 미처리 원본의 첫 genuine pre-commit 실패 검증에서 retry count는
  정확히 1이고 상태는 같은 failure-state commit에서 abandoned이며 이후 batch의 extractor 호출
  증가는 0이다. `maxRetries=N` 대조군은 N번째 실패에서 정확히 한 번 abandoned로 전이한다.
- **SC-094**: `retryBackoffDays=[1, 2]`, `maxRetries=4`인 순차 실패 검증에서 retry count 1·2·3의
  저장 지연은 각각 1·2·2이고 네 번째 실패는 abandoned이며 `next_retry_after_days`가 없다. 배열의
  0 원소 대조군은 due time이 `last_attempt`와 정확히 같다.
- **SC-095**: NULL/0 flag와 NULL·빈 status인 미처리 tuple 및 NULL/0과 failed인 retry tuple만
  대상 자격을 얻는다. 일관된 success·abandoned tuple은 경고 없이 정상 제외된다. 1+failed,
  0+success, 1+NULL, 알 수 없는 status와 0/1 밖 flag의 검증은 limit·extractor·processed·success·
  failed·skipped·retry 변화량이 모두 0이고 원본 ID와 정규화된 사유의 경고가 각각 1건 이상 확인된다.
- **SC-096**: 첫 chunk 완료 뒤 남은 timeout 예산이 `chunkDelayMs`보다 짧은 검증에서 예약된 지연은
  남은 예산 이하이고 deadline 뒤 다음 chunk의 extractor 호출과 source·semantic·KG·관계·retry·
  outcome 변화량은 모두 0이며 timeout 표시는 정확히 한 번 설정된다.
- **SC-097**: execute의 설정 snapshot 확정 뒤 `batchSize`·`chunkSize`·`timeout`·`maxRetries`·
  `parallelism`·`chunkDelayMs`와 원본 `retryBackoffDays` 배열을 변경하는 검증에서 현재 실행의 대상·
  지연·retry·로그 값은 시작 snapshot과 100% 일치하고, 변경값은 다음 execute의 검증과 첫 처리부터
  적용된다.
- **SC-098**: `parallelism`에 0·2·소수·`NaN`을 각각 설정한 검증은 대상 조회·extractor·source·
  semantic·KG·관계 상태 변경 전에 모두 설정 오류로 종료되고, 값 1인 대조군에서 한 execute 안의
  동시 source 처리 최대 개수는 1이다. 겹친 두 execute의 동일 source 대조군은 FR-079대로 한 번만
  커밋한다.
- **SC-099**: `batchSize=N` candidate set 확정 뒤 K개를 stale로 만들고 K개의 새 적격 원본을 추가한
  검증에서 현재 execute의 추가 대상 조회는 0회이고 처리·skipped·미시작 대상은 최초 candidate set의
  ID에만 속한다. 새 K개는 다음 execute의 대상이 되며 현재 processed는 N을 넘지 않는다.
- **SC-100**: candidateCount가 0, 1, `chunkSize-1`, `chunkSize`, `chunkSize+1`인 검증에서 chunk 수는
  각각 0, 1, 1, 1, 2이고 모든 chunk는 비어 있지 않으며 원본 ID의 연결 결과가 최초 선택 순서와
  100% 일치한다. 각 원본은 정확히 한 chunk에 나타나고 지연 횟수는 `max(chunkCount-1, 0)`이다.
- **SC-101**: retry 선택 snapshot 뒤 wall clock을 앞·뒤로 이동시킨 검증에서 현재 candidate set은
  변하지 않고, timeout은 단조 경과시간이 설정 예산에 도달할 때 정확히 한 번 발생한다. 한 source
  실패·abandoned 전이의 관련 metadata timestamp는 동일 UTC 값이고 신규 clock 상태 행은 0개다.
- **SC-102**: 대상 0건, 첫 원본 전 timeout, 모든 원본 failed, 모든 원본 skipped, 일부 처리 뒤
  timeout 및 job-level 대상 조회 오류 검증에서 batch `success`는 순서대로 false, false, true, true,
  true, false이고 `processed = details.success + details.failed + details.skipped`가 실제 종결 원본 수와
  일치한다.
- **SC-103**: 각 선택적 batch 설정을 미제공·`undefined`로 둔 검증은 기존 기본값 snapshot과 100%
  일치한다. 같은 필드에 `null`·boolean·숫자 문자열·잘못된 scalar/array와 sparse backoff 배열을
  넣은 검증은 대상 조회·extractor·source·semantic·KG·관계 상태 변경 전에 모두 설정 오류로 종료된다.
- **SC-104**: `retryBackoffDays=0.5`인 검증의 due time은 `last_attempt`에서 정확히 12시간 뒤이고
  직전에는 제외, 정확한 시각부터 적격이다. timezone 없는 시각과 표현 범위를 넘는 due 계산 검증은
  extractor·source·semantic·retry 변화량 0으로 격리되고 정규화된 경고가 각각 1건 이상 확인된다.
- **SC-105**: 선택 source의 content에 non-string·빈 문자열·공백을, non-NULL importance에 -0.1·1.1·
  `NaN`·무한대를 각각 넣은 검증에서 extractor·semantic·KG·관계 호출 수는 0이고 processed·failed와
  retry count가 기존 genuine pre-commit 실패 계약대로 각각 한 번 증가한다. NULL importance 대조군은
  0.5로 정상 처리된다.
- **SC-106**: failed→success와 failed→abandoned 전이 검증에서 저장 metadata 키 집합은 각각
  success·abandoned 정규 형태와 100% 일치하고 이전 상태 전용 키 출현 수는 0이다. abandoned의
  `last_attempt`와 `abandoned_at`은 동일 UTC 값이며 실패한 기존 성공 강제 재처리의 metadata 변화량은 0이다.
- **SC-107**: N개 candidate 중 K개를 종결한 뒤 chunk·job orchestration 오류를 주입한 검증에서
  `processed=K`, 세부 outcome과 ID는 durable 종결 prefix와 100% 일치하고 나머지 N-K개의 source·
  semantic·KG·관계·retry 변화량 및 합성 outcome은 0이다. batch `success`는 false이고 오류 관측의
  raw content 출현 건수는 0이다.
- **SC-108**: 마지막 source가 deadline 뒤에 정산되지만 남은 candidate가 없는 검증과 deadline이
  다음 source·chunk 시작을 막는 검증에서 `endTime >= startTime`, `duration = endTime - startTime`이고
  `timeoutOccurred`는 각각 false·true다. timeout과 무관한 치명 오류 대조군의 flag도 false다.
- **SC-109**: success·stale skipped·failed commit·abandoned commit·failure-state commit 실패를
  각각 한 번 포함한 execute에서 `retryCounts`의 key는 failed·abandoned commit source 두 개와
  정확히 일치하고 값은 각 persisted `retry_count`와 100% 같다. 다른 source와 미확정 source의
  map entry 증가량은 0이다.
- **SC-110**: `batchSize`·`chunkSize`·`maxRetries`와 persisted `retry_count`에 안전 정수 경계값과
  그 밖의 값을 각각 넣은 검증에서 경계값은 정확히 보존되고 unsafe 설정은 대상 조회 전 실패,
  unsafe metadata는 extractor·상태 변화 0건으로 제외된다. retry count가 현재 max 이상인 유효
  failed source도 상태·metadata 변화량 0, 경고 1건 이상이며 자동 abandoned되지 않는다.
- **SC-111**: 같은 job 인스턴스의 두 execute가 겹쳐 일부 동일 source를 선택한 검증에서 두 결과의
  start/end/duration·candidate ID·timeout·errors·warnings·counts·retry map은 각 실행 사건과 100%
  일치하고 교차 오염은 0건이다. 동일 source의 durable conversion commit은 1건이며 패한 실행은
  processed·skipped를 각각 1 증가시키고 retry는 증가하지 않는다.
- **SC-112**: source A가 semantic X를 생성하고 source B가 X를 갱신한 뒤 source C가 rollback되는
  검증에서 batch `semanticMemoriesCreated=1`, `semanticMemoriesUpdated=1`이고 C의 증가량은 0이다.
  같은 X의 최종 활성 row 수 1과 무관하게 두 수치는 각 durable source primary outcome의 합과 100%
  일치한다.
- **SC-113**: success·failed·skipped, 일부 처리 뒤 timeout과 job-level 치명 오류를 각각 조합한
  모든 검증에서 top-level `processed = details.processed = details.success + details.failed +
  details.skipped`가 성립하고, 미확정·미시작 source가 합계에 나타나는 건수는 0이다.
- **SC-114**: 같은 job 인스턴스를 서로 다른 두 in-memory DB handle로 순차·동시 execute한 검증에서
  각 DB의 source·semantic·KG·관계 변화와 반환 outcome은 해당 DB 입력에만 100% 일치하고 다른 DB의
  ID·행·service 상태 출현 건수는 0이다. 명시적 주입 service 대조군은 주입 계약을 유지한다.
- **SC-115**: 잘못된 execution policy 검증의 schema ensure·service 생성·대상 조회 호출 수와 DB
  변화량은 모두 0이다. 유효 정책 뒤 schema ensure·service 생성·대상 조회 실패를 각각 주입한
  검증은 `success=false`, `processed=0`, details outcome·retry·timeout 변화량 0의 job-level 오류를
  반환한다.
- **SC-116**: extractor가 null·배열·비객체, 비배열 `triples`, 비객체 `extractionInfo`와 알 수 없는
  failure reason을 각각 반환한 검증에서 semantic·KG·관계 변화량은 0이고 persisted 사유는 기존
  `llm_parse_fail`이며 retry가 한 번 정산된다. 유효한 빈 배열 대조군은 허용된 사유 또는 기본
  `no_triple`을 사용하고 metadata·batch 오류의 raw output 출현 건수는 0이다.
- **SC-117**: 한 execute 반환 뒤 `startTime`·`endTime`, errors·warnings와 retryCounts를 변경하고
  같은 job 인스턴스를 다시 또는 겹쳐 실행한 검증에서 다른 결과와 내부 집계의 변화량은 0이고,
  각 실행의 Date·배열·Map identity는 서로 다르며 공개 필드 타입은 기존과 100% 일치한다.

## Brainstorm Log

### 2026-08-25 — 추천안 일괄 확정

- 저장 경계는 기본·사용자 지정 하한 모두 strict greater-than으로 통일하고, 잘못된 사용자 지정
  하한은 clamp하지 않고 상태 변경 전에 거부하기로 했다.
- 수락된 증거는 `num_times`를 기준으로 동일 가중 평균 confidence에 반영하며, legacy NULL 행은
  첫 새 confidence를 기존 증거 전체의 대표값으로 삼아 추가 스키마 없이 누적한다.
- importance는 최신 episodic importance와 aggregate confidence의 곱으로 계산하고, 반복 boost는
  aggregate confidence가 정확히 1이며 base importance가 양수일 때만 허용한다.
- 명시적 episodic importance 0은 누락값과 구분해 끝까지 0으로 보존한다. 이 결정으로 기존
  `|| 0.5` 경계에서 발생하던 값 유실을 요구사항으로 잠갔다.
- semantic 병합은 `num_times`만 증가시키고 `recall_count`는 건드리지 않으며, 동시 병합은 항목별
  원자성을 보장하되 전역 직렬화는 도입하지 않는다.
- 관계 방향·타입 검증을 통과한 뒤의 관계·임베딩 운영 실패는 semantic 품질 갱신을 롤백하지 않고
  기존 로그로 관측한다. 신규 상시 텔레메트리, 제외 원문 저장소, 스키마 필드 및 전역 lock은
  범위에서 제외했다.
- 운영 분포는 읽기 전용 집계만 사용하고 저장소에는 집계·식별자·해시와 합성 픽스처만 남긴다.
- 기존 SC-006의 “100% 감소” 표현은 곱셈 정책과 모순되어, 정책 식과 감소량이 정확히 일치하는지
  검증하는 기준으로 교체했다.

### 2026-08-25 — 2차 추천안 일괄 확정

- 계산 결과 자체가 유효하지 않은 confidence는 triple 단위로 격리해 같은 묶음의 정상 triple을
  살리고, 요청 공통 입력인 저장 하한과 episodic importance 오류는 첫 변경 전에 전체 거부한다.
- strict 저장 경계의 양 끝을 명시해 하한 0에서는 confidence 0만, 하한 1에서는 모든 confidence를
  제외하도록 확정했다.
- 관계 방향·타입 검증을 통과한 뒤의 관계·임베딩 운영 실패는 이미 반영된 semantic 증거를
  보존하고 원본 변환을 성공 처리해 자동 전체 재시도로 인한 중복 가산을 막는다. 계약 검증 오류는
  기존대로 전파한다.
- 기존 명시적 강제 재처리는 호환성을 위해 새 수락 처리로 남긴다. idempotent 증거 교체와 신규
  idempotency 저장소는 #805 범위를 넘어가므로 추가하지 않는다.
- 공개 도구 계약과 스키마는 유지하고, 의도된 경계 변경과 legacy NULL 처리 방식을 Compatibility
  Notes에 명시했다.

### 2026-08-25 — 3차 추천안 일괄 확정

- 자동 semantic이 원본 episodic의 owner/project를 상속하고 동일 scope 안에서만 병합되도록 해
  confidence·importance 증거가 다른 소유자나 프로젝트 사이에서 섞이지 않게 했다.
- 사용자 작성 semantic은 자동 품질 집계 대상에서 제외해 사용자가 지정한 confidence·importance를
  보존한다.
- 신규 자동 provenance는 기존 `origin_source`에 기록하고, legacy 항목은 기존 `extracted_from`
  관계가 있을 때만 자동 생성으로 인정한다. provenance를 추정하거나 일괄 보정하지 않는다.
- KG 대표 항목이 scope·provenance 조건에 맞지 않으면 그 항목을 건드리지 않고 scoped semantic
  검색과 생성으로 계속한다.
- soft-delete된 semantic은 후보에서 제외하고, 원본 episodic의 존재·타입·활성 상태와 scope는 첫
  변경 전에 한 번 검증해 묶음 전체에서 같은 snapshot을 사용한다.
- 빈 triple 묶음의 기존 no-op을 유지하고, 손상된 legacy 후보와 stale KG 대표는 건너뛴다. 복수
  후보는 exact 우선 후 생성시각·ID 순으로 결정해 실행마다 대상이 바뀌지 않게 했다.
- `kg_triple` unique 제약 마이그레이션, 신규 idempotency 저장소 및 기존 provenance backfill은
  추가하지 않았다. 기존 필드·관계·fallback만 재사용하는 최소 변경으로 범위를 고정했다.

### 2026-08-26 — 4차 추천안 일괄 확정

- 한 번이라도 1 미만이 된 aggregate confidence는 반복적인 confidence 1 증거와 부동소수점
  반올림으로 정확히 1이 되지 않게 해 boost 자격이 되살아나는 경계를 차단했다.
- 같은 episodic 호출에서 동일 정규화 triple 또는 같은 semantic으로 귀결되는 입력은 하나의
  evidence occurrence로 합치고, 최고 confidence와 그 대표 관계 메타데이터를 한 번만 반영한다.
- 신규 semantic 기본 항목과 KG 연결은 primary 원자 단위로 묶어 KG 예외 시 고아 semantic을 남기지
  않는다. 이미 성공한 semantic 뒤의 관계·임베딩 후속 실패 계약과는 분리했다.
- 유사 후보는 활성·scope·provenance·predicate 조건으로 먼저 줄이고 입력 embedding을 호출 안에서
  재사용한다. 영속 캐시, 신규 인덱스, 의존성 및 스키마는 추가하지 않았다.

### 2026-08-26 — 5차 추천안 일괄 확정

- 후보 조회·embedding 실패로 유사 여부를 판정할 수 없으면 후보 없음으로 간주해 중복 semantic을
  만들지 않고 해당 triple을 운영 실패로 격리한다. 적격 후보가 실제 0건일 때만 생성한다.
- created·updated·skipped와 반환 semantic ID는 primary 커밋 결과에 맞추고 rollback 또는
  pre-primary 실패가 성공 수치로 새지 않게 했다.
- 다른 scope·사용자 작성·soft-delete 후보는 content·embedding 접근 전에 제외하며, 전역 KG
  대표는 자격 확인용 최소 정보 외의 내용을 읽거나 로그에 사용하지 않는다.
- 실패·제외 관측에는 raw triple·semantic content·embedding 대신 기존 원본 ID·입력 위치·사유만
  사용해 데이터 노출을 막았다.
- 운영 실패로 primary 커밋이 0건이면 원본을 성공 처리하지 않아 안전한 전체 재시도를 허용하고,
  일부라도 커밋됐으면 성공과 전체 자동 재시도 금지를 유지해 중복 증거를 막는다. 신규 retry 큐,
  checkpoint, 인증 체계 및 공개 필드는 추가하지 않았다.

### 2026-08-26 — 6차 추천안 일괄 확정

- 전역 KG 대표가 scope·provenance·활성·구조·집계값 조건상 병합 부적격인 경우 새 scoped semantic은
  KG 대표권 없이 정상 fallback으로 저장하고 이후 scoped 후보 검색으로 재사용하도록 해, primary
  원자성 문구와 전역 unique 유지 정책의 모순을 해소했다.
- 같은 scope의 동일 triple이 동시에 처음 생성되어도 활성 자동 semantic 하나로 수렴하고 각 독립
  evidence occurrence를 채택된 항목에 한 번씩 반영한다. 신규 전역 lock은 추가하지 않는다.
- 후보 선택과 갱신 사이에 scope·활성·provenance가 바뀌면 원자적 자격 검증으로 갱신을 막고 한 번
  재판정한 뒤에도 안전한 대상이 없으면 해당 triple을 제외한다.
- legacy confidence의 non-NULL 손상값과 정확히 증가시킬 수 없는 `num_times`는 병합 후보에서
  제외한다. NULL confidence의 기존 초기화는 유지하고 손상값 clamp·reset·backfill은 추가하지
  않았다.
- 동시 병합에서 최신 episodic importance는 primary 커밋 순서로 정해 마지막 커밋 occurrence의
  값을 사용한다. 별도 event timestamp 정렬 필드는 추가하지 않았다.

### 2026-08-26 — 7차 추천안 일괄 확정

- 비어 있지 않은 요청의 사용자 지정 similarity threshold는 유한한 0~1 값으로 제한하고 원본 조회
  전에 검증한다. clamp나 자동 기본값 대체는 하지 않으며 빈 triple 묶음의 기존 no-op은 우선한다.
- 기존 `similarity >= threshold` 경계를 유지해 동점은 일치로 판정하고, 하한 0과 1의 의미를
  명시했다. exact 구조 일치의 우선순위도 그대로 유지한다.
- 유효하지 않은 similarity 계산 결과는 불일치로 축소해 중복 semantic을 만들지 않고 판정 불가로
  격리한다. 신규 계산식·embedding 모델·영속 상태는 추가하지 않았다.
- 추출 triple 필드는 문자열과 정규화 후 비공백 조건을 만족해야 한다. 잘못된 필드는 후보 조회와
  embedding 전에 triple 단위로 제외하고, raw 값 강제 변환이나 fallback KG 식별은 허용하지 않는다.

### 2026-08-26 — 8차 추천안 일괄 확정

- 추출 결과 자체 또는 `triples` 컨테이너가 malformed이면 빈 결과로 축소하지 않고 원본 조회 전에
  전체 요청을 거부한다. 실제 빈 배열의 기존 no-op만 유지한다.
- canonicalization·entity linking 예외나 비문자열·빈 결과는 부분 정규화·raw fallback 없이 해당
  triple의 pre-primary 운영 실패로 격리하고 같은 묶음의 다음 유효 triple을 계속 처리한다.
- 한 triple의 정규화·링킹 결과를 단일 snapshot으로 만들어 confidence, 후보 판정, KG 식별과 저장에
  재사용한다. 정규화 알고리즘, 호출 간 캐시 및 신규 상태는 추가하지 않았다.
- coalescing된 occurrence의 primary 변경과 고유 ID 반환은 대상별 첫 입력 위치 순으로 직렬화한다.
  묶음 내부 병렬화는 추가하지 않고 서로 다른 호출의 기존 항목별 동시성은 유지한다.

### 2026-08-26 — 9차 추천안 일괄 확정

- 유효한 fallback 값과 `success=false`는 정규화 계약 실패가 아니라 confidence를 낮추는 정상 품질
  신호로 분리했다. 이로써 canonicalization 실패 표본 저장 시나리오와 예외·잘못된 반환값 격리
  시나리오의 충돌을 해소했다.
- 비어 있지 않은 결과의 `extractionInfo.steps`를 primary 처리 전에 검증해 metadata 오류가 저장
  뒤에 드러나지 않게 했다. 실제 빈 배열의 no-op은 이 검증보다 우선한다.
- 기존 confidence 분포는 저장 성공 여부가 아니라 계산 가능한 원본 입력 품질을 나타내도록 각
  유효 계산값을 한 번 포함한다. 신규 텔레메트리나 영속 표본 저장소는 추가하지 않았다.
- created·updated·skipped·duplicate를 원본 입력 위치별 상호배타적 결과로 정의해 합계가 입력 수와
  항상 대사되게 했다. 공개 결과 필드는 늘리지 않고 기존 duplicate 통계를 재사용한다.

### 2026-08-26 — 10차 추천안 일괄 확정

- 비어 있지 않은 호출은 episodic ID·importance 제공 상태와 값, confidence·similarity 하한을 한
  번 캡처·검증한 policy snapshot으로 처리해 외부 옵션 변경이 묶음 중간의 판단을 바꾸지 않게 했다.
- 기존 통계와 구조화 로그를 best-effort 관측 부수효과로 한정해 기록 실패가 primary 결과·반환 ID·
  원본 성공 상태·재시도 여부를 바꾸거나 원래 오류를 가리지 않게 했다.
- 관계 방향·타입 계약은 첫 primary 변경 전에 검증해 기존 오류 전파를 보존하면서 부분 커밋을
  막았다. 검증 뒤 관계·임베딩은 서로 독립적인 후속 작업으로 두고 완료 순서는 보장하지 않는다.
- 반환 semantic ID는 created·updated가 커밋된 고유 대상만 첫 성공 입력 위치 순으로 한 번 포함해
  outcome 카운트와의 대사 의미를 고정했다. 신규 설정·저장소·재시도 큐·공개 필드는 추가하지 않았다.

### 2026-08-26 — 11차 추천안 일괄 확정

- `extracted_from`과 `supported_by`를 독립 best-effort 관계로 확정했다. 각 방향을 모두 시도하고
  기존 중복은 성공한 no-op으로 처리하며 한 방향 실패가 다른 방향이나 primary를 취소하지 않는다.
- 유효한 `triples` 배열의 sparse·`null`·비객체 위치는 전체 요청 오류가 아니라 triple 단위
  skipped로 격리해 나머지 유효 위치와 원본 수 대사를 보존한다.
- episodic ID는 비공백 문자열로 제한하고 선택적 수치 옵션은 미제공·`undefined`에만 기본값을
  적용한다. `null`·boolean·숫자 문자열 coercion은 허용하지 않는다.
- 개별 triple 처리를 시작하기 전에 배열 순서·triple 필드·필수 extraction metadata를 값 snapshot으로 고정해
  호출 중 외부 mutation이 confidence·관계·통계·결과를 바꾸지 않게 했다. 범용 deep clone,
  관계 reconciliation 저장소·작업 및 신규 공개 필드는 추가하지 않았다.

### 2026-08-26 — 12차 추천안 일괄 확정

- 기존 또는 동시 생성된 동일 출처 관계는 성공한 무변경 no-op으로 확정해 관계 confidence·metadata를
  반복 처리 순서에 따라 덮어쓰지 않게 했다. 관계 occurrence 이력은 추가하지 않았다.
- 관계·임베딩 후속 작업은 서로 독립적으로 시도하되 모두 정산된 뒤 semantic 갱신 호출을 반환해,
  반환 뒤 숨은 작업이 결과를 바꾸지 않도록 했다. detached 작업 큐는 추가하지 않았다.
- 선택적 failure reason은 기존 정의 코드만 허용하고, raw LLM 출력은 semantic snapshot·관계
  metadata·DB·이 기능의 로그에 전달하지 않는 경계를 명시했다.
- 원본 episodic 한 건의 semantic primary 변경과 성공 상태 기록을 같은 DB 커밋 단위로 묶어 상태
  쓰기 실패 뒤 자동 재시도가 증거를 중복 가산하는 모호성을 제거했다. 관계·임베딩은 커밋 뒤
  best-effort로 유지하고 신규 idempotency 저장소·분산 트랜잭션·공개 필드는 추가하지 않았다.

### 2026-08-27 — 13차 추천안 일괄 확정

- 성공 상태 tuple 전체를 semantic primary와 같은 commit unit으로 확정하고, `confidence_avg`는
  post-commit 관계가 아니라 현재 호출에서 커밋된 coalesced evidence confidence로 계산하도록
  했다. 수락 occurrence가 없으면 해당 필드는 생략한다.
- 빈 배열은 semantic 갱신 서비스에서는 조회 없는 no-op, 자동 변환에서는 기존 `no_triple` 실패·
  retry 경로로 명확히 분리했다. semantic primary와 관계·embedding은 어느 경로에서도 실행하지
  않는다.
- 같은 미변환 원본의 정상 자동 변환 경쟁은 기존 변환 자격을 성공 전환 조건으로 재확인해 단일
  승자만 커밋하도록 했다. 패자는 자신의 primary를 rollback하며 명시적 강제 재처리의 새 occurrence
  의미는 유지한다.
- conversion commit을 성공 point of no return으로 정해 이후 관계·embedding·관측 실패가 원본을
  failed로 강등하거나 자동 재시도를 만들지 않게 했다. 신규 lease·idempotency 저장소·전역 lock·
  보상 트랜잭션은 추가하지 않았다.
- 이미 성공한 원본의 명시적 강제 재처리가 commit 전에 실패하면 이번 시도만 실패로 관측하고 기존
  성공 tuple·metadata와 semantic evidence를 보존하도록 했다. 신규 attempt 이력은 추가하지 않았다.

### 2026-08-27 — 14차 추천안 일괄 확정

- 명시적 변환 도구와 예약 batch가 같은 conversion commit·single-winner·post-commit·outcome·
  retry 의미를 적용하도록 했다. 직접 semantic 갱신 서비스는 원본 상태를 소유하지 않는다.
- 아직 성공하지 않은 원본의 genuine pre-commit 실패는 기존 retry count를 원자적으로 한 번
  증가시키고 기존 backoff·최대 재시도·abandoned 정책을 사용한다. 동시 성공 패자, stale 시도와
  기존 성공 강제 재처리 실패는 retry를 늘리지 않는다.
- 처리 중 원본 content·importance·scope·type·활성 상태가 바뀌면 conversion commit에서 이전
  snapshot의 primary를 rollback하고 실패 상태를 쓰지 않아, 다음 호출이 현재 원본을 처리하게 했다.
- primary 0건 묶음은 정책 제외만 있으면 성공, malformed·정규화·confidence·후보 판정 같은 입력·
  운영 실패가 하나라도 있으면 failed/retry로 분류했다. primary가 있으면 기존 부분 성공을 유지한다.
- LLM·정규화·confidence·후보 판정용 입력 embedding 비교 같은 fallible 계산은 write transaction
  전에 끝내고, transaction은 source·candidate 재검증과 DB 변경만 포함한다. semantic embedding은
  기존 post-commit 경계를 유지하며 신규 version 필드·queue·cache·전역 lock은 추가하지 않았다.

### 2026-08-27 — 15차 추천안 일괄 확정

- candidate commit 재검증이 실패하면 열린 transaction을 rollback·종료하고 후보 상태와 필요한
  비교를 transaction 밖에서 한 번 새로 계산한 뒤 별도 transaction으로만 재시도하도록 했다.
- 예약 batch timeout은 이미 시작한 원본을 중간 취소하지 않고 commit과 정상 후속 정산을 마친 뒤
  새 원본 시작만 막는다. 미시작 원본은 상태·retry·결과 집계에서 제외한다.
- batch의 각 원본을 독립 conversion commit unit으로 확정해 한 원본 실패가 이미 커밋된 결과를
  되돌리거나 deadline 전의 다음 원본 처리를 막지 않게 했다. 실제 종결 원본만 한 번 집계한다.
- semantic primary rollback 뒤 failure-state·retry transaction 자체가 실패하면 기존 source 상태를
  유지하고 확인되지 않은 retry·abandoned 전이를 보고하지 않으며 다음 실행의 재선택을 허용한다.
- conversion commit 뒤 프로세스가 종료돼도 durable primary와 source 성공 tuple을 유지하고 전체
  자동 retry로 증거를 재가산하지 않는다. 정상 반환 전 정산은 유지하되 crash 전용 queue·상태·
  reconciliation·보상 transaction은 추가하지 않았다.

### 2026-08-27 — 16차 추천안 일괄 확정

- 예약 batch는 retry·활성·상태 적격성을 먼저 적용한 뒤 `created_at`·ID 순으로 limit을 채워,
  backoff 중인 앞선 원본이 뒤의 처리 가능한 원본을 굶기지 않게 했다.
- 명시된 retry metadata의 JSON·retry count·시각·backoff 값이 손상되면 count 0으로 보정하지 않고
  비파괴적으로 대상에서 제외한다. metadata가 없는 legacy failed 원본의 최초 retry 의미는 유지한다.
- 저장된 `last_attempt + next_retry_after_days`를 due time의 단일 출처로 사용하고 정확한 경계를
  포함한다. 저장된 지연을 현재 설정으로 소급 변경하거나 미래 시각을 clamp하지 않는다.
- 대상 조회 뒤 source가 바뀌면 deadline 확인 다음 extractor 직전 재검증에서 stale 후보를
  processed·skipped로 한 번 정산하고 상태·retry는 바꾸지 않는다. commit 재검증은 그대로 유지한다.
- batch·chunk·retry·시간 설정은 대상 조회 전에 검증한다. 잘못된 명시값을 clamp·coerce하지 않고,
  0 timeout·delay·backoff의 경계 의미만 유지한다. 신규 cursor·index·lease·repair 상태·공개 설정은
  추가하지 않았다.

### 2026-08-27 — 17차 추천안 일괄 확정

- `maxRetries`를 최초 자동 시도를 포함한 genuine pre-commit 실패 시도 전체의 상한으로 확정했다.
  첫 실패는 retry count 1이며 상한에 도달한 실패는 같은 상태 commit에서 즉시 abandoned가 된다.
- retry backoff는 새 retry count의 N-1 위치를 사용하고 배열 소진 뒤 마지막 값을 반복한다.
  abandoned에는 다음 retry가 없으므로 stale `next_retry_after_days`를 남기지 않는다.
- 미처리·failed의 일관된 flag/status tuple만 batch 자격으로 인정하고 성공 flag와 failed status 같은
  모순 또는 알 수 없는 상태는 limit 전에 비파괴적으로 제외해 경고한다. 자동 repair는 추가하지 않았다.
- chunk 사이 지연을 남은 timeout 예산 이하로 제한해 deadline 뒤 새 원본을 시작하지 않도록 했다.
  이미 완료된 원본과 미시작 원본의 기존 집계 의미는 유지한다.
- execute 시작 시 resolved scalar와 backoff 배열을 값 snapshot으로 복사·검증해 실행 중 외부
  mutation이 대상·retry·timeout 판단을 바꾸지 않게 했다. 동적 reload·설정 version·checkpoint는
  추가하지 않았다.

### 2026-08-27 — 18차 추천안 일괄 확정

- `parallelism`은 정확히 1만 지원하도록 해 현재의 결정적 source 처리와 SQLite commit 경계를
  보존했다. 1보다 큰 값을 무시하거나 원본·chunk 내부 병렬 실행을 추가하지 않는다.
- 적격성·정렬·batch limit 뒤 candidate set을 execute 단위로 고정했다. stale 제외·timeout으로 빈
  자리가 생겨도 보충 조회하지 않고 새 적격 원본은 다음 실행에서 처리한다.
- chunk는 고정 candidate set의 선택 순서를 보존한 연속 비중첩 구간으로 정의했다. 마지막 나머지만
  작을 수 있고 빈 chunk·padding·재정렬 없이 실제 chunk 사이에만 지연을 둔다.
- retry 선택은 시작 wall-clock snapshot, timeout은 단조 경과시간을 사용하도록 역할을 분리했다.
  source 전이 metadata는 전이 시 하나의 UTC timestamp를 재사용하고 영속 clock 상태는 추가하지 않는다.
- batch-level `success`는 기존 `processed > 0` 실행 의미를 유지했다. 원본별 실패·skipped·timeout은
  세부 결과로 남기고 0건 실행과 job-level 치명 오류만 false로 구분하며 공개 status enum은 늘리지 않았다.

### 2026-08-28 — 19차 추천안 일괄 확정

- 선택적 batch 설정은 미제공·`undefined`에서만 기존 기본값을 사용하고, 명시된 잘못된 런타임 타입과
  sparse backoff 배열은 대상 조회 전에 거부하도록 해 암묵 coercion·부분 default를 막았다.
- timeout·chunk delay는 밀리초, retry backoff는 정확한 24시간 단위로 확정했다. 소수 기간을
  반올림하지 않고 timezone 없는 시각·표현 범위 초과 due time은 비파괴적으로 격리한다.
- batch source의 content와 stored importance를 extractor 전에 검증해 손상 payload를 외부 처리로
  넘기지 않는다. NULL importance의 기존 0.5 기본값은 유지하고 다른 위반은 기존 failure·retry·
  abandoned 계약으로 정산한다.
- success·failed·abandoned metadata는 상태별 정규 형태로 전체 교체해 stale retry·success 키를
  남기지 않는다. 실패한 기존 성공 강제 재처리의 metadata 보존은 그대로 유지한다.
- source 단위로 격리할 수 없는 chunk·job 오류는 이미 종결된 prefix만 보존하고 미확정·미시작
  원본의 outcome을 합성하지 않은 채 중단하는 치명 오류로 확정했다. 신규 schema·checkpoint·상태
  enum은 추가하지 않았다.

### 2026-08-28 — 20차 추천안 일괄 확정

- batch `endTime`과 `duration`은 시작한 source 정산과 오류 포착이 끝난 반환 경계에서 확정하고,
  deadline이 실제로 다음 작업을 막은 경우에만 `timeoutOccurred`를 남기도록 했다. 마지막 source의
  늦은 완료나 일반 치명 오류만으로 timeout을 합성하지 않는다.
- `retryCounts`는 현재 execute에서 failed·abandoned 전이가 durable commit된 source와 새 persisted
  count만 포함한다. 성공·stale·동시 패자·상태 기록 실패·미확정 source의 retry 값은 만들지 않는다.
- count 설정과 persisted retry count는 안전 정수로 제한했다. 현재 설정의 max 이상인 기존 failed
  count는 설정 변경만으로 abandoned 처리하지 않고 비파괴 제외·경고하며, genuine 실패 commit만
  상태 전이를 만든다.
- 같은 job 인스턴스의 겹친 execute는 policy·clock·candidate·timeout·result를 호출별로 격리하고,
  동일 source만 기존 conversion 단일 승자 계약으로 수렴시킨다. 전역 execute mutex·lease·공유
  accumulator는 추가하지 않았다.
- batch semantic created·updated는 고유 최종 row 수가 아니라 durable primary outcome occurrence의
  합으로 확정했다. 같은 semantic의 후속 source 갱신은 별도 updated로 세고 rollback·미확정 결과는
  제외한다.

### 2026-08-28 — 21차 추천안 일괄 확정

- top-level `processed`, `details.processed`와 success·failed·skipped 합을 모든 반환 경로에서
  일치시키고 실제 종결 source만 한 번 집계하도록 했다. preflight 실패·미확정·미시작 source는
  outcome으로 합성하지 않는다.
- 같은 job 인스턴스를 다른 DB handle로 실행해도 내부 생성 semantic service를 execute별 DB에
  바인딩해 교차 오염을 막는다. 명시적 주입 service의 DB 정합성은 기존 호출자 책임으로 유지하고
  service registry·DB 복제는 추가하지 않았다.
- batch 설정 검증을 schema ensure를 포함한 모든 DB 접근보다 앞에 두었다. 유효 설정 뒤 schema·
  service·대상 조회 preflight가 실패하면 processed 0의 job-level 치명 오류로 반환하며 source
  failure·retry·timeout을 만들지 않는다.
- extractor 결과의 container를 런타임 검증해 malformed 결과는 기존 `llm_parse_fail`, 유효한 빈
  결과는 허용된 사유 또는 `no_triple`로 정규화한다. 신규 failure code와 raw output 영속·반환은
  추가하지 않았다.
- batch 반환 Date·배열·Map을 execute마다 새로 만들어 호출자의 반환값 mutation이 이후·겹친 실행에
  역전파되지 않게 했다. deep-freeze·immutable wrapper·신규 공개 결과 필드는 추가하지 않았다.
