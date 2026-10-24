# Jev 관계 백필 품질 표본 — #1466

측정 시각: 2026-10-24 18:13 KST. 대상: 운영 DB의 `metadata.backfill = true`인 Jev 6종 관계 중 양쪽 기억이 존재하고 soft-delete되지 않은 28,602개. #1466 작성 당시 28,578개에서 재시도 후 늘어난 수치다.

## 방법과 판정 기준

`scripts/sample-relations-jev.mjs`가 SQLite를 `readonly: true, fileMustExist: true`로 열어 한 읽기 트랜잭션에서 추출한다. 종류마다 SHA-256(`seed:relation_id`) 오름차순으로 30개를 고른다(seed `1466`). CAUSES는 모집단 16개 전부를 포함해 총 166쌍이다. 같은 DB 스냅샷과 seed에서 표본이 같다. DB가 바뀌면 같은 seed여도 표본이 달라진다.

세 에이전트가 종류를 나눠 원문 전체와 방향(source → target)을 읽고 각 쌍에 판정과 이유를 남겼다. 같은 쌍을 여러 검토자가 중복 판정한 실험은 아니다. 주 에이전트는 종류별 예시 1쌍씩 확인했다. 사람 정답과 비교하지 않았으므로 아래 수치는 **에이전트 판정 기준의 탐색적 표본 정밀도**다.

- `correct`: 같은 일의 맥락이며 선택한 종류와 방향도 맞다.
- `wrong_type`: 실질적 연결은 있지만 종류 또는 방향이 틀리다.
- `unrelated`: 단순 시간 인접·같은 저장소·공통 단어만으로 연결했고 구체 맥락이 부족하다.

[관계 타입 표준](../reference/ko/relation-type-vocabulary.md)과 [라벨링 가이드](../guides/ko/relation-labeling-guide.md)를 적용했다. FOLLOWS는 인과를 요구하지 않는다. 공개 정의만 보면 시간 순서로 성립하지만, 이번 감사는 Jev의 `RELEVANCE_QUESTION`인 “같은 일의 맥락으로 이어 볼 만하다”도 요구한다. 시간 순서만 맞는 쌍을 유용한 관계로 세지 않았다. REFERENCES는 가이드에 따라 명시 인용 외에도 같은 사건·아티팩트의 구체 연결을 허용했다.

## 종류별 결과

종류 정밀도 = `correct / 표본 수`. 연결 정밀도 = `(correct + wrong_type) / 표본 수`.

| 종류 | 모집단 | 표본 | 맞음 | 종류·방향 오류 | 무관 | 종류 정밀도 | 연결 정밀도 |
|---|---:|---:|---:|---:|---:|---:|---:|
| CAUSES | 16 | 16 | 1 | 12 | 3 | 6.3% | 81.3% |
| DEPENDS_ON | 2,934 | 30 | 6 | 14 | 10 | 20.0% | 66.7% |
| FOLLOWS | 13,081 | 30 | 19 | 0 | 11 | 63.3% | 63.3% |
| CONTRASTS_WITH | 4,732 | 30 | 1 | 20 | 9 | 3.3% | 70.0% |
| REFERENCES | 4,844 | 30 | 23 | 1 | 6 | 76.7% | 80.0% |
| BELONGS_TO | 2,995 | 30 | 9 | 16 | 5 | 30.0% | 83.3% |

FOLLOWS 편중에는 시간상 인접하지만 같은 일로 연결되지 않는 쌍이 섞였다(11/30). CONTRASTS_WITH는 동일 내용 반복·성능 테스트용 템플릿·코드 단편에도 붙었다. BELONGS_TO는 부분·전체 대신 중복·동급·후속 작업을 연결하는 사례가 두드러졌다. CAUSES와 DEPENDS_ON은 진행·요약·선후 관계를 인과·전제로 해석한 오류가 많았다.

## 모델 신뢰도 구간별 결과

구간은 `[0.5, 0.6)`, `[0.6, 0.8)`, `[0.8, 1.0]`다. 통계적 신뢰구간이 아니라 저장된 모델 점수 구간이다.

| 구간 | 표본 | 맞음 | 종류·방향 오류 | 무관 | 종류 정밀도 | 연결 정밀도 |
|---|---:|---:|---:|---:|---:|---:|
| 0.5 이상 0.6 미만 | 65 | 15 | 27 | 23 | 23.1% | 64.6% |
| 0.6 이상 0.8 미만 | 82 | 35 | 27 | 20 | 42.7% | 75.6% |
| 0.8 이상 | 19 | 9 | 9 | 1 | 47.4% | 94.7% |

종류별 동수 표본을 합친 수치라 모집단의 구간별 정밀도가 아니다. 종류마다 모집단 비중과 점수 분포가 다르므로 이 표만으로 전역 임계값을 선택하면 안 된다. 0.8 이상에서도 19쌍 중 10쌍은 종류가 맞지 않았다.

아래는 종류·구간별 `맞음 / 판정 수`다. 작은 셀의 수치는 임계값 선택 근거로 부족하다.

| 종류 | [0.5, 0.6) | [0.6, 0.8) | [0.8, 1.0] |
|---|---:|---:|---:|
| CAUSES | 1/11 | 0/5 | 표본 없음 |
| DEPENDS_ON | 1/13 | 4/15 | 1/2 |
| FOLLOWS | 4/8 | 9/15 | 6/7 |
| CONTRASTS_WITH | 1/15 | 0/14 | 0/1 |
| REFERENCES | 6/10 | 16/18 | 1/2 |
| BELONGS_TO | 2/8 | 6/15 | 1/7 |

## 결정과 제한

이번 변경은 측정 도구와 결과 기록까지다. `RELATION_JEV_TYPE_MIN = 0.5`를 유지하고 운영 관계를 삭제하지 않았다. 높은 점수에서도 종류 오류가 남아 단일 임계값 인상만으로 해결된다는 근거가 부족하다.

후속 개선은 [#1470](https://github.com/jee1/memento/issues/1470)에서 CONTRASTS_WITH의 반복·중복 기록 오분류와 FOLLOWS의 같은 작업 맥락 확인을 우선 다룬다. 사람이 검토한 평가 집합을 고정해 정밀도와 놓친 관계를 함께 비교한다. 종류별 기준 변경·임계값 선택·`backfill=true` 정리는 검증 후 별도 변경으로 다룬다. 표본에는 여러 프로젝트와 테스트성 기억이 섞였으며, 프로젝트별 정밀도·검토자 일치도·새 기억의 온라인 추출 품질은 측정하지 않았다.

## 재실행

새 의존성·npm script·서버 설정 없이 실행한다. JSON에는 private 기억 원문을 담으므로 `.local/`에만 보관하고 공유하지 않는다.

```sh
umask 077
mkdir -p .local/jev-audit
node scripts/sample-relations-jev.mjs --db /absolute/path/to/memory.db --size 30 --seed 1466 > .local/jev-audit/sample.json
```

운영 컨테이너의 기존 DB_PATH를 사용할 때는 스크립트를 stdin으로 전달한다. 이미지 수정·재배포·파일 복사는 필요 없다.

```sh
docker exec -i -w /app memento-memento-mcp-server-1 node --input-type=module - --size 30 --seed 1466 < scripts/sample-relations-jev.mjs > .local/jev-audit/sample.json
```

표본을 복사해 각 항목의 `verdict`를 위 세 값 중 하나로, `reason`을 판정 근거로 채운다. ID·점수·종류·모집단 정보는 보존한다. 미판정·중복 ID·표본 누락·유효하지 않은 점수는 집계 오류로 처리한다.

```sh
node scripts/sample-relations-jev.mjs --report .local/jev-audit/rated.json > .local/jev-audit/report.json
npx vitest run scripts/sample-relations-jev.spec.ts
```

이번 실행의 원문·쌍별 판정·집계는 로컬 `.local/jev-audit/{sample,rated,report}.json`에 보관한다. 원문과 쌍별 판정은 커밋하지 않는다.

## 검증

- 실제 운영 DB에서 읽기 전용 추출 166쌍과 모든 판정 ID의 일치를 확인했다.
- 합성 SQLite로 표본 재현성, 종류별 개수, backfill·삭제 필터, 원문·방향 보존, DB 파일 불변을 검사했다.
- 3종 판정·점수 구간 집계와 미판정·중복·누락 입력 거절을 검사했다. 독립 검토에서 찾은 표본 누락은 수정 전 실패를 확인한 뒤 고쳤다. 수정 후 CLI 테스트 2개가 통과했다.
- `npm test`: 637개 파일·6,309개 테스트 통과, 기존 2개 파일·36개 테스트 건너뜀. 누락 검사 추가 후 해당 CLI 테스트를 재실행했다.
- `npm run lint`, `npm run type-check`, `node --check scripts/sample-relations-jev.mjs` 통과. graphify 재빌드 완료.
