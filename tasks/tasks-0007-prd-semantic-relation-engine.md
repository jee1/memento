# tasks-0007-prd-semantic-relation-engine.md

## Relevant Files

- `src/database/migration/migrations/005-relation-engine-schema.sql` - 관계 엔진을 위한 데이터베이스 스키마 마이그레이션 (memory_relation, relation_type_registry 테이블 생성)
- `src/database/migration/migrations/005-relation-engine-schema.ts` - 마이그레이션 실행 로직 및 기존 memory_link 데이터 마이그레이션
- `src/database/migration/migrations/005-relation-engine-schema.spec.ts` - 마이그레이션 테스트
- `src/services/relation-extractor.ts` - 관계 추출 엔진 메인 서비스 클래스
- `src/services/relation-extractor.spec.ts` - 관계 추출 엔진 단위 테스트
- `src/services/rule-based-relation-extractor.ts` - 규칙 기반 관계 추출 구현
- `src/services/rule-based-relation-extractor.spec.ts` - 규칙 기반 추출 테스트
- `src/services/llm-based-relation-extractor.ts` - LLM 기반 관계 추출 구현
- `src/services/llm-based-relation-extractor.spec.ts` - LLM 기반 추출 테스트
- `src/services/relation-graph.ts` - 관계 그래프 저장 및 관리 서비스
- `src/services/relation-graph.spec.ts` - 관계 그래프 서비스 테스트
- `src/services/relation-refinement.ts` - 관계 강화 학습 서비스 (Phase 2, 파일 상단에 `@phase:2` 메타태그 주석 포함)
- `src/services/relation-refinement.spec.ts` - 관계 강화 학습 테스트
- `src/algorithms/search-ranking.ts` - 검색 랭킹 클래스 확장 (관계 가중치 추가)
- `src/algorithms/search-ranking.spec.ts` - 검색 랭킹 확장 테스트
- `src/algorithms/hybrid-search-engine.ts` - 하이브리드 검색 엔진에 관계 가중치 통합
- `src/algorithms/hybrid-search-engine.spec.ts` - 하이브리드 검색 엔진 통합 테스트
- `src/services/anchor/anchor-search-service.ts` - 앵커 검색 서비스에 관계 그래프 통합
- `src/services/anchor/anchor-search-service.spec.ts` - 앵커 검색 서비스 통합 테스트
- `src/tools/extract-relations-tool.ts` - MCP Tool: 관계 추출 도구
- `src/tools/extract-relations-tool.spec.ts` - 관계 추출 도구 테스트
- `src/tools/get-relations-tool.ts` - MCP Tool: 관계 조회 도구
- `src/tools/get-relations-tool.spec.ts` - 관계 조회 도구 테스트
- `src/tools/add-relation-tool.ts` - MCP Tool: 관계 추가 도구
- `src/tools/add-relation-tool.spec.ts` - 관계 추가 도구 테스트
- `src/tools/remove-relation-tool.ts` - MCP Tool: 관계 삭제 도구
- `src/tools/remove-relation-tool.spec.ts` - 관계 삭제 도구 테스트
- `src/tools/visualize-relations-tool.ts` - MCP Tool: 관계 그래프 시각화 도구
- `src/tools/visualize-relations-tool.spec.ts` - 관계 시각화 도구 테스트
- `src/services/relation-visualizer.ts` - 관계 그래프 시각화 유틸리티
- `src/services/relation-visualizer.spec.ts` - 시각화 유틸리티 테스트
- `config/ranking-weights.toml` - 검색 랭킹 가중치 설정 파일
- `src/config/ranking-weights-loader.ts` - TOML 설정 파일 로더 및 검증 유틸리티
- `src/config/ranking-weights-loader.spec.ts` - 설정 로더 테스트
- `tests/fixtures/relation_testset.json` - 관계 추출 품질 검증용 테스트 데이터셋
- `tests/integration/relation-extraction-quality.spec.ts` - 관계 추출 품질 검증 통합 테스트
- `tests/integration/mcp-relation-tools.spec.ts` - MCP 관계 도구 E2E 통합 테스트
- `scripts/generate-relation-report.ts` - 관계 추출 품질 리포트 자동 생성 스크립트
- `.github/workflows/relation-engine.yml` - 관계 엔진 전용 CI 워크플로우
- `docs/relation-labeling-guide.md` - 관계 라벨링 가이드 문서
- `docs/api/relation-graph-api.md` - RelationGraph API 스펙 문서

### Notes

- 단위 테스트는 각 서비스/클래스 파일과 같은 디렉토리에 `.spec.ts` 확장자로 배치합니다.
- 통합 테스트는 `tests/integration/` 디렉토리에 배치합니다.
- 마이그레이션 파일은 `src/database/migration/migrations/` 디렉토리에 배치합니다.
- Config 파일은 `config/` 디렉토리에 배치합니다.
- 테스트 데이터셋은 `tests/fixtures/` 디렉토리에 배치합니다.
- `npm test` 명령어로 모든 테스트를 실행할 수 있습니다.

## Pre-Setup Tasks (구현 전 필수 작업)

- [x] 0.1 테스트 데이터셋 준비: `tests/fixtures/relation_testset.json` 생성 (최소 300건, 관계 유형별 50건 이상)
- [x] 0.2 Config 파일 초기 배포: `config/ranking-weights.toml` 생성 및 TOML 파서 의존성 추가
- [x] 0.3 RelationGraph API 스펙 초안 정의: `docs/api/relation-graph-api.md` 작성 (함수 시그니처, 인터페이스, 에러 처리 규칙, 성능 요구사항)

## Tasks

- [x] 1.0 데이터베이스 스키마 확장 및 마이그레이션
  - [x] 1.1 `memory_relation` 테이블 생성 SQL 스크립트 작성 (id, source_id, target_id, relation_type, confidence, created_at, updated_at, metadata 필드 포함)
  - [x] 1.2 `relation_type_registry` 테이블 생성 SQL 스크립트 작성 (type_name, category, description, applicable_types, default_confidence, search_boost 필드 포함)
  - [x] 1.3 관계 테이블 인덱스 생성 SQL 작성 (source_id, target_id, relation_type, confidence, 복합 인덱스 포함)
  - [x] 1.4 초기 관계 유형 레지스트리 데이터 삽입 SQL 작성 (CAUSES, DEPENDS_ON, FOLLOWS, CONTRASTS_WITH, REFERENCES, BELONGS_TO 6가지 관계 유형)
  - [x] 1.5 마이그레이션 클래스 구현 (`005-relation-engine-schema.ts`): Migration 인터페이스 구현, up/down 메서드, validateBefore/validateAfter 메서드
  - [x] 1.6 기존 `memory_link` 데이터를 `memory_relation`으로 마이그레이션 로직 구현 (relation_type 매핑: cause_of→CAUSES, derived_from→DEPENDS_ON, contradicts→CONTRASTS_WITH)
  - [x] 1.7 마이그레이션 단위 테스트 작성 (테이블 생성, 인덱스 생성, 데이터 마이그레이션 검증)
  - [x] 1.8 마이그레이션 통합 테스트 작성 (롤백 테스트, 의존성 검증 테스트)

- [ ] 2.0 관계 추출 엔진 구현
  - [x] 2.1 `RelationCandidate` 타입 정의 및 `IRelationExtractor` 인터페이스 정의 (`src/types/relation.ts`)
  - [x] 2.2 `RuleBasedRelationExtractor` 클래스 구현: 키워드 패턴 매칭 로직 (CAUSES, FOLLOWS, DEPENDS_ON, REFERENCES, CONTRASTS_WITH, BELONGS_TO)
  - [x] 2.3 `RuleBasedRelationExtractor` 신뢰도 계산 로직 구현 (패턴 매칭 강도 기반 0.5~0.8 범위)
  - [x] 2.4 `RuleBasedRelationExtractor` 단위 테스트 작성 (각 관계 유형별 패턴 매칭 테스트)
  - [x] 2.5 `LLMBasedRelationExtractor` 클래스 구현: LLM 제공자 선택 (OpenAI Chat API 또는 Gemini Chat API), LLM 프롬프트 템플릿 작성 및 파싱 로직
  - [x] 2.6 `LLMBasedRelationExtractor` 비용 최적화 전략 구현 (임베딩 기반 후보 제한, rate limit, 프롬프트 압축, 캐싱)
  - [x] 2.7 `LLMBasedRelationExtractor` MiniLM 전처리 필터 구현: MiniLM 임베딩으로 후보 필터링 (새 기억 임베딩 생성 → 기존 기억들과 cosine similarity 계산 → 상위 N=30개만 선정 → LLM에 전달하여 비용 최소화) - `filterCandidatesByEmbedding` 메서드로 구현됨, UnifiedEmbeddingService가 기본값으로 MiniLM 사용
  - [x] 2.8 `LLMBasedRelationExtractor` 단위 테스트 작성 (LLM 호출 모킹, MiniLM 필터링 검증, 캐싱 테스트, 비용 절감 효과 검증) - 테스트 파일 작성 완료, 모든 테스트 통과 (18/18) (`llm-based-relation-extractor.spec.ts`)
  - [x] 2.9 `RelationExtractor` 메인 서비스 클래스 구현: 하이브리드 방식 (규칙 기반 → LLM fallback), 타입별 관계 유형 필터링 - `relation-extractor.ts` 구현 완료
  - [x] 2.10 `RelationExtractor` 성능 최적화 구현 (MiniLM 기반 후보 필터링, 비동기 배치 처리, 캐싱) - 캐싱 추가 (7일 TTL), 배치 처리 메서드 추가 (`extractRelationsBatch`), MiniLM 필터링 옵션 전달 (candidateLimit 기본값 30)
  - [x] 2.11 `RelationExtractor` 통합 테스트 작성 (하이브리드 추출 플로우, 타입별 필터링 검증, MiniLM 필터링 효과 검증) - 테스트 파일 작성 완료, 모든 테스트 통과 (14/14) (`relation-extractor.spec.ts`)
  - [x] 2.12 `RememberTool`에 관계 추출 통합: 기억 저장 후 자동 관계 추출 트리거 (비동기 배치 처리) - `remember-tool.ts`에 관계 추출 통합 완료, 기억 저장 후 비동기로 관계 추출 트리거, 최근 100개 기억과 비교하여 관계 추출, RelationGraph 구현 대비 TODO 주석 추가

- [ ] 3.0 관계 그래프 저장 및 관리 서비스 구현
  - [x] 3.1 `MemoryRelation` 타입 정의 및 `IRelationGraph` 인터페이스 정의 - `relation-graph.ts` 타입 파일 생성 완료
  - [x] 3.2 `RelationGraph` 서비스 클래스 기본 구조 구현 (생성자, 데이터베이스 연결) - `relation-graph.ts` 기본 구조 구현 완료, L1/L2 캐싱 계층 포함
  - [x] 3.3 `RelationGraph.addRelation` 메서드 구현: 관계 추가, UNIQUE 제약 검증, 순환 참조 감지 (DFS) - `addRelation` 메서드 구현 완료, `detectCycle` DFS 알고리즘 포함, `metadata.cyclic` 플래그 자동 설정
  - [x] 3.4 `RelationGraph.getRelations` 메서드 구현: 관계 조회 (direction: outgoing/incoming/both, relationType 필터링) - `getRelations` 메서드 구현 완료, L1/L2 캐싱 포함
  - [x] 3.5 `RelationGraph.getRelatedMemories` 메서드 구현: BFS 기반 N-hop 관계 탐색 - `getRelatedMemories` 메서드 구현 완료, BFS 알고리즘으로 N-hop 탐색
  - [x] 3.6 `RelationGraph.removeRelation` 메서드 구현: 관계 삭제 - `removeRelation` 메서드 구현 완료, 캐시 무효화 포함
  - [x] 3.7 `RelationGraph.updateConfidence` 메서드 구현: 신뢰도 갱신 - `updateConfidence` 메서드 구현 완료, refinement_history 자동 기록
  - [x] 3.8 순환 참조 감지 알고리즘 구현 (DFS 기반, `metadata.cyclic=true` 플래그 추가) - `detectCycle` 메서드 구현 완료, DFS 알고리즘, `addRelation`에서 `metadata.cyclic` 플래그 자동 설정
  - [x] 3.9 대규모 데이터 성능 최적화: L1/L2 캐싱 계층 구현 (MemoryCache TTL 10분, PersistentCache TTL 7일) - L1 캐시 (1000개, 10분 TTL), L2 캐시 (5000개, 7일 TTL) 구현 완료
  - [x] 3.10 배치 삽입 최적화 구현 (여러 관계를 한 번에 삽입) - `addRelationsBatch` 메서드 구현 완료, 트랜잭션으로 배치 처리
  - [x] 3.11 `RelationGraph` 단위 테스트 작성 (CRUD 작업, 순환 참조 감지, 성능 테스트) - `relation-graph.spec.ts` 작성 완료, 모든 테스트 통과 (34/34)
  - [x] 3.12 `RelationGraph` 캐시 계층 단위 테스트 세분화: L1 캐시 TTL 만료 테스트, L2 캐시 fallback 테스트, 캐시 무효화 테스트 - 캐시 계층 테스트 추가 완료, 모든 테스트 통과 (43/43)
  - [x] 3.13 `RelationGraph` 통합 테스트 작성 (대량 데이터 처리, 캐싱 동작 검증) - `relation-graph.integration.spec.ts` 작성 완료, 모든 테스트 통과 (14/14)

- [x] 4.0 검색 랭킹에 관계 가중치 통합
  - [x] 4.1 `config/ranking-weights.toml` 파일 생성: 기본 가중치 설정 (alpha=0.45, beta=0.20, gamma=0.20, delta=0.10, zeta=0.15, epsilon=0.10) - 파일 이미 존재, 기본 가중치 설정 완료
  - [x] 4.2 TOML 설정 파일 로더 구현 (`src/config/ranking-weights-loader.ts`) - 파일 이미 존재, 완전히 구현됨
  - [x] 4.3 `SearchRanking` 클래스에 `calculateRelationWeight` 메서드 추가: 관계 가중치 계산 로직 (confidence * type_boost 정규화) - `calculateRelationWeight` 메서드 구현 완료
  - [x] 4.4 `SearchRanking.calculateFinalScore` 메서드 확장: 관계 가중치(zeta) 항목 추가 - `calculateFinalScore`에 관계 가중치 항목 추가 완료, `SearchFeatures`와 `SearchRankingWeights` 인터페이스 업데이트
  - [x] 4.5 `SearchRanking` 단위 테스트 작성 (관계 가중치 계산, 최종 점수 공식 검증) - `calculateRelationWeight` 테스트 추가 완료, `calculateFinalScore` 테스트 업데이트 완료, 모든 테스트 통과 (62/62)
  - [x] 4.6 `HybridSearchEngine`에 관계 그래프 통합: 검색 시 관계 가중치 계산 및 적용 - `RelationGraph` 의존성 추가, `fetchRelationWeights` 메서드 구현, `combineAndSortResults`에서 관계 가중치 계산 및 `finalScore` 재계산 완료
  - [x] 4.7 `HybridSearchEngine` 검색 결과에 관계 정보 포함 (선택적) - `HybridSearchQuery`에 `includeRelations` 옵션 추가, `HybridSearchResult`에 `relations` 필드 추가, `fetchRelationWeights`에서 관계 정보도 반환하도록 수정 완료
  - [x] 4.8 `HybridSearchEngine` 통합 테스트 작성 (관계 기반 검색 랭킹 검증) - 관계 그래프 통합 테스트 추가 완료, 모든 테스트 통과 (15/15, 1 skipped)
  - [x] 4.9 실험 로그 연동 구현: `HybridSearchEngine`에 `experiment_id` 로깅 추가, A/B 변이 파라미터 기록 (가중치 변경 시 실험 ID와 함께 로깅) - `HybridSearchQuery`에 `experiment_id` 필드 추가, `ISearchLogger`에 `logExperiment` 메서드 추가, 검색 시 가중치 및 실험 파라미터 로깅 완료

- [x] 5.0 앵커 시스템에 관계 그래프 통합
  - [x] 5.1 `AnchorSearchService`에 `RelationGraph` 의존성 주입 - `setRelationGraph` 메서드 추가, 생성자에 `relationGraph` 필드 추가 완료
  - [x] 5.2 `AnchorSearchService.searchNHop` 메서드 확장: 관계 그래프 기반 hop 계산 로직 추가 - `getLinkedMemories`에서 관계 그래프 우선 사용, 관계 그래프가 없으면 memory_link 사용 (하위 호환성) 완료
  - [x] 5.3 관계 그래프와 벡터 유사도를 결합한 하이브리드 hop 점수 계산 구현 - `calculateRankingScore`에 `relationWeight` 파라미터 추가, 관계 가중치(30%)와 벡터 유사도(70%) 결합 완료
  - [x] 5.4 관계가 있는 기억에 우선순위 부여 로직 구현 - `hasRelation` 플래그 추가, `calculateRankingScore`에 관계 우선순위 부스트(15%) 적용, 정렬 시 관계가 있는 기억 우선 배치 완료
  - [x] 5.5 `SearchLocalTool`에 `use_relations` 옵션 추가 (기본값: true) - `SearchLocalSchema`에 `use_relations` 필드 추가, `SearchOptions` 인터페이스에 `use_relations` 필드 추가, `searchNHop`에 `useRelations` 파라미터 추가, 관계 그래프 사용 여부 제어 로직 구현 완료
  - [x] 5.6 `AnchorSearchService` 단위 테스트 작성 (관계 기반 hop 탐색 검증) - 관계 그래프 통합 테스트 추가: 관계 기반 hop 탐색, 관계가 있는 기억 우선순위, use_relations 옵션 제어, 관계 가중치 랭킹 반영 검증 완료 (16/16 테스트 통과)
  - [x] 5.7 `AnchorSearchService` 통합 테스트 작성 (1~2-hop 관계 탐색, 벡터 유사도 결합 검증) - 통합 테스트 추가: 1-hop 관계 탐색, 2-hop 관계 탐색, 벡터 유사도와 관계 그래프 하이브리드 검색, 복잡한 관계 네트워크 탐색 검증 완료 (20/20 테스트 통과)

- [ ] 6.0 관계 품질 검증 시스템 및 테스트
  - [x] 6.1 `docs/relation-labeling-guide.md` 작성: 관계 유형별 판단 기준, 신뢰도 범위 설정 가이드, 라벨링 예시 - 6가지 관계 유형별 판단 기준, 신뢰도 범위 설정 가이드, 라벨링 예시 및 체크리스트 작성 완료
  - [x] 6.2 `tests/fixtures/relation_testset.json` 생성: 최소 300건 이상 테스트 데이터셋 (관계 유형별 50건 이상) - 총 300건의 테스트 데이터셋 생성 완료 (CAUSES 50건, DEPENDS_ON 50건, FOLLOWS 50건, CONTRASTS_WITH 50건, REFERENCES 50건, BELONGS_TO 50건), 각 항목에 source_id, target_id, expected_relation_type, expected_confidence_range, source_content, target_content 포함
  - [x] 6.3 관계 추출 품질 검증 프로세스 구현: Precision, Recall, F1-Score 계산 로직 - `RelationQualityValidator` 서비스 구현 완료: 관계 매칭, Precision/Recall/F1-Score 계산, 관계 유형별 메트릭, 신뢰도 범위 준수율, 임계값 검증 로직 포함, 단위 테스트 15/15 통과
  - [x] 6.4 관계 유형별 정확도 분석 로직 구현 - `TypeAnalysis` 인터페이스 추가, `ConfusionMatrix` 인터페이스 추가, `calculateConfusionMatrix` 메서드 구현, `analyzeRelationType` 메서드 구현 (신뢰도 통계, 혼동 행렬, 오류 분석), `analyzeAllRelationTypes` 메서드 구현, `calculateQualityMetricsWithAnalysis` 메서드 구현, 단위 테스트 19/19 통과
  - [x] 6.5 `tests/integration/relation-extraction-quality.spec.ts` 작성: 테스트 데이터셋 기반 정확도 측정 - 통합 테스트 작성 완료: 전체 데이터셋 기반 정확도 측정, 관계 유형별 정확도 분석, 혼동 행렬 생성, 임계값 검증, 관계 유형별 샘플 테스트 (CAUSES, FOLLOWS) 포함, 단위 테스트 6/6 통과
  - [x] 6.6 `scripts/generate-relation-report.ts` 작성: PR 리뷰 시 "Relation Extraction Report" 자동 생성 스크립트 (Precision, Recall, F1-Score, 관계 유형별 정확도 리포트 생성) - 리포트 생성 스크립트 작성 완료: 명령줄 옵션 지원 (--output, --method, --sample, --min-confidence), 전체 메트릭, 관계 유형별 메트릭, 상세 분석, 혼동 행렬, 임계값 검증 포함, Markdown 형식 리포트 생성, package.json에 `generate-relation-report` 스크립트 추가
  - [x] 6.7 CI 통합: 정확도 임계값 미달 시 CI 실패 로직 구현 (Precision 0.70, Recall 0.65, F1 0.68, `allow_soft_fail=true` 옵션으로 경고만 출력하고 CI 통과) - CI 통합 완료: `--ci` 옵션 추가 (임계값 검증 및 exit code 처리), `--allow-soft-fail` 옵션 추가 (경고만 출력하고 CI 통과), `.github/workflows/ci.yml`에 관계 추출 품질 리포트 생성 단계 추가, 리포트 아티팩트 업로드 추가, 임계값 미달 시 exit code 1로 CI 실패, `allow_soft_fail=true` 시 exit code 0으로 CI 통과
  - [x] 6.8 `.github/workflows/relation-engine.yml` 워크플로우 작성: 관계 엔진 전용 CI job (테스트 실행, 리포트 생성, 정확도 검증) - 관계 엔진 전용 CI 워크플로우 작성 완료: 관계 엔진 관련 파일 변경 시에만 트리거, 관계 엔진 단위 테스트 실행, 관계 그래프 테스트 실행, 관계 추출 품질 통합 테스트 실행, 규칙 기반 리포트 생성 (필수), 하이브리드 리포트 생성 (선택적, allow-soft-fail), 리포트 아티팩트 업로드, PR에 리포트 자동 코멘트, 정확도 임계값 검증 단계 포함
  - [x] 6.9 주간 자동 검증 실행 스크립트 작성 및 스케줄러 통합 - 주간 자동 검증 스크립트 작성 완료: `scripts/weekly-relation-validation.ts` 생성 (전체 데이터셋 기반 검증, 리포트 생성, 임계값 검증), `BatchScheduler`에 주간 검증 작업 통합 (`relationValidationInterval`, `relationValidationDayOfWeek`, `relationValidationHour` 설정 추가), `scheduleWeeklyRelationValidation` 메서드 구현 (매주 일요일 새벽 2시 실행), `runWeeklyRelationValidation` 메서드 구현 (스크립트 실행 및 결과 로깅), package.json에 `weekly-relation-validation` 스크립트 추가

- [ ] 7.0 MCP Tool 인터페이스 구현
  - [x] 7.1 `ExtractRelationsTool` 구현: `memory_id`, `force` 파라미터, 관계 추출 실행 - ExtractRelationsTool 구현 완료: memory_id와 force 파라미터 지원, RelationExtractor를 사용한 관계 추출, RelationGraph에 관계 저장, ToolContext에 relationGraph 서비스 추가, 빌드 성공 확인
  - [x] 7.2 `ExtractRelationsTool` 단위 테스트 작성 - ExtractRelationsTool 단위 테스트 작성 완료: 메모리 존재 확인, 기존 메모리 없음 처리, 관계 추출 및 저장, force 옵션 테스트 (캐시 무시/사용), 중복/순환 관계 처리, 여러 메모리 관계 추출, 파라미터 검증 (memory_id 필수, 빈 문자열 검증), RelationGraph 통합 테스트 (context에 relationGraph 없음/있음), 단위 테스트 12/12 통과
  - [x] 7.3 `GetRelationsTool` 구현: `memory_id`, `relation_type`, `category`, `direction` 파라미터, 관계 조회 - GetRelationsTool 구현 완료: memory_id 필수 파라미터, relation_type 필터 (선택), category 필터 (Causal/Temporal/Structural/Semantic, 선택), direction 필터 (incoming/outgoing/both, 기본값: both), RelationGraph를 사용한 관계 조회, 메모리 존재 확인, 필터 조합 지원 (relation_type + category 교집합), 빌드 성공 확인
  - [x] 7.4 `GetRelationsTool` 단위 테스트 작성 - GetRelationsTool 단위 테스트 작성 완료: 메모리 존재 확인, 관계 없음 처리, 모든 관계 조회, direction 필터 (incoming/outgoing/both), relation_type 필터, category 필터 (Causal/Temporal/Structural/Semantic), 필터 조합 (relation_type + category 교집합), 필터 불일치 처리, RelationGraph 통합 테스트, 관계 정보 반환 검증, 파라미터 검증 (memory_id 필수, 빈 문자열, 잘못된 enum 값), 단위 테스트 16/16 통과
  - [x] 7.5 `AddRelationTool` 구현: `source_id`, `target_id`, `relation_type`, `confidence` 파라미터, 수동 관계 추가 - AddRelationTool 구현 완료: source_id, target_id, relation_type 필수 파라미터, confidence 선택 파라미터 (기본값: 0.7), 소스/타겟 메모리 존재 확인, 동일 메모리 관계 방지, RelationGraph를 사용한 관계 추가, 중복 관계 에러 처리, 순환 관계 에러 처리, 메타데이터 자동 설정 (method: manual), 빌드 성공 확인
  - [x] 7.6 `AddRelationTool` 단위 테스트 작성 - AddRelationTool 단위 테스트 작성 완료: 관계 추가 성공, confidence 기본값 사용, 소스/타겟 메모리 없음 에러 처리, 동일 메모리 관계 방지, 중복 관계 에러 처리, 순환 관계 에러 처리, 다양한 관계 유형 추가, 메타데이터 검증 (method: manual), 파라미터 검증 (source_id/target_id/relation_type 필수, confidence 범위, 잘못된 relation_type), RelationGraph 통합 테스트 (context에 relationGraph 없음/있음), 단위 테스트 16/16 통과
  - [x] 7.7 `RemoveRelationTool` 구현: `relation_id` 또는 `source_id`/`target_id`/`relation_type` 조합으로 관계 삭제 - RemoveRelationTool 구현 완료: relation_id 또는 source_id/target_id/relation_type 조합으로 관계 삭제 지원, relation_id 우선 사용, 관계 정보 조회 후 RelationGraph.removeRelation 사용 (캐시 무효화 포함), 관계 없음 에러 처리, 파라미터 검증 (relation_id 또는 source_id/target_id/relation_type 조합 필수), 빌드 성공 확인
  - [x] 7.8 `RemoveRelationTool` 단위 테스트 작성 - RemoveRelationTool 단위 테스트 작성 완료: relation_id로 관계 삭제 성공, 존재하지 않는 relation_id 에러 처리, source_id/target_id/relation_type 조합으로 관계 삭제 성공, 존재하지 않는 관계 에러 처리, 다양한 관계 유형 삭제, relation_id 우선순위 테스트 (relation_id와 source_id/target_id/relation_type 모두 제공 시), 파라미터 검증 (relation_id 또는 source_id/target_id/relation_type 조합 필수, source_id만 제공, source_id/target_id만 제공, relation_id 범위 검증, 잘못된 relation_type), RelationGraph 통합 테스트 (context에 relationGraph 없음/있음), 캐시 무효화 검증, 단위 테스트 15/15 통과
  - [x] 7.9 `RelationVisualizer` 유틸리티 클래스 구현: 텍스트 기반 관계 그래프 시각화 (`visualizeAsText`, `visualizeSubgraph`) - RelationVisualizer 유틸리티 클래스 구현 완료: visualizeAsText 메서드 (관계 목록을 텍스트로 시각화, 옵션: showMemoryIds, showConfidence, showRelationTypes, indent, arrow), visualizeSubgraph 메서드 (특정 메모리를 중심으로 서브그래프 시각화, BFS 방식으로 maxDepth까지 탐색, minConfidence 및 relationTypes 필터링, 깊이별 그룹화 출력), visualizeSimple 메서드 (간단한 텍스트 형식), visualizeAsJSON 메서드 (JSON 형식), VisualizationOptions 인터페이스 정의, 빌드 성공 확인
  - [x] 7.10 `VisualizeRelationsTool` 구현: `memory_id`, `max_depth`, `format` 파라미터, 관계 그래프 시각화 - VisualizeRelationsTool 구현 완료: memory_id 필수 파라미터, max_depth 선택 파라미터 (1~5, 기본값: 2), format 선택 파라미터 (text, subgraph, simple, json, 기본값: subgraph), min_confidence 선택 파라미터 (0.0~1.0), relation_types 선택 파라미터 (관계 유형 배열), show_memory_ids, show_confidence, show_relation_types 선택 파라미터 (기본값: true), 메모리 존재 확인, RelationGraph를 사용한 관계 조회, RelationVisualizer를 사용한 시각화 (format에 따라 적절한 메서드 호출), 빌드 성공 확인
  - [x] 7.11 `VisualizeRelationsTool` 단위 테스트 작성 - VisualizeRelationsTool 단위 테스트 작성 완료: subgraph 형식 시각화, text 형식 시각화, simple 형식 시각화, json 형식 시각화, format 기본값 (subgraph), max_depth 옵션 적용, min_confidence 옵션 적용, relation_types 필터 적용, show_memory_ids 옵션 적용, show_confidence 옵션 적용, show_relation_types 옵션 적용, 메모리 없음 에러 처리, 관계 없음 빈 시각화 반환, 파라미터 검증 (memory_id 필수, 빈 문자열, max_depth 범위, min_confidence 범위, 잘못된 format), RelationGraph 통합 테스트 (context에 relationGraph 없음/있음), 단위 테스트 21/21 통과
  - [x] 7.12 모든 관계 도구를 `src/tools/index.ts`에 등록 - 모든 관계 도구 등록 완료: ExtractRelationsTool, GetRelationsTool, AddRelationTool, RemoveRelationTool, VisualizeRelationsTool import 및 coreTools 배열에 추가, export 목록에 추가, 총 17개 도구 (기존 7개 + 앵커 5개 + 관계 엔진 5개), 빌드 성공 확인
  - [x] 7.13 `tests/integration/mcp-relation-tools.spec.ts` 작성: MCP 관계 도구 E2E 통합 테스트 (모든 도구의 end-to-end 플로우 검증, 도구 간 상호작용 테스트) - MCP 관계 도구 E2E 통합 테스트 작성 완료: ExtractRelationsTool → GetRelationsTool 플로우, AddRelationTool → GetRelationsTool → VisualizeRelationsTool 플로우, AddRelationTool → RemoveRelationTool → GetRelationsTool 플로우 (relation_id 및 source_id/target_id/relation_type 조합 삭제), 복합 시나리오 (관계 추출 → 수동 추가 → 조회 → 시각화 → 삭제), GetRelationsTool 필터링 기능 (relation_type, direction), VisualizeRelationsTool 다양한 형식 (text, subgraph, simple, json), 에러 처리 및 엣지 케이스 (존재하지 않는 메모리, 관계 없음), vitest.config.ts에 tests/ 디렉토리 포함 추가, 단위 테스트 11/11 통과

