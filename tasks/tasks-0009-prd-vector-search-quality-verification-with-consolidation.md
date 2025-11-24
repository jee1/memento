# tasks-0009-prd-vector-search-quality-verification-with-consolidation.md

## Relevant Files

- `src/test/helpers/vector-search-quality-metrics.ts` - 순서 보존 지표 계산 헬퍼 (Kendall's Tau, Spearman's Rho, 상위 K개 유지율 계산, 벡터-only/Consolidation 결과 생성, 리포트 생성)
- `src/test/helpers/vector-search-quality-metrics.spec.ts` - 순서 보존 검증 단위 테스트 (Kendall's Tau ≥0.7, Top10 ≥80%, Top5 ≥90% 임계값 검증 포함)
- `src/test/test-vector-search-quality-with-consolidation.ts` - 벡터 검색 품질 검증 메인 테스트 파일 (순서 보존, 품질 지표 비교, 극단적 시나리오 검증 통합) - 예정
- `src/algorithms/hybrid-search-engine.ts` - 벡터 유사도만 사용한 검색 옵션 추가 (필요시)
- `src/test/helpers/search-quality-metrics.ts` - 기존 품질 지표 계산 로직 재사용 (Precision/Recall/NDCG)
- `src/test/helpers/consolidation-test-data.ts` - 기존 테스트 데이터 생성 로직 재사용
- `src/test/test-consolidation-search-quality.ts` - 기존 E2E 테스트 구조 참고
- `docs/testing/consolidation-quality-testing.md` - 품질 검증 가이드 문서 업데이트 - 예정
- `data/vector-search-quality-baseline.json` - Baseline 스냅샷 저장 파일 - 예정

### Notes

- 기존 `search-quality-metrics.ts`의 Precision/Recall/NDCG 계산 로직을 재사용합니다.
- 기존 `consolidation-test-data.ts`의 테스트 데이터 생성 로직을 재사용합니다.
- 순서 보존 지표(Kendall's Tau, Spearman's Rho)는 라이브러리 사용 또는 직접 구현합니다.
- Baseline 스냅샷은 JSON 형식으로 저장하며 버전 관리 및 비교를 위한 메타데이터를 포함합니다.
- 테스트는 Vitest를 사용하며, `npm test`로 실행합니다.

## Tasks

- [x] 1.0 벡터 검색 결과 순서 보존 검증 기능 구현
  - [x] 1.1 `src/test/helpers/vector-search-quality-metrics.ts` 파일 생성 및 기본 인터페이스 정의 (OrderPreservationMetrics, SearchResultPair 등)
  - [x] 1.2 Kendall's Tau 순서 일치도 계산 함수 구현 (`calculateKendallTau`)
  - [x] 1.3 Spearman's Rho 순서 일치도 계산 함수 구현 (`calculateSpearmanRho`) - 선택적
  - [x] 1.4 상위 K개 결과 유지율 계산 함수 구현 (`calculateTopKRetention`) - Acceptance Criteria: Top10 ≥80%, Top5 ≥90%
  - [x] 1.5 벡터 유사도만 사용한 검색 결과 생성 헬퍼 함수 구현 (`generateVectorOnlySearchResults`)
  - [x] 1.6 Consolidation 점수 반영 후 검색 결과 생성 헬퍼 함수 구현 (`generateConsolidationSearchResults`)
  - [x] 1.7 순서 보존 검증 결과 리포트 생성 함수 구현 (`generateOrderPreservationReport`)
  - [x] 1.8 순서 보존 검증 단위 테스트 작성 (Kendall's Tau ≥0.7, Top10 유지율 ≥80%, Top5 유지율 ≥90% 임계값 검증 포함)
- [x] 2.0 품질 지표 비교 기능 구현
  - [x] 2.1 벡터 유사도만 사용한 검색 결과에서 품질 지표 측정 함수 구현 (`measureVectorOnlyQuality`)
  - [x] 2.2 Consolidation 점수 반영 후 품질 지표 측정 함수 구현 (`measureConsolidationQuality`)
  - [x] 2.3 품질 저하율 계산 함수 구현 (`calculateQualityDegradation`)
  - [x] 2.4 품질 저하 임계값 검증 함수 구현 (`validateQualityThresholds`) - NDCG@5 < 5%, Precision@5 < 10%, Recall@5 < 10%
  - [x] 2.5 Ground Truth 기반 품질 비교 함수 구현 (`compareQualityWithGroundTruth`)
  - [x] 2.6 품질 비교 결과 리포트 생성 함수 구현 (`generateQualityComparisonReport`)
  - [x] 2.7 품질 비교 결과 시각화 함수 구현 (선택적, FR-2.5) - Markdown 표 또는 간단한 그래프 출력
  - [x] 2.8 품질 지표 비교 단위 테스트 작성
- [x] 3.0 극단적 시나리오 검증 기능 구현
  - [x] 3.1 저벡터 유사도 + 고 consolidation 점수 시나리오 검증 함수 구현 (`validateLowVectorHighConsolidation`)
  - [x] 3.2 고벡터 유사도 + 저 consolidation 점수 시나리오 검증 함수 구현 (`validateHighVectorLowConsolidation`)
  - [x] 3.3 w2 상한(0.4) 검증 함수 구현 (`validateW2UpperBound`) - w2=0.4 vs w2=0.6 비교
  - [x] 3.4 극단적 시나리오 검증 결과 리포트 생성 함수 구현 (`generateExtremeScenarioReport`)
  - [x] 3.5 극단적 시나리오 검증 단위 테스트 작성
- [x] 4.0 Baseline 스냅샷 관리 기능 구현
  - [x] 4.1 Baseline 스냅샷 인터페이스 정의 (`BaselineSnapshot`) - PRD의 구조 참고
  - [x] 4.2 Baseline 스냅샷 저장 함수 구현 (`saveBaselineSnapshot`) - JSON 형식으로 `data/vector-search-quality-baseline.json`에 저장
  - [x] 4.3 Baseline 스냅샷 로드 함수 구현 (`loadBaselineSnapshot`)
  - [x] 4.4 Baseline과 현재 결과 비교 함수 구현 (`compareWithBaseline`)
  - [x] 4.5 품질 저하 감지 및 알림 함수 구현 (`detectQualityDegradation`)
  - [x] 4.6 Baseline 스냅샷 관리 단위 테스트 작성
- [ ] 5.0 통합 테스트 및 문서화
  - [ ] 5.1 `src/test/test-vector-search-quality-with-consolidation.ts` 메인 테스트 파일 생성
  - [ ] 5.2 테스트 데이터 준비 함수 구현 (기존 `consolidation-test-data.ts` 활용) - 시드 기반 데이터 생성 및 동일 입력 동일 결과 검증 포함 (FR-5.3), 다양한 시나리오 샘플 데이터 구성: 벡터 유사도 높음/낮음, Consolidation 높음/낮음, 극단적 조합 케이스 포함 (FR-5.2)
  - [ ] 5.3 Ground Truth 생성 함수 구현 (자동 생성 및 JSON 파일 로드 지원) - 시드 설정 및 재현성 보장 (FR-5.3)
  - [ ] 5.4 순서 보존 검증 통합 테스트 작성 (벡터-only vs consolidation 비교) - Acceptance Criteria 검증: Kendall's Tau ≥0.7, Top10 유지율 ≥80%, Top5 유지율 ≥90%
  - [ ] 5.5 품질 지표 비교 통합 테스트 작성 (Precision/Recall/NDCG 비교) - Acceptance Criteria 검증: NDCG@5 저하율 <5%, Precision@5 저하율 <10%, Recall@5 저하율 <10%
  - [ ] 5.6 극단적 시나리오 검증 통합 테스트 작성
  - [ ] 5.7 Baseline 스냅샷 저장 및 비교 통합 테스트 작성
  - [ ] 5.8 리포트 생성 및 파일 저장 기능 구현 (JSON, Markdown 형식)
  - [ ] 5.9 품질 저하 감지 시 경고 메시지 출력 기능 구현
  - [ ] 5.10 `docs/testing/consolidation-quality-testing.md` 문서 업데이트 (벡터 검색 품질 검증 섹션 추가)
  - [ ] 5.11 CI/CD 파이프라인 통합 (package.json에 테스트 스크립트 추가, 필요시 GitHub Actions 설정) - Vitest JUnit/JSON 리포트 아티팩트 업로드 포함 (FR-7.3), 테스트 실패 시 파이프라인 실패 처리 (exit code 1, FR-7.2)
  - [ ] 5.12 전체 통합 테스트 실행 및 검증 (모든 테스트 케이스 통과 확인)
