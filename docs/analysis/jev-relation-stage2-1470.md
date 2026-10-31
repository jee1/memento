# #1470 2단계 — 승인된 48쌍의 Jev 평가

2026-10-31. 사용자 검토와 수치 기준 승인을 기록하고 Jev 기준선 평가를 재개한다. 최신 사용자 정정에 따라 Gemini 하루 20회 예산을 Jev에 적용하지 않는다. 실제 Jev 요청 수와 재시도를 기록한다. 결과 확인 전 입력·수치·코드·모델·실행 순서를 고정했다.

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

기준선 B의 revision은 `eca3dcf58ade077124a28d5baf09dd9a0c123f06`로 고정한다. f2aff8e7 이후 런타임 변경은 없다. 이 revision의 judge는 기준 main `293204c2`와 동일하다. 후보 풀·임계값·호출 배치 크기 1은 유지한다. 후보 C의 revision·빌드 SHA는 구현 후 첫 C 호출 전에 별도로 등록해야 한다.

| 기준선 실행 구성 요소 | SHA-256 |
|---|---|
| `scripts/run-jev-relation-evaluation.mjs` | `c19a0fb25483ff953fb70fe17c305b25add3534d174ff47f83e4341e1568d4ca` |
| `scripts/evaluate-jev-relations.mjs` | `f7af100d4892a608037edb263d660d580e59232403e73ad9027e68b47b7332df` |
| `jev-relation-judge.ts` | `960c19746442665f026dd86161becd92f2640a0860e8eed90cee76d3db6c51fe` |
| `relation-candidate-pool.ts` | `351ca6a1c18534df039e0a97572ce13bc57fda4cadaff1e57952a932f81be655` |
| `system-one-client.ts` | `edacb7204253016f2531e6c12c497b5e8647ddae4f2fb7f3b5577859c7ff7769` |
| built `jev-relation-judge.js` | `584883008120f91a36682d0728a7f0468a669411ffbd1123c15a164a49f23b56` |

모델은 공식 문서가 지원하는 고정 버전 `jev-1.14.0`으로 요청한다. [공식 Models](https://docs.typesafe.ai/models)는 목록이 별칭만 반환해도 버전 ID를 요청에 지정한다고 안내한다. 인증된 GET `/v1/models`는 `jev-latest`·`jev-preview`만 반환했다. 각 POST 응답의 모델 필드를 별도로 보존하고, 요청 버전과 다른 버전을 확인하면 추가 호출을 막는다. GET 모델 목록은 Jev 추론 호출로 세지 않는다.

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

## 실행 전 고정과 호출 기록

사용자 정정: 판정 경로는 Jev이며 Gemini의 하루 20회 제약과 무관하다. 앞선 예산 부족 중단 사유는 폐기한다. 수치·라벨·분모는 승인받은 v1 그대로 유지하고 실행 정책의 예산 항목만 최신 지시로 대체한다.

[실행 전 등록 JSON](../../tests/fixtures/jev-relation-quality/preregistration-2026-10-31.json)의 SHA-256은 `15fbd3baad6d96315c7ce5baecfc1c0f5d140b7fb532ed39d47997ed1a6abea9`다. 모델 출력을 보기 전에 생성했다. 실행 순서, 수치 조건, B revision, fixture·실행 코드 SHA, 후보 1회·독립 재호출 1회를 기록했다. 별도 수치 조정 없이 결과를 보고한다.

기존 실행기를 그대로 쓰되 로컬 fetch 관찰자가 실제 POST 전후에 JSONL을 기록한다. `SystemOneClient` 내부 WAF 재시도도 각각 센다. snapshot의 round 수와 ledger를 대조하고 요청·응답 모델, HTTP 상태, 시각·사용량을 보존한다. 인증 값은 기록하지 않는다. 공개 결과에는 원시 기억 원문을 넣지 않는다.

## 기준선과 수정 가설

B는 48쌍을 Jev 90회로 실행했다(재시도 0). 모든 응답은 `jev-1.14.0`이었다. 주 지표 42쌍에서 참 관계 30/34, 무관 연결 2/8, 정상 거절 6/42, 호출 오류 0/42였다. FOLLOWS는 8/8, CONTRASTS_WITH는 8/10이었다.

- 맥락 실패: unrel06·unrel08은 서로 독립인 서비스/팀인데도 relevance 0.68·0.60으로 통과한 뒤 CONTRASTS_WITH로 채택됐다. 공통 형식·시간·용어만으로 같은 대상으로 연결하지 않도록 맥락·대조 질문을 좁힌다.
- 종류 실패: cause03·dep03·bel02·bel04는 올바른 종류 점수가 각각 0.60·0.79·0.69·0.73인데 REFERENCES 점수 0.62·0.82·0.73·0.73이 선택됐다. 단순한 의미 연결까지 포함하던 “가리킨다”를 명시적 인용·참조로 좁힌다.
- 변경은 공유 judge 질문 세 곳이다. 원인·의존·후속·포함 질문, 후보 풀, 200자 절단, 임계값 0.5, 라운드 구성·공개 API·설정·의존성은 바꾸지 않는다. remember와 RelationExtractor가 같은 경로를 쓴다.

질문 계약 테스트는 변경 전 1개 실패/8개 통과, 변경 후 대상 5개 파일·52개 통과였다. 주입 점수 테스트는 의미 정확도의 증거로 대체하지 않는다. FOLLOWS 양성 8쌍은 B에서 이미 전부 맞혔으므로 개선을 주장하지 않고 회귀 여부를 본다.

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
