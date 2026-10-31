# 독립 판정 지침 — consolidation-replay-v1

모든 이름·작업은 새 합성 입력이다. 실제 현재 날짜 대신 query_at을 쓴다. 한 stage는 원본 관찰 2·4·6건까지만 제공한다. 이 단계 이후의 관찰·다른 판정자 답·구현자 후보·시스템 출력은 읽지 않는다. 현재 stage의 answers.json을 제출해 봉인한 뒤에만 다음 stage를 받는다.

owner/project/subject가 맞는 질의에 대해 원문 전체와 시각을 읽고, 반드시 복구해야 할 원자 사실과 금지 주장을 직접 작성한다. 조건, 대상, 현재 값, 효력 기간, 관찰 회차를 사실에 붙인다. 한 번의 성공을 보편 정책으로, 제안을 승인으로, 별개 작업을 같은 작업의 정정으로 승격하지 않는다. 최신 문장이 언급하지 않았다고 기존 조건을 삭제하지 않는다. 과거 관찰은 과거로 보존하고 현재 지시와 구분한다. 원문에 없는 정책·권한을 만들어 채우지 않는다.

required_facts는 질의 답에 반드시 남길 사실 목록이다. 각 항목은 독립 fact_key, claim, supporting_evidence_refs를 가진다. 조건이 다른 주장은 별도 항목으로 쓴다. forbidden_claims는 현재 답/요약이 단정하면 틀리는 주장과 범위다. 각 항목에 claim, evidence_refs, reason을 쓴다. 현재 정정된 옛 값을 과거 기록으로 정확히 인용하는 일과 현재 사실로 단정하는 일을 구분한다.

relevant_evidence_refs는 질의의 사실·조건을 복구하는 데 필요한 원본 집합이다. 무관 입력을 필요 근거로 넣지 않는다. 정정 관계에 과거 원본도 필요하면 이유를 설명한다. 원문만으로 현재 계약을 확정하지 못하면 status=ambiguous와 hold_reason을 적고 아는 사실과 모르는 범위를 구분한다. 답 수량이나 원하는 라벨 비율을 추정하지 않는다. unresolved 사례를 임의로 고치지 않는다.

required_facts·forbidden_claims의 빈 배열은 합의/무오류가 아니다. pending은 아직 답하지 않았다는 뜻이다. 모든 판단은 해당 prefix evidence_id를 참조해야 한다. 이 입력에는 실제 절차 실행 로그가 없으므로 execution_evidence는 unmeasured를 유지한다. 절차 지시를 실제 실행 성공이라고 부르지 않는다.

reviewer_id, 실제 model/version, judged_at(UTC), packet_sha256, rubric_sha256을 제출에 적는다. 같은 패킷의 빈 양식을 채워 제출하고 입력 packet/rubric를 수정하지 않는다. 자신의 stage 폴더만 읽고 상대 reviewer나 다음 stage 폴더를 열지 않는다. 이는 사람 gold가 아닌 agent_panel 판정이다.
