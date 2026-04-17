# Docker Compose Diagnostics Stack Design

## 배경
이슈 159 대응으로 앱 내부 진단 로깅과 호스트 측 Docker 관측 스크립트는 이미 추가되어 있다. 다만 현재 재현 절차는 사용자가 앱을 띄운 뒤 별도 터미널에서 `scripts/collect-docker-diagnostics.sh`를 수동 실행해야 한다. 이 방식은 재현 성공률이 낮고, 실제 장애 시점 직전의 Docker 엔진 관측 데이터가 빠질 수 있다.

이번 설계의 목표는 `docker compose` 한 번으로 앱과 Docker 외부 진단 수집기를 함께 띄울 수 있게 해, Desktop/daemon 장애 직전 증거를 자동으로 남기는 것이다.

## 목표
- `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml up -d` 한 번으로 앱과 Docker 외부 수집기를 같이 실행한다.
- 앱 내부 진단 로그와 Docker 외부 관측 로그를 동일한 호스트 로그 루트 아래에 남긴다.
- 기존 기본 compose 보안/운영 프로파일은 유지하고, 진단 모드는 명시적으로 opt-in 한다.
- 기존 실험 프로파일(`BATCH_SCHEDULER_ENABLED`, `WAL_CHECKPOINT_ENABLED`, `DB_LOCK_MONITOR_ENABLED`)과 충돌하지 않게 한다.

## 비목표
- 진단 모드를 기본 compose 경로에 상시 포함하지 않는다.
- 새 수집 로직을 앱 컨테이너 내부에 합치지 않는다.
- Docker Desktop 자체 메트릭 수집이나 OS 레벨 메모리 추적까지 포함하지 않는다.

## 접근안 비교

### 권장안: 별도 diagnostics compose 오버레이 + 보조 수집 서비스
- `docker-compose.diagnostics.yml`에 앱 진단 env 오버레이와 `docker-diagnostics` 서비스를 함께 둔다.
- `docker-diagnostics`는 Docker socket을 통해 `docker stats`, `docker inspect`, `docker system df`, `LogPath` 크기 수집을 수행한다.
- 기존 `scripts/collect-docker-diagnostics.sh`를 그대로 재사용한다.

장점:
- 원커맨드 실행이 가능하다.
- 앱과 수집기 장애를 분리할 수 있다.
- 이미 검증된 수집 스크립트를 재사용하므로 구현 범위가 작다.

단점:
- Docker socket 마운트가 필요하다.
- 수집기 이미지 선택과 마운트 구성이 추가된다.

### 대안 1: 앱 오버레이만 compose에 추가, 수집기는 호스트 수동 실행 유지
장점은 단순성이다. 단점은 원커맨드 요구를 충족하지 못하고, 장애 시점 데이터 누락 가능성이 남는다.

### 대안 2: 앱 컨테이너 내부에서 수집 스크립트도 같이 실행
원커맨드처럼 보이지만, 앱 장애와 수집기 장애가 섞이고 진단 목적에 맞지 않는다. 컨테이너 책임이 흐려지고, Desktop 장애 시 어느 쪽 문제가 먼저였는지 분리가 안 된다.

## 선택한 설계
권장안을 채택한다.

구성은 다음과 같다.
- `docker-compose.diagnostics.yml`
  - `memento-mcp-server` 서비스에 진단 env 기본값을 주입한다.
  - `docker-diagnostics` 서비스를 추가한다.
- `docker-diagnostics`
  - Docker CLI가 포함된 경량 이미지를 사용한다.
  - `/var/run/docker.sock`를 마운트한다.
  - 저장소의 `scripts/collect-docker-diagnostics.sh`를 read-only 마운트해 실행한다.
  - `${HOME}/.memento/logs`를 동일하게 마운트해 출력 위치를 앱 로그와 맞춘다.

## 서비스 경계

### memento-mcp-server
책임:
- 앱 내부 상태 샘플 기록
- 서버 lifecycle 이벤트 기록
- 배치/WAL/DB lock diagnostics 이벤트 기록

출력:
- `${HOME}/.memento/logs/diagnostics/app-runtime.jsonl`
- `${HOME}/.memento/logs/diagnostics/app-events.jsonl`

### docker-diagnostics
책임:
- Docker 엔진 관점의 외부 증거 수집
- 대상 컨테이너 상태와 로그 파일 크기 추적
- Docker 전체 디스크 사용량 스냅샷 저장

출력:
- `${HOME}/.memento/logs/docker-diagnostics/docker-stats.jsonl`
- `${HOME}/.memento/logs/docker-diagnostics/docker-inspect.jsonl`
- `${HOME}/.memento/logs/docker-diagnostics/docker-log-size.jsonl`
- `${HOME}/.memento/logs/docker-diagnostics/docker-disk.log`

이 두 서비스는 동일 로그 루트를 공유하지만, 책임과 출력 파일은 분리한다.

## 프로파일 전략
프로파일 역할은 분리한다.

- `docker-compose.diagnostics.yml`: 수집기 활성화와 진단 기본값 제공
- `docker-compose.override.yml`: 실험 프로파일 선택

즉, 배치 차단/DB 모니터 차단/전부 차단은 계속 `docker-compose.override.yml` 또는 셸 env로 제어한다. `docker-compose.diagnostics.yml`은 수집기 활성화만 담당한다. 이렇게 해야 파일 역할이 명확하고 문서도 단순해진다.

## 세부 동작
- 사용자는 필요 시 `docker-compose.override.example.yml`을 `docker-compose.override.yml`로 복사해 실험 프로파일을 선택한다.
- 사용자는 `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml up -d`로 앱과 수집기를 함께 시작한다.
- `docker-diagnostics`는 기본 대상 컨테이너를 `memento-mcp-server`로 본다.
- 수집 간격은 기본 10초를 유지하되, 환경변수로 조정 가능하게 한다.
- 수집기 재시작 정책은 앱과 동일하게 `unless-stopped`를 사용하되, 문제 분리를 위해 독립 서비스로 유지한다.

## 보안 및 운영 제약
- Docker socket 마운트는 강한 권한이므로 진단 오버레이에서만 허용한다.
- 기본 `docker-compose.yml`과 `docker-compose.base.yml`에는 socket 마운트를 추가하지 않는다.
- 문서에서 진단 오버레이는 문제 재현/조사용임을 명시한다.
- 운영 상시 구성으로 권장하지 않는다.

## 오류 처리
- 대상 컨테이너가 아직 뜨지 않았거나 재시작 중이면 수집 스크립트는 JSONL error 레코드를 남기고 계속 진행한다.
- `docker system df` 실패도 로그에 남기고 루프는 유지한다.
- 수집기 자체 실패 시 `restart: unless-stopped`로 복구를 시도한다.

## 검증 계획
- `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml config`가 성공해야 한다.
- `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml up -d` 후 `docker ps`에 `memento-mcp-server`와 `docker-diagnostics` 둘 다 보여야 한다.
- `${HOME}/.memento/logs/docker-diagnostics` 아래 수집 파일이 생성되어야 한다.
- 기존 `docker-compose.override.example.yml`과 함께 사용해도 env 충돌 없이 기동되어야 한다.
- 문서 예시 명령이 실제 구성과 일치해야 한다.

## 구현 범위
- `docker-compose.diagnostics.yml` 추가
- 필요 시 `docker-compose.override.example.yml`의 안내 문구 조정
- `DOCKER_SETUP_GUIDE.md`에 원커맨드 진단 스택 실행 절차 추가
- `CHANGELOG.md`에 사용자 관점 변화 기록

## 구현 제외
- 수집 스크립트 기능 확장
- 앱 내부 diagnostics 포맷 변경
- 별도 대시보드/시각화 추가
