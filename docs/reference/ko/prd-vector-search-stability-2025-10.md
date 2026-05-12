# PRD: 임베딩/벡터 검색 안정화 (2025-10)

## 1. 배경
- 최근 코드 검토(`docs/code-review-2025-10.md`)에서 임베딩 저장 스키마, vec0 연동, 하이브리드 검색 로직 전반에 치명적인 불일치가 확인되었다.
- 해당 문제는 MCP 서버의 핵심 기능인 기억 검색 품질을 직접 저하시킬 뿐 아니라, 초기화 단계에서 즉시 실패할 위험이 있어 조속한 정비가 필요하다.

## 2. 문제 요약
1. **스키마와 서비스 불일치**  
   - `memory_embedding` 테이블에 `embedding_provider`, `dimensions` 컬럼이 없는데 서비스 로직과 트리거가 해당 필드를 참조한다.

2. **벡터 차원 고정**  
   - `VectorSearchEngine`이 384차원만 허용해 OpenAI(1536), Gemini(768) 임베딩을 사용할 수 없다.

3. **vec0 rowid 매핑 오류**  
   - vec0 테이블의 `rowid`와 `memory_item.id`(TEXT)를 직접 조인해 검색 결과가 누락된다.

4. **다중 타입 필터 미지원**  
   - 하이브리드 검색에서 타입 배열을 콤마 문자열로 전달해 단일 타입만 필터링된다.

5. **OpenAI 제공자 미등록**  
   - 팩토리에서 OpenAI를 가용 목록에 노출하지만 실제 인스턴스가 없어 항상 폴백이 발생한다.

## 3. 목표
- 임베딩 저장, vec0 갱신, 텍스트/벡터/하이브리드 검색이 모든 지원 제공자(TF-IDF, MiniLM, OpenAI, Gemini)에서 일관되게 작동하도록 만든다.
- 데이터베이스 스키마-애플리케이션 간 불일치를 제거하고, 관련 회귀 테스트를 추가한다.

## 4. 범위
- **포함**  
  - DB 스키마 및 트리거 수정
  - 서비스/엔진 로직 보완
  - 임베딩 제공자 팩토리 확장
  - 관련 단위/통합 테스트 추가
- **제외**  
  - 신규 검색 알고리즘 연구  
  - 외부 API 키 관리나 인프라 설정 변경

## 5. 이해관계자
- 제품 책임자: 검색 기능 품질 유지
- 백엔드 팀: MCP 서버 유지보수
- 데이터/ML 팀: 임베딩 파이프라인 운영

## 6. 요구사항
### 6.1 기능 요구
1. `memory_embedding` 스키마에 `embedding_provider`, `dimensions` 컬럼을 추가하고, 트리거가 해당 필드를 안전하게 참조하도록 수정할 것. 마이그레이션 경로 제공.  
2. 임베딩 저장 로직(`MemoryEmbeddingService`)이 새 컬럼과 호환되도록 업데이트하며, 기존 JSON 필드 파싱 실패 시 방어 로직 추가.  
3. vec0 트리거 및 `VectorSearchEngine`이 문자열 ID 대신 정수 PK를 기준으로 동기화/조인하도록 개편하거나, 대체 키를 사용하는 방식으로 일관성 확보.  
4. `VectorSearchEngine`이 제공자별 차원을 동적으로 감지하고, 입력 벡터 길이 검증/쿼리를 해당 차원에 맞춰 실행할 것.  
5. 하이브리드 검색이 다중 타입 필터를 지원하도록 벡터 검색 옵션 및 SQL 조건을 조정.  
6. `EmbeddingProviderFactory`에서 OpenAI 제공자를 실제 구현체와 함께 등록하고, 구성값/환경변수가 없는 경우 graceful fallback을 제공.  
7. (옵션) vec0 테이블이 없는 환경에서 명확한 경고와 폴백 경로를 제공.

### 6.2 비기능·테스트 요구
1. 스키마 변경에 대한 마이그레이션 스크립트와 롤백 전략 문서화.  
2. TF-IDF, MiniLM, OpenAI, Gemini 각각에 대해 임베딩 저장 → vec0 반영 → 벡터 검색까지 이어지는 통합 테스트 추가.  
3. 하이브리드 검색이 다중 타입 필터에서 정확한 결과를 반환하는 테스트 케이스 작성.  
4. OpenAI 제공자 선택 경로에 대한 단위 테스트와, API 키 미설정 시 폴백 동작 검증.  
5. 기존 테스트 스위트(`npm test`, `npm run test:search`) 통과 보장.

## 7. 사용자 시나리오
1. **다중 제공자 환경**  
   - 사용자가 OpenAI 임베딩을 활성화하면, 서버는 문제 없이 벡터 검색과 하이브리드 검색을 수행하고 정확한 결과를 반환한다.
2. **다중 타입 검색 요청**  
   - 사용자가 여러 메모리 타입을 동시에 검색 요청할 때, 텍스트/벡터 결과 모두 필터가 정확히 적용된다.
3. **vec0 미설치 환경**  
   - sqlite-vec 확장이 없는 경우에도 서버는 명확한 로그와 함께 텍스트 검색으로 폴백하여 장애를 피한다.

## 8. 성공 지표
- 회귀 테스트에서 제공자별 검색 시나리오가 100% 성공.  
- 서버 초기화/검색 단계에서 `no such column`, `dimension mismatch`, `rowid` 관련 오류가 0건.  
- 프로덕션 모니터링 지표에서 벡터 검색 실패율이 1% 미만으로 유지.

## 9. 일정/마일스톤 (제안)
| 일정 | 항목 |
| --- | --- |
| 주간 1 | 스키마/트리거 개편, 마이그레이션 설계 |
| 주간 2 | 서비스/엔진 로직 수정 및 단위 테스트 완성 |
| 주간 3 | 통합 테스트 구축, QA 및 회귀 테스트 |
| 주간 4 | 문서 업데이트, 배포 준비 |

## 10. 위험 및 대응
- **DB 마이그레이션 실패**: 사전 백업 지침 및 롤백 스크립트 제공.  
- **외부 API 키 누락**: 구성 검증 강화, 초기화 단계에서 명시적 경고.  
- **성능 회귀**: 성능 테스트(`vector-search-engine.performanceTest`)를 활용해 임계치 모니터링.

## 11. 후속 작업
- 마이그레이션 가이드 및 개발자 문서 보강.  
- 필요 시 운영 측면에서 vec0 확장 배포 자동화 검토.

## 12. 진행 현황 스냅샷 (2025-10-27)
- 데이터베이스 스키마/트리거 개편 및 `002_sync_embedding_provider` 마이그레이션 작성 완료.
- `MemoryEmbeddingService`, `VectorSearchEngine`, `HybridSearchEngine` 전반에서 제공자별 차원, 다중 타입 필터, vec0 비가용 시 폴백 경로 정비.
- `EmbeddingProviderFactory`에 OpenAI 제공자 등록과 환경 변수 검증 로직을 추가해 폴백 전략을 문서화.
- 테스트 보강: 제공자별 통합 시나리오(5.1)와 다중 타입 필터·차원 불일치·vec0 미설치 회귀 테스트(5.2) 구축.
- 잔여 과제: 문서 마무리(5.3) 및 전체 테스트 실행/증적 정리(5.4).

## 13. 테스트 커버리지 업데이트

> **경로 (2026-05)**: 아래 스펙 파일은 모노레포 기준 `packages/memento-core/src/domains/search/algorithms/__tests__/`에 있습니다. 최신 실행은 저장소 루트에서 `npm test` 또는 개별 `vitest` 경로를 사용하세요.

- `packages/memento-core/src/domains/search/algorithms/__tests__/vector-search-engine.spec.ts`  
  - 다중 타입 필터를 IN 절+바인딩으로 전달하는지 검증.  
  - 제공자별 차원 검증 실패 시 vec 쿼리가 호출되지 않는지 확인.  
  - sqlite-vec 미설치 환경에서 안전 폴백을 검증.  
  - 고차원(OpenAI/Gemini) 제공자에 대한 includeMetadata 흐름 확인.  
- `packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts`  
  - vec 경로 활성화 시 타입 배열 전달과 임베딩 생성 플로를 검증.  
  - vec 인덱스가 비활성화된 경우 `searchBySimilarity` 폴백에 타입 배열이 동일하게 전달되는지 확인.  
- 시나리오 예시: `npx vitest run packages/memento-core/src/domains/search/algorithms/__tests__/vector-search-engine.spec.ts packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts`

## 14. 릴리스 노트 초안
### 14.1 개선 사항
- **데이터베이스**  
  - `memory_embedding`에 `embedding_provider`, `dimensions` 컬럼을 추가하고 vec0 트리거를 정수 PK 기반으로 정비.  
  - 신규 마이그레이션 `002_sync_embedding_provider.sql` 포함 및 초기화 스크립트 업데이트.
- **서비스/엔진**  
  - `MemoryEmbeddingService` 방어 로직 추가(차원/제공자 기본값, JSON 파싱 실패 처리).  
  - `VectorSearchEngine`이 제공자별 차원을 동적 감지, 다중 타입 필터와 include 옵션을 신뢰성 있게 처리.  
  - `HybridSearchEngine`이 vec 사용 가능 여부에 따라 타입 배열을 유지하며 VEC / 폴백 검색을 전환.  
- **임베딩 제공자**  
  - OpenAI 제공자 구현체 등록, 환경 변수 검증, 폴백 순서 정비.  
  - `env.example`과 한국어/영문 README에 OpenAI 설정 안내 추가.
- **테스트**  
  - 벡터/하이브리드 검색 회귀 테스트 추가로 차원 불일치·vec0 미설치·다중 타입 필터를 커버.  
  - TF-IDF, MiniLM, OpenAI, Gemini 제공자별 통합 경로 시나리오 확장.

### 14.2 배포 전 확인 권장
1. `npm run db:migrate` 실행 후 새 컬럼과 트리거가 반영되었는지 확인.  
2. `npm test`, `npm run test:search` 전체 스위트를 통과시키고, 필요 시 vec0 확장 없이 구동해 폴백 로그를 검증.  
3. `.env`에 OpenAI 키/모델/차원을 설정하고 `npm run dev` 구동 시 경고 로그가 없는지 확인.  
4. 배포 공지에 다중 타입 필터 지원과 폴백 전략 변경 사항을 포함.
