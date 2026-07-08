# 임베딩 제공자 이슈 체크리스트

Memento는 MiniLM·OpenAI·Gemini·TF-IDF 등 여러 임베딩 백엔드를 선택할 수 있습니다. 제공자마다 벡터 차원, 가용성 조건, Docker 기본값이 달라서 **모델을 바꿀 때**는 코드만이 아니라 Compose·`.env`·DB 스키마를 함께 점검해야 합니다. 아래 항목은 운영 중 자주 막히는 지점을 순서대로 정리한 것입니다.

## 임베딩 제공자 전환 시 확인해야 할 문제점

### 1. Docker 환경 변수 기본값
- `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml`에서 `EMBEDDING_PROVIDER` 기본값이 오랫동안 `lightweight`(`tfidf`)로 설정되어 있었다.  
- `.env`에서 값을 비워 두어도 Compose 기본값 때문에 컨테이너 내부에서는 항상 `lightweight`로 재설정되었다.  
- 이로 인해 `UnifiedEmbeddingService`의 provider priority를 조정해도 설정 단계에서 이미 경량 모델이 선택되어 우선순위가 반영되지 않았다.  
- 해결: Compose 환경 변수 기본값을 `minilm`(또는 원하는 모델)로 변경하고, `.env`와 일치하도록 관리한다.

### 2. 모델 가용성 및 폴백 동작
- `UnifiedEmbeddingService`는 우선순위보다 **사용 가능 여부(`isAvailable()`)**를 먼저 확인한다.  
  - OpenAI/Gemini는 API 키가 없으면 `available=false`.  
  - MiniLM은 모델이 로컬 캐시에 없고 네트워크가 막혀 있으면 로딩 실패 후 `fallback`으로 내려간다.  
  - 최종적으로 사용 가능한 제공자가 `tfidf`뿐이면 어떤 우선순위/기본값을 써도 `lightweight`가 선택된다.  
- 해결:  
  - MiniLM을 사용하려면 모델을 미리 다운로드해 캐시에 저장(빌드 단계 프리페치 등)  
  - 유료 모델(OpenAI/Gemini)을 쓰려면 API 키를 제공해 `isAvailable()`을 만족시킨다.

### 3. SQLite VEC 테이블 차원 고정 문제
- `memory_item_vec` 가상 테이블은 최초 생성 시 차원이 고정(예: OpenAI 사용 시 1536).  
- MiniLM(384차원)으로 전환해도 기존 테이블은 1536을 기대하므로 “Dimension mismatch” 오류가 발생한다.  
- 제공자별 테이블(`memory_item_vec_minilm`, `memory_item_vec_openai` 등)은 각각 다른 차원을 가질 수 있지만, 공용 테이블 `memory_item_vec`이 병목이다.
- 대응 방안:
  1. 데이터베이스 초기화(`data/` 삭제 또는 마이그레이션)로 공용 테이블을 새 차원에 맞춰 다시 생성.
  2. 공용 테이블을 가장 큰 차원(1536)으로 유지하고, 더 작은 모델 벡터는 0으로 패딩하여 저장.
  3. 공용 테이블을 제거하고 제공자별 테이블만 사용하도록 검색 로직을 조정.

### 4. 마이그레이션/운영 시 고려 사항
- 임베딩 모델 변경 시에는 다음을 필수로 점검해야 한다.
  1. Compose 및 `.env`의 기본값/환경 변수가 새 모델을 가리키는지 확인.  
  2. 새 모델이 배포 환경에서 `isAvailable()`을 만족하도록 필요한 자격(모델 캐시, API 키 등)을 준비.  
  3. `memory_item_vec` 관련 테이블, 트리거가 새 차원과 일치하는지 확인하고 필요 시 재생성.  
  4. 기존 임베딩 데이터의 재생성 여부와 비용을 판단(차원 변경 시 재생성 필요).

### 5. 향후 정비가 필요한 영역
- 공용 VEC 테이블 구조 유지 여부 결정 및 자동화된 마이그레이션 스크립트 준비.  
- Docker 빌드 과정에서 MiniLM 모델 프리페치를 안정적으로 처리하기 위한 네트워크 정책 검토.  
- `UnifiedEmbeddingService`가 로컬/컨테이너 환경에서 어떤 제공자를 선택했는지 쉽게 확인할 수 있는 로깅/모니터링 체계 마련.
