# 0013-prd-arigraph-pipeline.md

## Introduction/Overview

이 PRD는 **AriGraph 파이프라인**을 구현하여 Episodic Memory에서 Semantic Memory로의 자동 학습 메커니즘을 구축하는 것을 목표로 합니다. Observation 저장 시 LLM을 활용하여 지식 그래프 구조(subject, predicate, object)를 추출하고, Semantic Memory를 갱신하며 Episodic-Edge를 생성합니다.

현재 Memento는 Episodic Memory와 Semantic Memory를 별도로 저장할 수 있지만, Episodic Memory에 저장된 경험들이 자동으로 Semantic Memory로 변환되지 않아 지식이 축적되지 않는 문제가 있습니다. 또한 기억 간 관계가 명시적으로 연결되지 않아 검색 시 관련 기억을 찾기 어렵고, LLM이 관찰(observation)에서 구조화된 지식을 추출하지 못하는 한계가 있습니다.

이 기능이 도입되면 다음과 같은 문제가 해결됩니다:

* Episodic Memory에 저장된 경험들이 자동으로 Semantic Memory로 변환되어 지식이 지속적으로 축적됨
* 기억 간 관계가 명시적으로 연결되어 검색 시 관련 기억을 더 쉽게 찾을 수 있음
* LLM이 관찰에서 구조화된 지식 그래프 트리플을 추출하여 의미 기억을 자동으로 구축함
* 수동 변환 작업 없이도 지식 그래프가 자동으로 성장함

**참고 자료**:
- [AriGraph GitHub Repository](https://github.com/AIRI-Institute/AriGraph)
- [AriGraph Paper (arXiv)](https://arxiv.org/abs/2407.04363)

## Goals

1. **자동 Triple 추출**: Episodic Memory 저장 시 LLM을 활용하여 (subject, predicate, object) 형태의 지식 그래프 트리플을 자동으로 추출
2. **Semantic Memory 자동 갱신**: 추출된 트리플을 기반으로 Semantic Memory를 자동으로 생성하거나 업데이트
3. **Episodic-Edge 생성**: Episodic Memory와 Semantic Memory 간의 관계를 명시적으로 연결
4. **수동 변환 지원**: 기존 Episodic Memory를 수동으로 Semantic Memory로 변환하는 기능 제공
5. **배치 처리**: 주기적으로 배치 작업을 실행하여 누락된 변환 작업 수행
6. **성능 최적화**: 비동기 처리, 배치 처리, 캐싱을 통해 메인 플로우 블로킹 방지 및 비용 최적화
7. **에러 처리**: Triple 추출 실패 시에도 Episodic Memory는 정상 저장되도록 보장

## User Stories

### AI 에이전트 관점

- **US-001**: AI 에이전트로서 Episodic Memory를 저장할 때 자동으로 Semantic Memory가 생성되어 지식이 축적되기를 원한다
- **US-002**: AI 에이전트로서 기존 Episodic Memory를 수동으로 Semantic Memory로 변환하고 싶다
- **US-003**: AI 에이전트로서 Triple 추출이 실패해도 Episodic Memory는 정상적으로 저장되기를 원한다
- **US-004**: AI 에이전트로서 배치 작업을 통해 누락된 변환 작업이 자동으로 수행되기를 원한다

### 개발자 관점

- **US-005**: 개발자로서 Triple 추출 결과의 품질을 모니터링하고 싶다
- **US-006**: 개발자로서 LLM 호출 비용이 예산 내에서 유지되기를 원한다
- **US-007**: 개발자로서 Triple 추출 실패 시 로그를 확인하여 문제를 진단하고 싶다
- **US-008**: 개발자로서 기존 Episodic Memory를 배치로 Semantic Memory로 변환하고 싶다

## Functional Requirements

### 1. Triple 추출 서비스

1.1. **LLM 기반 Triple Extractor 서비스 구현**
   - 입력: observation 텍스트 (Episodic Memory의 content)
   - 출력: **구체적 스키마 명시**
     ```typescript
     {
       triples: Array<{
         subject: string,
         predicate: string,
         object: string
       }>,
       extractionInfo: {
         failureReason?: string,  // "no_triple" | "ambiguous_structure" | "llm_parse_fail" | "llm_api_error"
         steps: {
           canonicalization: boolean,  // Predicate 정규화 성공 여부
           entityLinking: boolean      // Entity Linking 성공 여부
         },
         rawLLMOutput: string          // 원본 LLM 응답 (디버깅용)
       }
     }
     ```
   - 프롬프트 엔지니어링: AriGraph 논문 참고하여 최적화된 프롬프트 템플릿 작성
   - 프롬프트는 `prompts/` 디렉토리에 저장
   - **Confidence 계산**: TripleExtractionService에서는 confidence를 계산하지 않음
     * Confidence는 후처리 로직(SemanticMemoryUpdateService)에서 구조적 검증 기반으로 계산
     * extractionInfo의 steps 정보를 활용하여 confidence 계산
   - **extractionInfo 저장 위치 및 보안 정책 (명확화)**:
     * `rawLLMOutput`: 로그 파일에만 저장 (디버깅용, 보존 기간: 30일)
       - **보안 정책**: PII/비밀 정보 보호를 위한 마스킹 적용
         * **마스킹 적용 범위**: 성공 케이스 샘플링(10%) 시에도 마스킹 선행 적용, 실패 케이스 전체 저장 시에도 마스킹 선행 적용
         * 마스킹 대상: 이메일 주소, 전화번호, API 키, 비밀번호, 토큰 등 민감 정보
         * **추가 필터링**: 실패 케이스 전체 저장 시에도 credential류(API 키, 비밀번호, 토큰 등)는 마스킹 후 저장
         * 샘플링: 전체 저장 대신 실패 케이스만 저장 (성공 케이스는 샘플링, 예: 10%)
         * 저장 위치: `logs/triple-extraction/` 디렉토리 (접근 통제: 개발자 권한만)
         * 로그 로테이션: 30일 후 자동 삭제
     * `extractionInfo` (failureReason, steps): `memory_relation` 테이블의 `metadata` 필드에 JSON 형식으로 저장
       - 품질 모니터링(US-005, US-007)을 위해 메타데이터에 보존
       - 별도 audit 테이블은 생성하지 않음 (기존 `memory_relation.metadata` 활용)
       - **하나의 observation에서 여러 triple 생성 시 처리 방식**:
         * 각 triple마다 별도의 `memory_relation` 레코드 생성
         * 각 relation의 `metadata`에는 **해당 triple만의 정보** 저장:
           - `failureReason`: 해당 triple 추출 실패 시에만 저장 (성공 시 null)
           - `steps`: 해당 triple의 canonicalization, entityLinking 성공 여부
           - 전체 요청 요약은 저장하지 않음 (triple 단위로 독립적)
         * 예: observation에서 3개 triple 추출 성공 시 → 3개의 `memory_relation` 레코드 생성, 각각 독립적인 metadata

1.2. **Triple 추출 결과 검증 및 정규화**
   - 추출된 트리플의 유효성 검증 (subject, predicate, object가 모두 존재하는지)
   - 빈 값, 중복 제거
   - 정규화 (대소문자, 공백 처리 등)
   - **Predicate 정규화 (Canonicalization)**: AriGraph 논문 참고
     - 동의어/유사 표현을 표준 predicate로 변환
     - 예: "좋아한다", "선호한다", "좋아함" → "좋아함" (표준화)
     - Predicate 사전 기반 정규화 규칙 적용
   - **Subject/Object Entity Linking**: 기본 버전 구현
     - 동일한 엔티티를 참조하는 경우 통일된 표현으로 정규화
     - **구체적 구현 예시**:
       * Lowercasing + NLP normalization
       * 한글/영문 혼용 통일 (user/유저/사용자 → "사용자")
       * 숫자/날짜 등 structured entity는 변환하지 않음 (예: "2025-01-15", "123" 등은 그대로 유지)
       * 기본 규칙:
         - 영문 → 한글 우선 변환 (사전 기반)
         - 동일 의미 표현 통일 (예: "유저" → "사용자")
         - 고유명사는 변환하지 않음

1.3. **Triple 추출 실패 사유 분석 및 저장 (DB 기록 보장)**
   - 실패 카테고리 분류:
     * "no_triple": 트리플이 추출되지 않음
     * "ambiguous_structure": 구조가 모호함
     * "llm_parse_fail": LLM 응답 파싱 실패
     * "llm_api_error": LLM API 호출 실패
   - **실패 사유 DB 저장 (명확화)**:
     * 문제: `no_triple`/`llm_api_error` 등으로 아무 triple도 생성되지 않은 경우, `memory_relation` 레코드가 없어서 `failureReason`가 DB에 남지 않음
     * 해결 방안: `memory_item` 테이블에 `triple_extracted_status` 필드 추가
       ```sql
       ALTER TABLE memory_item ADD COLUMN triple_extracted_status TEXT;
       -- 값: NULL (미처리), 'success' (성공), 'failed' (실패), 'abandoned' (포기)
       -- 실패 시 failureReason도 함께 저장 (JSON 형식)
       ```
     * 저장 형식:
       - **성공**: `triple_extracted_status='success'`
         * `triple_extraction_metadata` 예시: `{"triple_count": 3, "confidence_avg": 0.85, "extracted_at": "2025-01-XX"}`
       - **실패**: `triple_extracted_status='failed'`
         * `triple_extraction_metadata` 예시: `{"failureReason": "no_triple", "retry_count": 2, "last_attempt": "2025-01-XX"}`
       - **포기**: `triple_extracted_status='abandoned'`
         * `triple_extraction_metadata` 예시: `{"failureReason": "llm_api_error", "retry_count": 3, "last_attempt": "2025-01-XX", "abandoned_at": "2025-01-XX"}`
     * 통계 집계: `triple_extracted_status`와 `triple_extraction_metadata`를 활용하여 실패 통계 메타데이터로 집계 가능
   - 각 실패 사유별 통계 수집 및 로깅

1.4. **에러 처리 및 폴백 메커니즘 (재시도 정책 명확화)**
   - LLM 호출 실패 시 로그 기록 후 계속 진행
   - Triple 추출 실패 시에도 Episodic Memory는 정상 저장
   - **재시도 정책**: 즉각 재시도 금지, 지연 재시도 허용 (한계 명시)
     * 즉각 재시도: LLM 호출 실패 시 바로 재시도하지 않음 (비용 절감)
     * 지연 재시도: 배치 작업에서 실패한 항목을 다음 배치에서 재시도
     * **최대 시도 횟수**: 3회 (설정 가능, `tripleExtractionMaxRetries`)
     * **Backoff 간격**: 지수 백오프 적용 (1일, 2일, 4일 후 재시도)
     * **종료 조건 및 상태 업데이트 규칙**:
       - **성공 시**:
         * `triple_extracted=true`로 업데이트
         * `triple_extracted_status='success'`로 업데이트
         * `triple_extraction_metadata` 초기화 또는 성공 정보로 갱신:
           - 이전 실패 기록(`failureReason`, `retry_count` 등)은 **초기화** (NULL 또는 빈 JSON)
           - 성공 정보로 갱신: `{"triple_count": 3, "confidence_avg": 0.85, "extracted_at": "2025-01-XX"}`
           - 재시도 후 성공한 경우 이전 실패 기록은 보존하지 않음 (데이터 일관성 유지)
       - **최대 시도 횟수 초과 시**:
         * `triple_extracted=false`로 유지
         * `triple_extracted_status='failed'`로 업데이트
         * `triple_extraction_metadata`에 `failureReason`, `retry_count` 저장
         * 재시도 중단
       - **포기 시**:
         * `triple_extracted=false`로 유지
         * `triple_extracted_status='abandoned'`로 업데이트
         * `triple_extraction_metadata`에 `failureReason`, `retry_count` 저장
         * 수동 재시도 가능
     * **필드 조합 규칙** (명확화):
       | triple_extracted | triple_extracted_status | 의미 |
       | ---------------- | ----------------------- | ---- |
       | NULL | NULL | 미처리 |
       | true | 'success' | 성공 |
       | false | 'failed' | 실패 (재시도 가능) |
       | false | 'abandoned' | 포기 (수동 재시도 필요) |
       | false | NULL | 미처리 또는 초기 상태 |

1.5. **비동기 처리 (MCP 서버 런타임 구조 고려)**
   - Triple 추출은 **JobQueue**를 통해 별도 작업으로 등록
   - MCP 서버는 단일 요청 기반으로 동작하므로, 장기 실행 작업은 Task Runner로 분리
   - `setImmediate`/`queueMicrotask` 기반 비동기는 서버 종료 시 깨질 수 있으므로 사용하지 않음
   - 기존 `BatchScheduler`의 `JobQueue` 활용
   - Episodic Memory 저장은 Triple 추출 완료를 기다리지 않음

### 2. Semantic Memory 갱신 로직

2.1. **Triple 기반 Semantic Memory 생성/업데이트 (구조적 저장)**
   - 추출된 각 트리플을 기반으로 Semantic Memory 항목 생성
   - **Semantic Memory는 구조적으로 저장**: `subject`, `predicate`, `object`를 각각 컬럼으로 저장
   - 자연어 문장은 optional 파생 필드로 유지 (content 필드에 저장, 검색용)
   - 예: `(subject: "사용자", predicate: "선호", object: "커피")`
     * `subject`: "사용자"
     * `predicate`: "선호" (정규화된 표준 predicate)
     * `object`: "커피"
     * `content`: "사용자는 커피를 선호합니다" (자연어 변환, 검색용)
   - **데이터베이스 스키마 확장 필요**: `memory_item` 테이블에 `subject`, `predicate`, `object` 컬럼 추가 (마이그레이션)

2.2. **기존 Semantic Memory와의 중복 판단 (Triple 요소별 비교 - 구체적 기준)**
   - **Content 유사도만으로는 부족**: 자연어 문장만 비교하면 충돌 가능성이 높음
   - **Triple 요소별 비교 기준 (구체화)**:
     * **Predicate**: Canonicalization 후 **정확히 일치**하면 동일한 것으로 처리
       - Predicate는 정규화 과정을 거쳤으므로 유사도 비교가 아닌 정확 일치가 기본
       - 예: "좋아함" == "좋아함" (정규화 후)
     * **Subject**: 문자열 정규화 후 일치 여부를 기본으로, 임베딩 유사도를 보조 기준으로 사용
       - 정규화: lowercasing, 공백 제거, 한글/영문 혼용 통일
       - 유사도 임계값: 0.9 (기본값, 설정 가능)
     * **Object**: Subject와 동일한 방식 (정규화 + 유사도)
   - **중복 판단 로직**:
     ```
     if (predicate == predicate' AND 
         (subject.normalized() == subject'.normalized() OR subject.similarity(subject') > 0.9) AND
         (object.normalized() == object'.normalized() OR object.similarity(object') > 0.9))
       → 중복으로 판단
     ```
   - **정확한 매칭 우선**: 완전히 동일한 triple (subject, predicate, object 모두 정규화 후 일치)은 즉시 중복으로 판단
   - 유사도 임계값은 설정 가능 (기본값: 0.9)
   - **중복 판단 기준 표**:
     | 요소        | 기본 기준           | 보조 기준   |
     | --------- | --------------- | ------- |
     | predicate | 정확 일치 (정규화 후)    | 없음      |
     | subject   | 문자열 정규화 후 일치 여부 | 임베딩 유사도 |
     | object    | 문자열 정규화 후 일치 여부 | 임베딩 유사도 |

2.3. **중복 방지 및 병합 전략**
   - 유사도가 임계값 이상인 경우 새로운 항목을 생성하지 않고 기존 항목 업데이트
   - 기존 항목의 중요도, 태그 등을 업데이트
   - **Episode Weight 누적**: 동일 triple이 여러 Episodic Memory에서 추출된 경우 가중치 증가
   - 완전히 동일한 Semantic Memory는 생성하지 않음

2.4. **신뢰도 기반 필터링 (구조적 검증 방식)**
   - **LLM 응답에서 confidence 추출은 신뢰할 수 없음**: 대부분의 LLM은 신뢰할 수 있는 confidence를 제공하지 않음
   - **구조적 검증 기반 confidence 계산** (AriGraph 방식):
     * Triple 구조의 완전성 검증 (subject, predicate, object 모두 존재)
     * Predicate 정규화 성공 여부
     * Entity linking 성공 여부
     * 각 검증 단계별 점수 부여하여 최종 confidence 계산
   - **대안: Redundant Prompting** (선택사항):
     * 동일한 observation을 두 번 추출하여 일치율을 confidence로 사용
     * 비용이 높으므로 선택적 사용
   - **대안: Predicate 사전 기반 Rule Confidence**:
     * 표준 predicate 사전에 있는 경우 높은 confidence 부여
   - 신뢰도가 일정 수준 이상인 경우만 Semantic Memory 생성 (기본 임계값: 0.7)
   - **Confidence 저장 위치 및 연계 방식 (명확화)**:
     * **주 저장 위치**: `memory_relation` 테이블의 `confidence` 필드
       - Episodic Memory와 Semantic Memory 간 관계의 신뢰도로 저장
       - 검색/가중치 계산 시: `memory_relation.confidence` 참조
     * **보조 저장 위치 (선택사항)**: `memory_item` 테이블에 `quality_score` 필드 추가 고려
       - 현재는 저장하지 않음 (relation-only 방식)
       - 향후 Semantic Memory 자체의 품질 점수가 필요한 경우 확장 가능
     * **검색 랭킹 시 참조**: 
       - Relation Engine의 검색 랭킹 공식에 `memory_relation.confidence` 가중치 반영
       - Semantic Memory 검색 시 관계가 있는 Episodic Memory의 confidence를 가중치로 활용

2.5. **Semantic Memory 중요도 계산**
   - Triple이 추출된 Episodic Memory의 중요도 반영
   - 여러 Episodic Memory에서 동일한 Semantic Memory가 추출된 경우 중요도 증가
   - **중요도 Decay**: 시간이 지나면서 중요도가 감쇠하는지 여부 결정 (초기에는 decay 없음)
   - 중요도는 0.0~1.0 범위로 정규화

### 3. Episodic-Edge 생성

3.1. **Episodic Memory와 Semantic Memory 간 관계 생성**
   - Triple 추출이 성공한 경우, 해당 Episodic Memory와 생성된 Semantic Memory 간의 관계 생성
   - 관계는 `memory_link` 또는 `memory_relation` 테이블에 저장
   - `memory_relation` 테이블 우선 사용 (신뢰도 정보 저장 가능)

3.2. **관계 타입 정의 (방향 명확화)**
   - **`extracted_from`**: Semantic Memory가 Episodic Memory에서 추출됨
     * 방향: Episodic → Semantic (source: Episodic, target: Semantic)
     * 의미: Semantic은 Episodic에서 추출됨
   - **`supported_by`**: Semantic Memory가 이 Episodic Memory에 의해 근거를 가짐
     * 방향: Semantic → Episodic (source: Semantic, target: Episodic)
     * 의미: Semantic은 이 Episodic에 의해 근거를 가짐 (역방향 관계)
   - 관계 타입은 `relation_type_registry` 테이블에 등록
   - **관계 방향 명확화 표**:
     | From     | To       | Relation Type  | 의미                              |
     | -------- | -------- | -------------- | ------------------------------- |
     | Episodic | Semantic | extracted_from | Semantic은 Episodic에서 추출됨        |
     | Semantic | Episodic | supported_by   | Semantic은 이 Episodic에 의해 근거를 가짐 |

3.3. **관계 메타데이터 저장**
   - 추출 방법: 'llm' (LLM 기반 추출)
   - 신뢰도: Triple 추출 시 계산된 confidence 값
   - 추출된 트리플 정보: JSON 형식으로 metadata에 저장

3.4. **관계 중복 방지**
   - 동일한 Episodic Memory와 Semantic Memory 간의 동일한 관계 타입은 중복 생성하지 않음
   - `UNIQUE(source_id, target_id, relation_type)` 제약 조건 활용

### 4. 자동 처리 통합

4.1. **`remember` Tool에 파이프라인 통합**
   - `remember` Tool에서 `type='episodic'`인 경우 자동으로 Triple 추출 파이프라인 실행
   - 파이프라인은 비동기로 실행되어 메인 응답을 블로킹하지 않음
   - 파이프라인 실행 여부는 옵션으로 제어 가능 (기본값: true)

4.2. **옵션 파라미터 추가**
   - `remember` Tool에 `enable_triple_extraction` 파라미터 추가 (기본값: true)
   - `enable_triple_extraction=false`인 경우 Triple 추출 건너뛰기

### 5. 수동 변환 기능

5.1. **기존 Episodic Memory 변환**
   - MCP Tool `convert_episodic_to_semantic` 구현
   - 입력: Episodic Memory ID 또는 필터 조건
   - 처리: 선택된 Episodic Memory에 대해 Triple 추출 및 Semantic Memory 생성
   - 배치 처리 지원 (여러 Episodic Memory를 한 번에 변환)

5.2. **변환 상태 추적**
   - Episodic Memory에 `triple_extracted`, `triple_extracted_status`, `triple_extraction_metadata` 필드 활용
   - 이미 변환된 Episodic Memory는 건너뛰기 옵션 제공
   - 실패한 항목(`triple_extracted_status='failed'`)은 재시도 옵션 제공

### 6. 배치 작업

6.1. **주기적 배치 실행 (MCP 서버 런타임 구조 고려)**
   - 기존 `BatchScheduler`에 Triple 추출 배치 작업 추가
   - **배치 실행 환경**: MCP 서버 내부에서 `BatchScheduler`를 통해 실행
   - 주기: 매일 새벽 2시 (설정 가능, `tripleExtractionInterval`, `tripleExtractionHour` 설정)
   - 대상: `triple_extracted=false` 또는 null인 Episodic Memory
     * `triple_extracted_status='failed'`인 경우 재시도 (최대 시도 횟수 확인)
     * `triple_extracted_status='abandoned'`인 경우 제외 (수동 재시도 필요)
   - **SQLite WAL 환경 고려**: 동시 write가 제한되므로 배치 write 시 lock 이슈 방지
     * 배치 작업은 단일 트랜잭션으로 처리하지 않고, 작은 단위로 나누어 처리
     * WAL 모드에서도 안정적으로 동작하도록 구현

6.2. **배치 처리 최적화 (병렬성 제어 기준)**
   - 여러 Episodic Memory를 배치로 처리하여 LLM 호출 최적화
   - 배치 크기: 10개씩 처리 (설정 가능, `tripleExtractionBatchSize`)
   - 타임아웃: 배치당 최대 30초 (설정 가능, `tripleExtractionTimeout`)
   - **병렬성 제어 기준 (구체화)**:
     * Triple Extraction Job은 기본적으로 **싱글톤 배치 작업**으로 실행
     * **Parallelism = 1**이 기본값 (동시에 하나의 배치만 실행)
     * Memento의 SQLite 구조와 잘 맞도록 설계
     * 향후 고성능 환경에서는 parallelism 설정 가능 (선택사항)
   - **기존 배치 작업과 충돌 방지**: 
     * `BatchScheduler`의 `maxConcurrentJobs` 설정 고려
     * Triple 추출 배치 작업은 다른 배치 작업과 동시 실행되지 않도록 스케줄링
     * Triple Extraction Job은 독립적인 작업 큐로 관리

6.3. **배치 작업 로깅**
   - 처리된 Episodic Memory 수
   - 생성된 Semantic Memory 수
   - 실패한 항목 수 및 에러 로그
   - 배치 실행 시간 및 성능 메트릭

### 7. 성능 최적화

7.1. **비동기 처리**
   - Triple 추출은 비동기로 처리하여 메인 플로우 블로킹 방지
   - `remember` Tool 응답은 Triple 추출 완료를 기다리지 않음

7.2. **배치 처리**
   - 여러 Triple 추출 요청을 배치로 묶어 LLM 호출 최적화
   - 배치 크기: 10개씩 처리 (설정 가능, `tripleExtractionBatchSize` - 6.2와 동일)
   - 참고: 배치 작업(6.2)과 동일한 배치 크기 사용

7.3. **캐싱 (TTL 조정 및 설정 가능)**
   - 동일한 content에 대한 Triple 추출 결과 캐싱
   - 캐시 키: content의 해시값
   - **캐싱 TTL**: 6시간 (기본값, 설정 가능)
     * LLM Triple extraction은 deterministic하지 않은 경우가 많음
     * TTL이 너무 길면 새 Semantic이 반영되지 않음
     * TTL이 너무 짧으면 비용 최적화 효과가 약함
     * **대안**: `content_hash` 변경 시 캐싱 무효화 (더 정확하지만 구현 복잡도 증가)
   - 캐시 크기: 100개 항목 (설정 가능)
   - LRU 캐시 활용

7.4. **비용 최적화**
   - LLM 호출 횟수 모니터링
   - 배치 처리로 호출 횟수 최소화
   - 캐싱으로 중복 호출 방지

### 8. 모니터링 및 로깅

8.1. **Triple 추출 통계**
   - 성공률: 성공한 Triple 추출 수 / 전체 시도 수
   - 평균 추출 시간
   - LLM 호출 횟수 및 비용

8.2. **Semantic Memory 생성 통계**
   - 생성된 Semantic Memory 수
   - 업데이트된 Semantic Memory 수
   - 중복 제거된 항목 수

8.3. **에러 로깅**
   - Triple 추출 실패 시 상세 에러 로그 기록
   - LLM 응답 파싱 실패 로그
   - Semantic Memory 생성 실패 로그

## Non-Goals (Out of Scope)

1. **수동 검증 UI**: Triple 추출 결과를 수동으로 검증하고 수정하는 UI는 포함하지 않음
2. **Semantic Memory 자동 삭제/정리**: 생성된 Semantic Memory의 자동 삭제 또는 정리 기능은 포함하지 않음
3. **다른 메모리 타입 통합**: working, procedural 메모리 타입과의 통합은 이번 단계에서 제외
4. **Triple 추출 즉각 재시도**: LLM 호출 실패 시 즉각 재시도 메커니즘은 포함하지 않음 (비용 절감)
   - 참고: 지연 재시도(배치 작업에서 다음 배치에 재시도)는 허용됨 (1.4, Failure Modes 참조)
5. **관계 그래프 시각화**: Episodic-Edge 관계를 시각화하는 기능은 별도 이슈로 분리

## Design Considerations

### 데이터 모델

1. **Episodic Memory 확장 (필수)**
   - `triple_extracted` BOOLEAN 필드 추가 (마이그레이션 필요)
     - 기본값: NULL (미처리 상태)
     - TRUE: Triple 추출 성공
     - FALSE: Triple 추출 실패 또는 미처리
   - `triple_extracted_status` TEXT 필드 추가 (마이그레이션 필요)
     - 기본값: NULL (미처리 상태)
     - 값: 'success' (성공), 'failed' (실패), 'abandoned' (포기)
     - 실패 통계 집계를 위해 필수
   - `triple_extraction_metadata` TEXT 필드 추가 (마이그레이션 필요, JSON 형식)
     - 기본값: NULL
     - **성공 시 예시**: `{"triple_count": 3, "confidence_avg": 0.85, "extracted_at": "2025-01-XX"}`
     - **실패 시 예시**: `{"failureReason": "no_triple", "retry_count": 2, "last_attempt": "2025-01-XX"}`
     - **포기 시 예시**: `{"failureReason": "llm_api_error", "retry_count": 3, "last_attempt": "2025-01-XX", "abandoned_at": "2025-01-XX"}`
     - **재시도 후 성공 시**: 이전 실패 기록(`failureReason`, `retry_count` 등)은 초기화하고 성공 정보로 갱신
     - **참고**: 성공 정보와 실패 정보는 공존하지 않음 (상태에 따라 하나만 저장)
   - **필드 조합 규칙** (명확화):
     | triple_extracted | triple_extracted_status | 의미 |
     | ---------------- | ----------------------- | ---- |
     | NULL | NULL | 미처리 |
     | true | 'success' | 성공 |
     | false | 'failed' | 실패 (재시도 가능) |
     | false | 'abandoned' | 포기 (수동 재시도 필요) |
     | false | NULL | 미처리 또는 초기 상태 |
   - 인덱스 추가:
     ```sql
     CREATE INDEX idx_memory_item_triple_extracted ON memory_item(triple_extracted);
     CREATE INDEX idx_memory_item_triple_status ON memory_item(triple_extracted_status);
     ```

2. **Semantic Memory 생성 (구조적 저장)**
   - 기존 `memory_item` 테이블 활용 (type='semantic')
   - **스키마 확장 필요**: `subject`, `predicate`, `object` 컬럼 추가
     ```sql
     ALTER TABLE memory_item ADD COLUMN subject TEXT;
     ALTER TABLE memory_item ADD COLUMN predicate TEXT;
     ALTER TABLE memory_item ADD COLUMN object TEXT;
     ```
   - **타입별 기본값 및 NULL 허용 정책**:
     * `subject`, `predicate`, `object`: NULL 허용 (기본값: NULL)
     * 타입별 영향:
       - `type='semantic'`: Triple 기반 생성 시 필수 (NOT NULL 제약 없음, 애플리케이션 레벨 검증)
       - `type='episodic'`, `type='procedural'`, `type='working'`: NULL (Triple 추출 대상 아님)
     * 기존 데이터 영향: 기존 episodic/procedural/working 메모리는 NULL로 유지 (영향 없음)
   - **인덱스 생성 (Partial Index)**:
     ```sql
     CREATE INDEX idx_memory_item_triple ON memory_item(subject, predicate, object) 
     WHERE type='semantic' AND subject IS NOT NULL AND predicate IS NOT NULL AND object IS NOT NULL;
     ```
     * Partial Index로 `type='semantic'`이고 triple이 있는 경우만 인덱싱
     * 기존 episodic/procedural/working 데이터는 인덱스에 포함되지 않음 (성능 최적화)
   - `content`는 트리플을 자연어로 변환한 형태 (검색용, optional)
   - **Predicate 관리 방식 (향후 확장 고려)**:
     * 현재: `predicate`는 TEXT로 저장
     * **향후 스케일업 대비 옵션**: `predicate_registry` 테이블 고려
       - Relation Engine과 결합 시 정규화된 predicate를 ENUM-like하게 유지하는 것이 유리할 수 있음
       - 선택적 구현: `predicate_registry` 테이블 (id, name, synonyms)
       - 초기 버전에서는 TEXT로 저장하되, 향후 마이그레이션 경로 고려

3. **관계 저장**
   - `memory_relation` 테이블 우선 사용 (신뢰도 정보 저장 가능)
   - `memory_link` 테이블은 폴백으로 사용 (하위 호환성)

### LLM 통합

1. **프롬프트 템플릿**
   - `prompts/triple-extraction.txt` 파일 생성
   - AriGraph 논문 참고하여 최적화된 프롬프트 작성
   - 프롬프트는 설정 가능하도록 구현

2. **LLM 호출**
   - 기존 임베딩 서비스와 유사한 방식으로 LLM 호출
   - OpenAI API 또는 다른 LLM API 활용
   - 응답 파싱: JSON 형식으로 응답 받기

3. **에러 처리**
   - LLM 호출 실패 시 로그만 기록하고 계속 진행
   - 응답 파싱 실패 시에도 Episodic Memory는 정상 저장

## Technical Considerations

### 의존성

1. **기존 서비스 활용**
   - `MemoryItemService`: Semantic Memory 저장
   - `RelationGraphService`: 관계 생성 및 관리
   - `EmbeddingService`: 유사도 검사
   - `BatchScheduler`: 배치 작업 스케줄링

2. **새로운 서비스**
   - `TripleExtractionService`: Triple 추출 로직
   - `SemanticMemoryUpdateService`: Semantic Memory 갱신 로직

### 성능 고려사항

1. **비동기 처리 (MCP 서버 런타임 구조 고려)**
   - Triple 추출은 **JobQueue**를 통해 별도 작업으로 등록
   - `setImmediate`/`queueMicrotask` 기반 비동기는 서버 종료 시 깨질 수 있으므로 사용하지 않음
   - 기존 `BatchScheduler`의 `JobQueue` 활용
   - Promise 기반 비동기 처리

2. **배치 처리**
   - 여러 Triple 추출 요청을 큐에 모아 배치로 처리
   - 배치 크기 및 타임아웃 설정 가능
   - SQLite WAL 환경에서 동시 write 제한 고려

3. **캐싱**
   - LRU 캐시 활용
   - 캐시 크기: 100개 항목 (설정 가능)
   - TTL: 6시간 (설정 가능)

### 데이터베이스

1. **트랜잭션**
   - Semantic Memory 생성 및 관계 생성은 트랜잭션으로 처리
   - 실패 시 롤백

2. **인덱스**
   - `memory_relation` 테이블의 인덱스 활용
   - `triple_extracted` 필드 인덱스 추가
   - `triple_extracted_status` 필드 인덱스 추가

## Success Metrics

1. **Triple 추출 성공률**: 80% 이상
   - 성공한 Triple 추출 수 / 전체 시도 수
   - 측정 주기: 일일

2. **Semantic Memory 생성 품질**: 평균 신뢰도 0.7 이상
   - 생성된 Semantic Memory의 평균 confidence 점수
   - 측정 주기: 주간

3. **LLM 호출 비용**: 예산 내 유지
   - 일일 LLM 호출 횟수 및 비용 모니터링
   - 배치 처리 및 캐싱으로 비용 최적화

4. **성능 지표**: 메인 플로우 블로킹 없음
   - `remember` Tool 응답 시간: 500ms 이하 (Triple 추출 제외)
   - Triple 추출은 비동기로 처리되어 응답 시간에 영향 없음

5. **에러율**: 5% 이하
   - Triple 추출 실패율
   - Semantic Memory 생성 실패율

6. **Semantic Memory 중복 방지율**: 90% 이상
   - 중복으로 판단된 Triple 수 / 전체 추출된 Triple 수
   - 측정 주기: 주간
   - 목표: 중복 Semantic Memory 생성을 최소화

7. **Semantic Memory 병합 비율**: 10% 이상
   - 병합된 Semantic Memory 수 / 중복으로 판단된 Triple 수
   - 측정 주기: 주간
   - 목표: 중복 판단 시 새로운 항목 생성 대신 기존 항목 병합

8. **Episodic → Semantic 변환 커버리지**: 70% 이상
   - Triple 추출 성공한 Episodic Memory 수 / 전체 Episodic Memory 수
   - 측정 주기: 주간
   - 목표: 대부분의 Episodic Memory에서 Semantic Memory로 변환

## Open Questions

1. **LLM 선택**: OpenAI API를 사용할지, 다른 LLM API를 사용할지 결정 필요
2. **프롬프트 최적화**: AriGraph 논문의 프롬프트를 그대로 사용할지, Memento에 맞게 수정할지 결정 필요
3. **신뢰도 임계값**: Semantic Memory 생성 시 신뢰도 임계값의 최적값 결정 필요 (초기값: 0.7)
4. **유사도 임계값**: Triple 요소별 유사도 임계값 최적값 결정 필요 (초기값: 0.9)
5. **배치 주기**: 배치 작업의 최적 주기 결정 필요 (초기값: 매일 새벽 2시)
6. **캐싱 전략**: 캐시 크기 및 TTL의 최적값 결정 필요 (초기값: 6시간)
   - content_hash 변경 감지 기반 무효화 구현 여부 결정
7. **마이그레이션**: 기존 Episodic Memory에 `triple_extracted` 필드를 추가할지 결정 필요
8. **Predicate 사전**: 표준 predicate 사전 구축 방법 및 관리 전략 결정 필요
9. **Entity Linking**: Subject/Object Entity Linking의 기본 버전 구현 범위 결정 필요
10. **중요도 Decay**: Semantic Memory 중요도의 시간 기반 감쇠 여부 결정 필요 (초기에는 decay 없음)
11. **Redundant Prompting**: 비용 대비 효과를 고려하여 선택적 사용 여부 결정 필요

## Implementation Phases

### Phase 1: Triple 추출 서비스 구현 (MVP)
- [ ] TripleExtractionService 구현
- [ ] LLM 프롬프트 템플릿 작성
- [ ] Triple 추출 결과 검증 및 정규화
- [ ] **Predicate 정규화 (Canonicalization) 구현**
  - Predicate 사전 구축
  - 동의어/유사 표현 표준화 로직
- [ ] **Subject/Object Entity Linking 기본 버전 구현**
- [ ] **Triple 추출 실패 사유 분석 카테고리 구현**
- [ ] 에러 처리 및 로깅
- [ ] 단위 테스트 작성

### Phase 2: Semantic Memory 갱신 로직
- [ ] **데이터베이스 스키마 확장 (마이그레이션)**
  - `memory_item` 테이블에 `subject`, `predicate`, `object` 컬럼 추가
  - `memory_item` 테이블에 `triple_extracted_status`, `triple_extraction_metadata` 컬럼 추가
  - 인덱스 생성
- [ ] SemanticMemoryUpdateService 구현
- [ ] **Triple 요소별 중복 판단 로직 구현**
  - Subject, Predicate, Object 각각의 유사도 계산
  - 요소별 비교 및 중복 판단
- [ ] 중복 방지 및 병합 전략
  - Episode Weight 누적 로직
- [ ] **구조적 검증 기반 Confidence 계산 구현**
  - Triple 구조 완전성 검증
  - Predicate 정규화 성공 여부 검증
  - Entity linking 성공 여부 검증
- [ ] Semantic Memory 중요도 계산
- [ ] 단위 테스트 작성

### Phase 3: Episodic-Edge 생성
- [ ] 관계 생성 로직 구현
  - `extracted_from` (Episodic → Semantic) 관계 생성
  - `supported_by` (Semantic → Episodic) 관계 생성
- [ ] 관계 타입 등록 (`relation_type_registry` 테이블)
- [ ] 관계 메타데이터 저장
- [ ] 관계 방향 검증 로직
- [ ] 단위 테스트 작성

### Phase 4: 자동 처리 통합
- [ ] `remember` Tool에 파이프라인 통합
- [ ] 옵션 파라미터 추가 (`enable_triple_extraction`)
- [ ] **JobQueue 기반 비동기 처리 구현**
  - `BatchScheduler`의 `JobQueue` 활용
  - Task Runner로 분리
- [ ] 통합 테스트 작성

### Phase 5: 수동 변환 기능
- [ ] `convert_episodic_to_semantic` Tool 구현
- [ ] 배치 처리 지원
- [ ] 변환 상태 추적
- [ ] 통합 테스트 작성

### Phase 6: 배치 작업
- [ ] **BatchScheduler에 Triple 추출 배치 작업 추가**
  - `tripleExtractionInterval`, `tripleExtractionHour` 설정
  - `tripleExtractionBatchSize`, `tripleExtractionTimeout` 설정
- [ ] **SQLite WAL 환경 고려한 배치 처리 구현**
  - 작은 단위로 나누어 처리
  - Lock 충돌 방지
- [ ] 배치 처리 최적화
- [ ] 배치 작업 로깅
- [ ] 기존 배치 작업과의 충돌 방지 (스케줄링)
- [ ] 통합 테스트 작성

### Phase 7: 성능 최적화 및 모니터링
- [ ] **캐싱 구현 (TTL: 6시간, 설정 가능)**
  - LRU 캐시
  - content_hash 기반 캐시 키
  - TTL 기반 자동 무효화
- [ ] 배치 처리 최적화
- [ ] 모니터링 및 통계 수집
  - Triple 추출 성공률
  - Semantic Memory 생성 통계
  - 실패 사유별 통계
- [ ] 성능 테스트 작성
- [ ] **Relation Engine v1.0 통합 테스트**

## Decision Log (ADR - Architecture Decision Records)

### ADR-001: Semantic Memory 구조적 저장 방식 선택
**상태**: 승인  
**날짜**: 2025-01-XX  
**결정**: Semantic Memory를 자연어 문장이 아닌 구조적(subject, predicate, object) 형태로 저장  
**이유**: 
- 자연어 문장은 중복·파싱·정규화 비용이 높음
- 구조적 저장 시 Relation Engine과의 통합성이 크게 향상됨
- Triple 요소별 비교가 가능하여 중복 판단 정확도 향상

### ADR-002: Triple Confidence 계산 방식 선택
**상태**: 승인  
**날짜**: 2025-01-XX  
**결정**: LLM 응답에서 confidence 추출 대신 구조적 검증 기반 confidence 계산  
**이유**: 
- 대부분의 LLM은 신뢰할 수 있는 confidence를 제공하지 않음
- AriGraph 논문에서도 구조적 검증 방식을 사용
- Redundant prompting은 비용이 높아 선택적 사용

### ADR-005: Triple Similarity 계산 기준 구체화
**상태**: 승인  
**날짜**: 2025-01-XX  
**결정**: Predicate는 정확 일치, Subject/Object는 정규화 + 유사도 병행  
**이유**: 
- Predicate는 canonicalization 후 정확히 일치해야 중복 판단 정확도가 높아짐
- Subject/Object는 고유명사일 가능성이 높아 정규화와 유사도를 모두 고려해야 함
- False positive 감소 및 중복 판단 정확도 향상

### ADR-006: TripleExtractionService 출력 스키마 명확화
**상태**: 승인  
**날짜**: 2025-01-XX  
**결정**: triples + extractionInfo 형태로 구조화된 출력  
**이유**: 
- 후속 처리에 더 유연함
- Confidence 계산을 후처리 로직에서 수행하여 책임 분리
- 디버깅 및 모니터링 용이

### ADR-007: 배치 처리 병렬성 제어
**상태**: 승인  
**날짜**: 2025-01-XX  
**결정**: Triple Extraction Job은 싱글톤 배치 작업 (parallelism = 1)  
**이유**: 
- Memento의 SQLite 구조와 잘 맞음
- Lock 충돌 방지
- 향후 고성능 환경에서는 설정 가능하도록 확장성 고려

### ADR-003: 비동기 처리 방식 선택
**상태**: 승인  
**날짜**: 2025-01-XX  
**결정**: `setImmediate`/`queueMicrotask` 대신 JobQueue 기반 Task Runner 사용  
**이유**: 
- MCP 서버는 단일 요청 기반으로 동작
- 서버 종료 시 `setImmediate`/`queueMicrotask` 기반 비동기는 깨질 수 있음
- 기존 `BatchScheduler`의 `JobQueue` 활용으로 일관성 유지

### ADR-004: 관계 방향 명확화
**상태**: 승인  
**날짜**: 2025-01-XX  
**결정**: `extracted_from` (Episodic → Semantic), `supported_by` (Semantic → Episodic) 사용  
**이유**: 
- Relation Graph Engine에서 연쇄 탐색이 쉬워짐
- 방향이 명확하여 혼동 방지

## Failure Modes & Resilience

### 실패 모드 및 복구 전략

1. **LLM API 호출 실패**
   - **실패 모드**: 네트워크 오류, API 키 만료, Rate Limit 초과
   - **복구 전략**: 
     * 로그 기록 후 계속 진행 (Episodic Memory는 정상 저장)
     * **즉각 재시도하지 않음** (비용 절감)
     * **지연 재시도**: 배치 작업에서 실패한 항목은 다음 배치에서 재시도
     * `triple_extracted=false`로 유지하여 다음 배치에서 처리

2. **Triple 추출 파싱 실패**
   - **실패 모드**: LLM 응답이 JSON 형식이 아니거나 구조가 잘못됨
   - **복구 전략**: 
     * 실패 사유 분석 및 로깅 (`extractionInfo.failureReason`에 기록)
     * Episodic Memory는 정상 저장
     * **지연 재시도**: 배치 작업에서 실패한 항목은 다음 배치에서 재시도
     * `triple_extracted=false`로 유지하여 다음 배치에서 처리

3. **Semantic Memory 생성 실패**
   - **실패 모드**: 데이터베이스 트랜잭션 실패, 제약 조건 위반
   - **복구 전략**: 
     * 트랜잭션 롤백
     * 에러 로그 기록
     * Episodic Memory는 정상 저장 (이미 저장됨)

4. **배치 작업 타임아웃**
   - **실패 모드**: 배치 작업이 타임아웃 시간 내에 완료되지 않음
   - **복구 전략**: 
     * 진행 중인 작업은 완료까지 대기
     * 다음 배치에서 미처리 항목 재시도
     * 타임아웃 임계값 조정 가능

5. **캐시 무효화 실패**
   - **실패 모드**: 캐시가 무효화되지 않아 오래된 결과 사용
   - **복구 전략**: 
     * TTL 기반 자동 무효화
     * content_hash 변경 감지 시 수동 무효화
     * 캐시 크기 제한으로 메모리 사용량 제어

6. **SQLite WAL Lock 충돌**
   - **실패 모드**: 배치 작업 중 동시 write로 인한 lock 충돌
   - **복구 전략**: 
     * 배치 작업을 작은 단위로 나누어 처리
     * 트랜잭션 크기 제한
     * Retry with exponential backoff

## Integration with Relation Engine v1.0

### PRD #0007 (Semantic Relation Engine)와의 통합

1. **관계 타입 통합**
   - AriGraph 파이프라인에서 생성한 `extracted_from`, `supported_by` 관계는 Relation Engine의 관계 유형 시스템에 통합
   - `relation_type_registry` 테이블에 등록
   - Relation Engine의 관계 추론 로직과 함께 사용 가능

2. **신뢰도 통합**
   - Triple 추출 시 계산된 confidence는 `memory_relation` 테이블의 `confidence` 필드에 저장
   - Relation Engine의 신뢰도 기반 필터링과 일관성 유지

3. **관계 그래프 탐색**
   - Relation Engine의 hop 탐색 기능 활용
   - Episodic Memory → Semantic Memory → 다른 Episodic Memory로의 연쇄 탐색 가능

4. **관계 품질 검증**
   - Relation Engine의 관계 품질 검증 시스템 활용
   - Triple 추출로 생성된 관계의 정확도 측정

5. **충돌 방지**
   - Relation Engine이 자동으로 추출한 관계와 AriGraph 파이프라인이 생성한 관계 간 중복 방지
   - 동일한 source_id, target_id, relation_type 조합은 중복 생성하지 않음

## Related Issues/PRs

- Issue #61: AriGraph Pipeline (Episodic → Semantic 자동 학습) 구현
- PRD #0007: Semantic Relation Engine (관계 추론 엔진)
- PRD #0012: Recall Auto Anchor Neighbors (앵커 시스템 통합)

