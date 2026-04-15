# Research: Environment Config Cleanup

## Decision 1: `env.example`를 루트 설정의 기준 템플릿으로 유지

- **Decision**: 루트 `env.example`를 저장소 공통 환경변수의 단일 기준 템플릿으로 유지한다.
- **Rationale**: 신규 기여자 온보딩 경로가 단순하고 기존 레포 관례와 일치한다.
- **Alternatives considered**:
  - 여러 템플릿 파일로 분산 관리: 범위 구분은 쉬우나 누락/충돌 가능성이 커짐.
  - 자동 생성형 템플릿: 정확성은 높지만 유지 복잡도가 높음.

## Decision 2: 에이전트 전용 템플릿은 역할이 드러나는 이름으로 정리

- **Decision**: `services/agent/.env`가 템플릿 역할이라면 `.env.example`로 정리하고 설명 주석을 일치시킨다.
- **Rationale**: 실제 사용 파일과 예시 파일의 구분이 명확해져 운영 실수를 줄인다.
- **Alternatives considered**:
  - 현재 파일명 유지: 즉시 변경 비용은 낮지만 지속적 혼선을 초래함.

## Decision 3: 중복 변수는 단일 출처 정책으로 문서화

- **Decision**: `MEMENTO_AGENT_*`와 `AGENT_*`처럼 의미가 겹치는 항목은 우선순위와 기준 출처를 명시한다.
- **Rationale**: 배포/로컬 간 값 불일치 재현 문제를 줄이고 디버깅 비용을 낮춘다.
- **Alternatives considered**:
  - 모든 변수 유지: 하위 호환은 좋지만 이해/관리 비용이 큼.
  - 즉시 일괄 제거: 전환 리스크가 높음.

## Decision 4: 보안 중요 변수는 필수 표시와 위험 경고를 함께 제공

- **Decision**: `ADMIN_API_KEY` 등 보안 변수에는 `[REQUIRED in production]` 표기, 위험 옵션에는 경고 주석을 추가한다.
- **Rationale**: 설정 누락을 사전에 방지하고 취약한 구성 배포 위험을 줄인다.
- **Alternatives considered**:
  - 별도 문서로만 안내: 템플릿 단독 사용 시 누락 가능성이 높음.
