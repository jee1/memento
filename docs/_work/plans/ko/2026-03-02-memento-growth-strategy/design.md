# Memento 성장 전략 설계

**일자**: 2026-03-02  
**목적**: 채택(A)·제품(B)·생태계(C)를 모두 고려한 성장 로드맵과, 그 전제인 **성능 적정성 판단** 절차를 정의한다.

---

## 1. 성장 방향 요약

- **선택한 접근**: **마일스톤 결합(Balanced)** — 제품 마일스톤마다 채택·생태계 행동 하나를 묶어 진행.
- **전제**: **성능(속도·정확성 등) 적정성 판단을 선행**한 뒤, 성장 로드맵을 실행한다.

---

## 2. Phase 0: 성능 적정성 판단 (선행 조건)

성장(마일스톤 결합)을 본격화하기 전에, Memento의 **속도·정확성**이 “적절한 수준”인지 판단한다.

### 2.1 판단 차원

| 차원 | 내용 | 참고 문서·도구 |
|------|------|----------------|
| **속도 — recall** | recall 호출 시 전체 지연(전형적 쿼리·데이터 규모 기준) | `MEMENTO_RECALL_PROFILE=1` → 로그 `total_ms`, [recall-performance-tuning.md](../../../../guides/ko/recall-performance-tuning.md) |
| **속도 — 검색(하이브리드/단일 provider)** | 단일 provider 검색 평균 응답 시간 | `npm run test:multi-provider-performance`, `npm run test:single-provider-regression` → 단일 provider **평균 500ms 이하** [Multi-Provider-Search-Performance-Testing.md](../../../../reference/ko/Multi-Provider-Search-Performance-Testing.md) |
| **속도 — 임베딩** | 임베딩 생성 지연·메모리 | `npm run benchmark:embedding`, [embedding-performance-benchmark.md](../../../../reference/ko/embedding-performance-benchmark.md) |
| **정확성 — 검색 품질** | consolidation 점수 반영·랭킹 일관성 | `npm run benchmark:consolidation-quality`, baseline 비교 [consolidation-quality-testing.md](../../../../_work/testing/ko/consolidation-quality-testing.md) |
| **정확성 — recall 활용도** (선택) | recall 결과가 실제 답변/행동에 반영되는지 | MVP 검증 지표로 정의 가능 [memento-based-personal-assistant-mvp-research.md](../../../../_work/research/ko/memento-based-personal-assistant-mvp-research.md) |

### 2.2 판단 기준(안)

- **속도**
  - recall: 전형적 워크로드에서 `total_ms` 수집 후, **p95 또는 평균 임계값**을 팀에서 합의(예: p95 &lt; 500ms 또는 1s).
  - 단일 provider 검색: 기존 문서 기준 **평균 500ms 이하** 유지.
  - 임베딩: 프로바이더별 벤치마크 결과 대비 **회귀 없음** 확인.
- **정확성**
  - consolidation 품질: **baseline 대비 회귀 없음** (`benchmark:consolidation-quality`).
  - (선택) recall 활용도: MVP 단계에서 “기억 활용 정확도” 지표 정의 후 측정.

### 2.3 절차

1. **측정 실행**
   - `MEMENTO_RECALL_PROFILE=1`로 일상/대표 시나리오에서 recall 호출 → `total_ms` 수집.
   - `npm run test:multi-provider-performance`, `npm run test:single-provider-regression` 실행.
   - `npm run benchmark:embedding` 실행.
   - `npm run benchmark:consolidation-quality` 실행 (baseline 경로 설정 시 `CONSOLIDATION_BASELINE_PATH` 사용).
2. **기준 대조**
   - 위 2.2 기준(속도·정확성)에 맞는지 체크리스트로 정리.
3. **산출물**
   - **성능 적정성 체크리스트**(또는 1페이지 요약): 차원별 통과 여부, 미달 시 조치(튜닝·인덱스·설정 변경 등).
4. **결론**
   - **전 항목 통과** 시 → Phase 1(성장 로드맵) 진행.
   - **미달** 시 → 원인 분석·개선 후 재측정, 재판단 후 성장 단계 진입.

### 2.4 문서화

- Phase 0 결과는 `docs/reviews/ko/` 또는 `docs/plans/ko/`에 **성능 적정성 보고서**(날짜 포함)로 남기고, 성장 로드맵 문서에서 링크한다.

---

## 3. Phase 1: 성장 로드맵 (마일스톤 결합)

Phase 0 통과 후 실행. 각 제품 마일스톤에 **채택·생태계 행동 1개**를 묶는다.

| 마일스톤 | 제품(B) | 채택·생태계(A·C) |
|----------|---------|-------------------|
| MVP 배포 | Actionable Memory Assistant v0.1 (/chat + Memento 연동) | Cursor 설정 가이드·AGENTS.md 예시 갱신, “Actionable Memory 예제” 1편 |
| Phase2 기능 1종 | 스킬 1종 또는 다채널/세션 등 1단계 | 해당 기능 사용 예시·블로그 또는 OpenClaw 연동 스펙 1개 |
| M2(팀 모드) | 팀용 서버·인증·배포 설계/구현 | 팀용 Docker·배포 가이드, (가능 시) MCP 디렉터리 등록 |

- 세부 일정·태스크는 구현 계획에서 정리.
- 각 마일스톤 완료 시 Phase 0 항목 중 영향받는 부분(예: recall 부하 변화)이 있으면 **선택적 재측정**으로 회귀 여부만 확인하는 것을 권장.

---

## 4. 참조

- [memento-based-personal-assistant-mvp-research.md](../../../../_work/research/ko/memento-based-personal-assistant-mvp-research.md) — MVP 범위·검증 지표
- [Issue #57 Phase2 로드맵](../2026-02-05-issue57-phase2/roadmap.md) — Issue #57 Phase2
- [Memento-Milestones.md](../../../../reference/ko/Memento-Milestones.md) — M1~M4 비전
- [recall-performance-tuning.md](../../../../guides/ko/recall-performance-tuning.md) — recall 프로파일링
- [Multi-Provider-Search-Performance-Testing.md](../../../../reference/ko/Multi-Provider-Search-Performance-Testing.md) — 검색 성능 기준(500ms 등)
