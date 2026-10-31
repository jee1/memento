# relation-ko-panel-v1 블라인드 판정 rubric

판정 단위: **한 질의**와 `scope_owner_id` / `scope_project_id` 범위다. 출력은 참고 자료이며 자동 변경하지 않는다. 모든 이름·기록은 합성이다. `generator-key.json`·다른 reviewer·시스템 순위를 읽지 않는다.

## 입력

`corpus.jsonl`, `relations.jsonl`, `queries.json` 패킷만 본다. 각 기억의 `status`, `owner_id`, 본문 전체를 읽는다. deleted/superseded는 현재 답 근거에서 제외한다. scope 밖 owner는 정답 id에 넣지 않는다.

## 질의 유형

- `single_fact`: 관계 없이 본문만으로도 답할 수 있어야 한다. 정답 id는 **최소** 집합(동일 사실 중복 제외).
- `multi_hop`: 질의·장소명·핵심 명사는 시작/중간 노드에만 있어야 한다. 최종 정답 기억 본문에는 질의 고유 어휘(장소명 등)가 없어야 하며, 관계 없이 본문 검색만으로 정답 id에 도달하면 안 된다.
- `irrelevant_trap`: 관계로 잘못된 노드(허브·폐기 초안 등)가 연결되지만 정답은 **다른** 고립/직접 기억이다. 함정 id는 정답에 넣지 않는다.

## 제출

각 질의마다 `relevant_memory_ids`(정답 id 배열), `ambiguous`(bool), `rationale`, `reviewer_id`, `model`, `judged_at`(UTC), `data_sha256`(패킷 corpus+relations+queries 합)을 제출한다. agent_panel이며 사람 gold로 부르지 않는다.
