# REVIEW.md

이 저장소의 PR 을 리뷰하는 사람과 에이전트가 읽는다. 영역마다 과거에 실제로 깨진 방식을 적고, 항목마다 근거 이슈나 PR 번호를 단다. 근거가 없는 항목은 넣지 않는다. 관례와 명령은 [AGENTS.md](./AGENTS.md), 랭킹 공식은 [search-ranking.md](./docs/agents/search-ranking.md) 가 정본이라 여기에 옮기지 않는다.

같은 지적이 두 번 나오면 이 파일에 줄을 더하기보다 lint, CI 검사, 스펙으로 올려 발생 지점에서 막는다(예: #821 의 `check:vi-mock-paths`).

## 영역별 실패 유형

### 검색 랭킹

- 보조 신호(recency, importance)가 relevance 를 덮어 텍스트 레인 상위 정답이 최종 top-10 에서 빠진다 (#1175, #1180). 가중치나 scale 을 바꾸는 PR 은 정답 순위 before/after 를 증거로 낸다.
- 검색이 스스로 갱신하는 값(`consolidation_score`, `last_accessed_at`)이 다음 검색 순위에 섞여 호출 이력에 따라 순위가 움직인다 (#1184, #1181).
- 정규화 식 실수로 작은 쪽이 더 큰 부스트를 받는다 (#1185). 식이 바뀌면 경계값 스펙을 본다.
- 텍스트 레인 score 에 composite, recency, importance 를 섞는다. 융합은 `HybridResultRanker` 한 번뿐이다 (#1393).
- 필터를 한쪽 레인에만 넣거나 후보 LIMIT 뒤에 건다 (#998, #1392). 필터 SQL 은 `buildMemoryFilterSql` 한 곳이다.
- clamp 로 동점이 생겨 게이트가 정답을 가르지 못한다 (#1180, #1399). 랭킹, embedding, search 경로 PR 은 `search-quality-pr.yml` 결과를 확인한다 (#1385).

### consolidation 과 원본 약화

- 요약이 불충분하거나 LLM 호출이 실패했는데 원본을 통합됨으로 표시하거나 중요도를 낮춘다 (#1549). 실패한 클러스터는 미루고 원본을 그대로 둔다. 429 를 받으면 그 실행의 남은 클러스터를 멈추고, 다른 provider 로 몰래 바꾸지 않는다 (#1549).
- 시스템이 만든 요약이 사용자가 직접 남긴 기억을 밀어낸다 (#1622).
- 요약 유지나 전환은 사전등록 비교 결과로만 정한다. 운영 설정 변경은 사용자 승인 뒤 별도 PR 이다 (#1624).

### supersede 와 현재 상태 읽기

- 판정 결과를 자동 적용한다. 후보 판정은 후보와 근거만 기록한다 (#1548).
- 짝짓기가 출처를 보지 않아 system 요약이 user 지침을 대체하는 후보가 된다. 같은 주제라도 다른 도구, 환경, 대상의 설명은 공존이다 (#1622).
- 경쟁 교체, 순환, 입력 변경, scope 위반, target 삭제, 명시적 취소 중 하나를 시험하지 않는다 (#1551).
- 읽기 경로 하나라도 현재 상태 필터를 빠뜨려 대체된 기억이 노출된다. KNN, hybrid, fallback 은 LIMIT 전에 걸고 ID, anchor, injection, 이웃 조회도 같은 계약을 따른다 (#1552).

### 마이그레이션과 스키마 버전

- DDL 을 `schema.sql`, 증분 migration, `init-bootstrap-new-db.ts` 밖에 둔다 (#1535).
- 현재 버전을 `applied_at` 정렬로 고른다. 같은 초에 적용된 버전끼리 동점이 난다 (#1542).
- 여러 단계로 된 재구축 migration 이 중간에 실패해 테이블이 반쯤 남는다. 한 트랜잭션으로 묶는다 (#755).
- 런마다가 아니라 버전마다 백업을 만든다 (#851).
- 데이터 정리를 스크립트로만 두어 npm 배포판 사용자에게 닿지 않는다. 정리는 데이터 migration 으로 보낸다 (#1139).
- down 이 비가역인 migration 이 있다 (#1383, PR #1434). PR 본문에 그 사실을 적었는지 본다.

### 보안 (공개 저장소)

- 취약점 상세(공격 절차, 재현 명령, 영향 범위)를 이슈, PR 본문, 커밋 메시지, 리뷰 코멘트에 쓴다 (#1629, #1630). 수정 PR 의 제목과 본문도 일반 문구로 쓴다. 미수정 문제는 비공개 Security Advisory 초안으로만 다룬다.
- 리뷰가 보안 문제를 찾으면 공개 코멘트에는 분류와 파일 위치만 쓰고 상세는 비공개 경로로 보낸다.
- rate limit 키를 IP 기본값에 맡겨 프록시나 Docker 포트 퍼블리싱 뒤에서 모든 클라이언트가 버킷 하나를 같이 쓴다 (#1161). 버킷을 더하면 `keyGenerator: resolveRateLimitKey` 를 유지한다. 인증과 owner 범위를 건드리는 PR 은 [AGENTS.md](./AGENTS.md) Gotchas 의 해당 항목과 대조한다.

### 평가셋과 사전등록

- 결과를 본 뒤 임계값이나 판정 규칙을 고른다. 크기, 분할, 지표, 판정 규칙을 결과 전에 커밋하고 SHA 를 남긴다 (#1624).
- 서로 다른 모델 머슴의 교차 판정을 사람 gold 라고 부른다. `agent_panel` 로 표시하고 불일치는 보류로 뺀다. 구현자는 정답 작성에서 빠진다 (#1569, #1624).
- dev 재주석을 채택 판정에 쓴다 (#1574, #1624).
- 라이선스나 출처 때문에 커밋하면 안 되는 원본을 fixture 로 넣는다. 공개 문서에는 집계, ID, 해시만 쓴다 (#767, #808).

### CI 와 검증 증거

- 로컬 검증에서 CI lint-typecheck 단계(knip 등)나 Security Check 정적 검사를 빠뜨린 채 통과를 주장한다 (#1564, #1567, #1591, #1628). 주장마다 CI job 결과와 대조한다.
- 없는 모듈을 가리키는 `vi.mock` 때문에 스펙이 조용히 통과한다 (#821).

## 리뷰에서 뺄 것

- `graphify-out/`, `.local/`, `dist/`: 로컬 생성물이다.
- `tests/fixtures/search-quality/baselines/`: `--write-baseline` 생성물이다 (#1385). 숫자가 아니라 갱신 사유를 본다.
- 판정 패킷과 사전등록 원본(`tests/fixtures/**`): 바이트 보존 대상이다 (#1569). 내용 수정을 제안하지 않고 SHA 대조만 한다.
- `package-lock.json`: 의존성 PR 이 아니면 보지 않는다.
- Nit 는 3건까지 쓴다. 넘는 것은 버린다.

## 결과 형식

승인은 커밋 단위다.

1. 첫 줄 `발견 N건 (Important a, Nit b, Pre-existing c) — 커밋 <sha> 기준`.
2. 위험 등급과 차단 여부.
3. Important(차단): 파일:줄, 깨지는 것, 그걸 잡는 검사 유무, 고칠 것.
4. Nit(차단 안 함, 3건까지).
5. Pre-existing(이번 변경과 무관, 차단 안 함, 이슈 후보).
6. 검증 증거 판독 표: PR 의 주장, 증거, 판독(확인 또는 증거 부족).

고칠 것이 없으면 `발견 0건. 커밋 <sha> 승인.` 한 줄로 끝낸다. 보안 지적은 `I2 보안(권한 범위) <파일>:<줄>, 상세는 비공개 경로` 처럼 분류와 위치만 쓴다.

예시(#1628 리뷰를 이 형식으로 줄였다):

```
발견 4건 (Important 1, Nit 3, Pre-existing 0) — 커밋 <sha> 기준
위험 medium. Important 1건으로 차단.
I1 consolidation-mode-config.ts:28 isValidConsolidationMode 가 미사용 export. CI knip 이 잡는다(lint-typecheck 실패). 삭제.
N1 link 모드에서 findMergeTarget, createAndStoreEmbedding 호출을 막는 spec 이 없다. 검사 없음.
N2 PR 범위 표에 코드 위치가 없고 memory_relation 소비처 2곳이 빠졌다.
N3 clustering-service.ts:69 동률 규칙은 members 가 이미 id 오름차순이라 no-op. 검사 없음.
| PR 의 주장 | 증거 | 판독 |
| summarize 기본 경로 무변경 | diff 대조, 변이 4건을 spec 이 잡음 | 확인 |
| link 모드는 순위에 영향 없음 | hybrid-result-ranker.ts:150-160 이 메타만 읽음 | 확인 |
| lint, type-check 통과 | CI lint-typecheck 실패(knip) | 증거 부족 |
```
