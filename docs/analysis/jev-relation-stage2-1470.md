# #1470 2단계 — 정답 검토 완료, 실행 예산 부족

2026-10-31. **기준선 실행 전 중단, 품질 목표 미판정**. 사용자 검토와 수치 기준 승인을 기록했다. 하루 호출 예산 안에 고정 집합의 기준선을 완료하지 못하므로 모델 호출·판정 경로 수정·전후 비교는 시작하지 않았다. 모델 고정 버전도 미확인이라 실행 사전 등록의 선행 조건이 남았다.

## 사용자 승인과 고정 입력

검토자 jee1lee, 검토 시각 `2026-10-31T09:12:00+09:00`. 마름의 `issue-1470-stage2-brief.md`를 통해 「검토완료」를 전달받았다. 48쌍의 종류·방향·이유, 애매 6쌍, amb01·amb02의 `forbidden_types`, 사전 등록 제안 v1을 수정 없이 승인했다. 개별 쌍과 사전 기준을 검토한 이번 승인은 이전 28쌍의 실행 수용과 구분한다.

[fixture](../../tests/fixtures/jev-relation-quality/review-draft-2026-10-31.json)의 review 메타데이터만 `reviewed`, `human_reviewed: true`로 바꿨다. cases 배열과 순서는 동일하다.

| 고정 대상 | SHA-256 |
|---|---|
| 사용자가 승인한 pending 파일 전체 | `cdfeac5a75d49170ad3c43dc3542f3c4404463e5bd48a5f28867a7b924be9545` |
| reviewed 메타데이터로 전환한 파일 전체 | `cb9ecfa468fba73654c422db275f3844ee3b66977bcc9b5d6f3581bfaf4a3854` |
| cases 배열: UTF-8 `JSON.stringify(cases)` | `bce49f69c6316c7bc2cb138d9d9e441e0517679fb51add45bcd9a3ba3fe81384` |

관계 34, 무관 8, 애매 6. 주 지표 분모 42, 참 관계 분모 34, 무관 분모 8. 애매 사례는 주 지표에서 제외하되 amb01·amb02의 오류 없는 실행과 금지 종류 0/2를 별도 필수 조건으로 적용한다. 기준선 결과로 쌍·정답·분모·목표를 바꾸지 않는다. 독립 holdout은 아니다.

## 수치 기준·코드·실행 순서 등록

승인된 수치 기준 원문은 commit `f2aff8e7faac7c99f006d0818748ee5575eea228`의 `docs/analysis/jev-relation-review-draft-1470.md` 「사전 등록 제안 v1」이다. 해당 문서 전체 SHA-256은 `8810b0c4fdb46bfbe462e8894e93b32035dd56cafed57291f8e89a4ae9b71e99`다. [현재 문서](jev-relation-review-draft-1470.md)는 상태 안내만 추가하고 승인받은 본문을 보존한다.

- FOLLOWS·CONTRASTS_WITH 정밀도 각각 ≥0.80, 기준선 대비 하락 0. 나머지 종류 정밀도 하락 ≤0.05, 종류별 올바른 채택 수 감소 0. 예측 0건의 정밀도 null은 통과 불가.
- 두 대상 종류의 잘못된 채택 합계는 기준선에 오류가 있으면 최소 1건 감소, 없으면 0 유지.
- 무관 쌍 연결 ≤1/8, 기준선 대비 증가 0, 기준선이 0보다 크면 최소 1건 감소. 전체 채택 중 무관 비율 증가 0, 채택 0건은 통과 불가.
- 참 관계 누락률 ≤0.15, 전체·종류별 누락률 증가 0. 종류별 양성 커버리지 ≥0.80.
- 정상 거절률 증가는 ≤0.10, 절대값은 ≤8/42+0.15. 호출 오류율 0. 모든 기준과 동급 게이트를 동시에 충족해야 통과한다.

기준선 B의 revision은 `f2aff8e7faac7c99f006d0818748ee5575eea228`로 고정한다. 이 revision의 judge는 기준 main `293204c2`와 동일하다. 후보 풀·임계값·호출 배치 크기 1은 유지한다. 후보 C의 revision·빌드 SHA는 구현 후 첫 C 호출 전에 별도로 등록해야 한다.

| 기준선 실행 구성 요소 | SHA-256 |
|---|---|
| `scripts/run-jev-relation-evaluation.mjs` | `c19a0fb25483ff953fb70fe17c305b25add3534d174ff47f83e4341e1568d4ca` |
| `scripts/evaluate-jev-relations.mjs` | `f7af100d4892a608037edb263d660d580e59232403e73ad9027e68b47b7332df` |
| `jev-relation-judge.ts` | `960c19746442665f026dd86161becd92f2640a0860e8eed90cee76d3db6c51fe` |
| `relation-candidate-pool.ts` | `351ca6a1c18534df039e0a97572ce13bc57fda4cadaff1e57952a932f81be655` |
| `system-one-client.ts` | `edacb7204253016f2531e6c12c497b5e8647ddae4f2fb7f3b5577859c7ff7769` |
| built `jev-relation-judge.js` | `584883008120f91a36682d0728a7f0468a669411ffbd1123c15a164a49f23b56` |

모델 설정은 `jev-latest`다. 고정 버전이 아닌 별칭이며 실체의 버전은 미확인이다. **모델 버전 고정은 미완료**다. 같은 별칭이라도 다른 날짜·모델의 비교를 동일 조건으로 취급하지 않는다. 실행 전에 버전을 확인해 기록하고, 변경을 확인하면 비교를 중단한다.

실행 순서는 2단계 브리프에 따라 B 전체 48쌍→최소 변경 C의 코드 고정→C 전체 48쌍→C 독립 재호출 전체 48쌍이다. B가 이미 목표를 충족하면 개선을 주장하지 않고 승인된 v1의 중단 조건을 적용한다. 각 실행은 아래 순서와 source→target 방향을 유지한다. 각 쌍은 relevance→생존할 때만 type의 두 라운드다.

```text
cause01 cause02 cause03 cause04
dep01 dep02 dep03 dep04
follow01 follow02 follow03 follow04 follow05 follow06 follow07 follow08
contrast01 contrast02 contrast03 contrast04 contrast05 contrast06 contrast07 contrast08
ref01 ref02 ref03 ref04 dup01 dup02
bel01 bel02 bel03 bel04
unrel01 unrel02 unrel03 unrel04 unrel05 unrel06 unrel07 unrel08
amb01 amb02 amb03 amb04 amb05 amb06
```

## 실행 전 확인한 중단 조건

모델별 하루 상한은 20회이며 재시도도 포함한다. 48쌍 기준선은 relevance만 최소 48회, 전부 생존하면 96회다. 오늘 다른 용도의 호출이 0회여도 상한을 넘는다. 최소 호출만으로도 기준선에 3일이 걸린다. B·C·C 재호출 합계는 최소 144회, 전부 두 라운드면 288회다.

기존 실행기는 전체를 순회한 뒤 마지막에 snapshot을 출력하며 예산 차단·중간 저장·재개를 지원하지 않는다. `SystemOneClient` 내부의 WAF 재시도도 실제 API 호출에 포함해야 한다. ask 횟수만 기록하면 예산 준수를 보장하지 못한다. 기존 CLI를 제한 없이 실행한 뒤 나중에 중단하거나, 집계를 위해 필요한 42쌍을 줄이거나, 입력을 묶어 배치 크기 1 조건을 바꾸지 않는다.

브리프의 “부족하면 멈추고 보고한다”에 따라 외부 모델 출력을 보기 전에 중단했다. 날짜별 예산을 지키는 저장·재개 실행과 모델 버전 확인이 다음 선행 조건이다. 이번에는 fixture 승인 기록, 동일 cases 고정 테스트, README·평가 기록만 한 명이 수정했다. 새 실행기·설정·의존성·export는 추가하지 않았다. 공유 judge, remember/RelationExtractor 호출자, 후보 풀·임계값도 바꾸지 않았다.

| 날짜·모델 | 이 작업의 실제 API 호출 | 실행한 쌍 | 상태 |
|---|---:|---:|---|
| 2026-10-31 KST · `jev-latest` | 0(재시도 0) | B 0/48, C 0/48, C 재호출 0/48 | 실행 전 예산 부족으로 중단 |

다른 용도·프로세스의 같은 날 사용량은 미확인이다. 여기서 0회는 본 작업의 관계 평가만 센다. 미실행을 오류·정상 거절·FN으로 바꾸지 않는다. 종류별 정밀도, 무관 연결률, FN, 거절률, REFERENCES 회귀, 동급 게이트의 전후 비교는 모두 미측정이다. 목표 달성·미달은 판정하지 않는다.

## DB 경계와 앞선 기록 정정

2단계에서는 의존성 재설치, 실제 기억 DB의 직접 열람, 관계 삭제·재백필을 실행하지 않았다. 검증 명령에 전용 `DB_PATH=/tmp/memento-1470-stage2.db`를 지정했다. 향후 기존 백필 측정도 운영 DB를 읽기 전용 또는 복사본으로 다룬다.

갱신된 역할 문서에 따르면 1단계 postinstall 초기화 대상 `~/.memento/memory.db`는 호스트 기본 DB이며, Docker 운영 DB는 `~/.memento/data/memory.db`다. 앞선 “운영 DB 쓰기 경계 위반” 보고는 대상을 잘못 구분했다. 호스트 기본 DB의 의도치 않은 초기화와 실제 데이터 변경 범위 미확인은 남는다. 운영 DB 초기화를 확인했다는 주장은 정정한다.

## 검증

- 전체 `npm test`: 655개 파일·6,585개 테스트 통과. 기존 2개 파일·36개 테스트 skip.
- 관련 5개 파일·52개 테스트 통과. 승인 48쌍의 기존 실행기 수용, pending의 호출 전 거절, cases SHA를 검사했다. 외부 모델은 mock했다.
- `npm run lint`, `npm run type-check`, `npm run knip`, `npm run check:vi-mock-paths -- --ci` 통과. mock 경로 위반 0건.
- `npm run docs:audit-links`, `npm run docs:verify-npm-scripts`, `git diff --check` 통과.
- 승인 전후 cases 배열 동일성, 승인받은 사전 등록 본문 보존, 기록한 실행 구성 요소 6개 SHA 일치를 확인했다.
- graphify 변경 전후 재빌드 완료. 생성물은 제외했으며 기존 SQL 파서·미지원 파일 경고는 남았다.
