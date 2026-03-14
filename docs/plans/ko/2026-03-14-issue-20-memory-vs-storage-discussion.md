# 이슈 #20 검토: 저장 효율 vs 기억 효율 — 논의 요약

**일자**: 2026-03-14  
**관련 이슈**: [#20 중복 제거 및 기억 압축 저장 기능](https://github.com/jee1/memento/issues/20)

---

## 1. 배경

- **이슈 #20**: 유사한 기억이 반복 저장될 때 병합·요약을 통해 **저장 효율**을 높이는 기능.
- **현재 계획**: [#89 비동기 Augmentation](https://github.com/jee1/memento/issues/89) 워커에서 "중복 제거·압축"으로 흡수하거나, [#90 Triples/KG dedupe](https://github.com/jee1/memento/issues/90)와 정책만 맞춰 별도 구현.  
  (참고: `docs/plans/ko/2026-02-07-issue-priority-review.md`, `docs/plans/ko/2026-02-07-memori-inspired/design.md`)

---

## 2. 논의 포인트: “저장 효율”과 “기억 효율”의 충돌

- **저장 효율**: 유사 기억을 병합·요약하면 디스크/행 수가 줄어든다.
- **기억 효율**: 반복되어 저장되는 기억은 **그만큼 자주 언급된 = 중요한** 신호일 수 있다.  
  병합·요약으로 “한 건”으로 묶어 버리면, “이 내용이 여러 번 강화되었다”는 정보가 사라져 **회수(recall) 관점에서는 오히려 효율이 떨어질 수 있다**.

따라서 **반복되는 기억은 더 잘 관리해야 한다**는 관점을 #20 정책에 반영하는 것이 타당하다.

---

## 3. 제안: “반복 = 중요도” 보존 정책

#20을 **“단순 중복 제거·압축”**이 아니라 **“반복 정보를 메타데이터로 보존한 채 저장 최적화”**로 정의하는 것을 제안한다.

| 관점 | 내용 |
|------|------|
| **저장** | 유사 기억은 대표 1건으로 병합하거나, 대표 + 연관 ID 목록 등으로 물리적 행 수를 줄인다. |
| **기억(회수)** | 병합 시 **반복 빈도**를 버리지 않고, [#88 Fact 메타데이터](https://github.com/jee1/memento/issues/88)의 `num_times`, `last_mentioned_at` 등에 반영한다. |
| **랭킹** | recall·검색 시 `num_times`(및 `last_mentioned_at`)를 boost에 사용해, “자주 등장한 기억”이 더 잘 회수되도록 한다. |

이렇게 하면:

- 저장 효율은 유지하고,
- “이 내용이 N번 반복되었다”는 **중요도 신호**는 그대로 살려서, 기억으로서의 효율(중요한 것이 더 잘 회수됨)을 높일 수 있다.

---

## 4. #89 / #90 연동 시 체크리스트 제안

#20을 #89 워커 또는 #90 dedupe와 통합할 때, 아래를 명세·구현에 포함하는 것을 권장한다.

- [ ] **병합 시**: 대표 항목에 `num_times` 누적(또는 증가), `last_mentioned_at` 갱신.
- [ ] **원본 처리**: 병합된 N건은 soft-delete 또는 “대표 ID 참조” 형태로 보존(감사·디버깅용 선택).
- [ ] **recall/랭킹**: #88 구현의 boost 공식에 `num_times`, `last_mentioned_at` 반영이 “반복된 기억”에 적용되는지 확인.

---

## 5. 요약

- 반복 = 중요도 신호이므로, **중복 제거 시 반복 정보를 지우지 않고 메타데이터로 승격**하는 정책이 적절하다.
- #88 Fact 메타(`num_times`, `last_mentioned_at`)와 #20(중복 제거·압축)을 함께 설계하면, 저장 효율과 기억 효율을 동시에 만족시킬 수 있다.

---

## 6. SDD 명세 문서

본 논의를 바탕으로 SDD 방법론에 따른 spec 문서 세트를 작성하였다.

- **경로**: `docs/plans/ko/2026-03-14-issue-20-dedupe-repetition-preservation/`
- **Specify**: [requirements.md](2026-03-14-issue-20-dedupe-repetition-preservation/requirements.md), [spec.md](2026-03-14-issue-20-dedupe-repetition-preservation/spec.md)
- **Plan**: [design.md](2026-03-14-issue-20-dedupe-repetition-preservation/design.md), [structure.md](2026-03-14-issue-20-dedupe-repetition-preservation/structure.md), [tech.md](2026-03-14-issue-20-dedupe-repetition-preservation/tech.md), [product.md](2026-03-14-issue-20-dedupe-repetition-preservation/product.md)
- **Task**: [tasks.md](2026-03-14-issue-20-dedupe-repetition-preservation/tasks.md)
- **Implement**: [implementation-plan.md](2026-03-14-issue-20-dedupe-repetition-preservation/implementation-plan.md)
