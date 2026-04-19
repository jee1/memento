# Docker Compose Diagnostics Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose` 한 번으로 Memento 앱과 Docker 외부 진단 수집기를 함께 띄워 Desktop/daemon 장애 직전 증거를 자동으로 남긴다.

**Architecture:** 기본 compose는 그대로 두고, 진단 수집기는 `docker-compose.diagnostics.yml` 오버레이로만 활성화한다. 수집기 컨테이너는 Docker CLI + bash가 포함된 전용 이미지를 사용해 기존 `scripts/collect-docker-diagnostics.sh`를 그대로 실행하고, 실험 프로파일 선택은 계속 `docker-compose.override.yml`이 담당한다.

**Tech Stack:** Docker Compose, Alpine-based Docker CLI image, Bash, existing diagnostics shell script, Markdown docs

---

## File Structure

- `docker-compose.diagnostics.yml`
  - 진단용 compose 오버레이. 앱 진단 env 기본값과 `docker-diagnostics` 보조 서비스를 정의한다.
- `docker/diagnostics/Dockerfile`
  - Docker CLI 이미지에 bash만 추가한 최소 진단 수집기 이미지 정의.
- `DOCKER_SETUP_GUIDE.md`
  - 원커맨드 진단 스택 실행 절차, override 조합, 종료/정리 절차를 문서화한다.
- `docker-compose.override.example.yml`
  - 프로파일 역할이 유지된다는 안내 문구만 필요 시 보강한다.
- `CHANGELOG.md`
  - 사용자 관점에서 diagnostics compose stack 추가 사실을 `Unreleased`에 기록한다.

---

### Task 1: 진단 수집기 이미지를 추가한다

**Files:**
- Create: `docker/diagnostics/Dockerfile`

- [ ] **Step 1: Dockerfile 존재 여부를 확인하는 실패 전제부터 잡는다**

```bash
test -f docker/diagnostics/Dockerfile
```

Expected: exit code `1`

- [ ] **Step 2: 진단 수집기 Dockerfile을 작성한다**

```dockerfile
FROM docker:27-cli

RUN apk add --no-cache bash

WORKDIR /workspace
```

- [ ] **Step 3: Dockerfile 문법을 빠르게 검토한다**

Run: `sed -n '1,80p' docker/diagnostics/Dockerfile`
Expected output:
- `FROM docker:27-cli`
- `RUN apk add --no-cache bash`
- `WORKDIR /workspace`

- [ ] **Step 4: 커밋한다**

```bash
git add docker/diagnostics/Dockerfile
git commit -m "chore: add diagnostics collector image"
```

---

### Task 2: diagnostics compose 오버레이를 추가한다

**Files:**
- Create: `docker-compose.diagnostics.yml`
- Modify: `docker-compose.override.example.yml`

- [ ] **Step 1: 오버레이가 없음을 확인한다**

Run: `test -f docker-compose.diagnostics.yml`
Expected: exit code `1`

- [ ] **Step 2: diagnostics compose 오버레이를 작성한다**

```yaml
version: '3.8'

services:
  memento-mcp-server:
    environment:
      DIAGNOSTICS_ENABLED: "true"
      DIAGNOSTICS_INTERVAL_MS: "10000"

  docker-diagnostics:
    build:
      context: .
      dockerfile: docker/diagnostics/Dockerfile
    depends_on:
      - memento-mcp-server
    environment:
      DIAGNOSTICS_INTERVAL_SECONDS: ${DIAGNOSTICS_INTERVAL_SECONDS:-10}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./scripts/collect-docker-diagnostics.sh:/workspace/collect-docker-diagnostics.sh:ro
      - ${HOME}/.memento/logs:/logs
    restart: unless-stopped
    command:
      - /bin/bash
      - /workspace/collect-docker-diagnostics.sh
      - memento-mcp-server
      - /logs/docker-diagnostics
```

- [ ] **Step 3: override 예시의 역할을 명시하는 주석을 보강한다**

```yaml
services:
  memento-mcp-server:
    environment:
      # 이 파일은 실험 프로파일 선택 전용입니다.
      # docker-compose.diagnostics.yml 은 수집기 활성화만 담당합니다.
      DIAGNOSTICS_ENABLED: "true"
      DIAGNOSTICS_INTERVAL_MS: "10000"
```

- [ ] **Step 4: compose 병합 결과를 검증한다**

Run: `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml config`
Expected:
- `memento-mcp-server` 아래 `DIAGNOSTICS_ENABLED: "true"` 노출
- `docker-diagnostics` 서비스 정의 존재
- YAML parse error 없음

- [ ] **Step 5: override와 함께 병합해도 충돌이 없는지 검증한다**

Run: `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml -f docker-compose.override.example.yml config`
Expected:
- `docker-diagnostics` 서비스 유지
- `memento-mcp-server` env 병합 성공
- duplicate key error 없음

- [ ] **Step 6: 커밋한다**

```bash
git add docker-compose.diagnostics.yml docker-compose.override.example.yml
git commit -m "feat: add docker diagnostics compose overlay"
```

---

### Task 3: 운영 가이드와 changelog를 갱신한다

**Files:**
- Modify: `DOCKER_SETUP_GUIDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 기존 문서에서 수동 수집 절차 위치를 찾는다**

Run: `rg -n "collect-docker-diagnostics|override.example|진단 모드" DOCKER_SETUP_GUIDE.md`
Expected: diagnostics 관련 기존 문단 위치가 출력됨

- [ ] **Step 2: 원커맨드 diagnostics stack 실행 절차를 문서에 반영한다**

```md
### 원커맨드 진단 스택 실행

    cp docker-compose.override.example.yml docker-compose.override.yml
    # 원하는 실험 프로파일만 남기고 주석 정리

    docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml up -d

- `memento-mcp-server`는 앱 내부 diagnostics JSONL을 `${HOME}/.memento/logs/diagnostics`에 기록합니다.
- `docker-diagnostics`는 Docker 외부 관측 로그를 `${HOME}/.memento/logs/docker-diagnostics`에 기록합니다.
- 종료 시에는 `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml down`을 사용합니다.
```

- [ ] **Step 3: changelog에 diagnostics compose stack 추가를 기록한다**

```md
- Docker diagnostics stack 추가: `docker-compose.diagnostics.yml` 오버레이와 `docker-diagnostics` 수집기 컨테이너로 원커맨드 재현/관측 지원
```

- [ ] **Step 4: 문서와 셸 조각을 검증한다**

Run: `bash -n scripts/collect-docker-diagnostics.sh`
Expected: no output, exit code `0`

Run: `rg -n "docker-compose.diagnostics.yml|docker-diagnostics|원커맨드 진단 스택" DOCKER_SETUP_GUIDE.md CHANGELOG.md`
Expected:
- 가이드에 실행/종료 절차 존재
- changelog에 사용자 관점 요약 존재

- [ ] **Step 5: 커밋한다**

```bash
git add DOCKER_SETUP_GUIDE.md CHANGELOG.md
git commit -m "docs: document diagnostics compose stack"
```

---

### Task 4: 최종 통합 검증과 그래프 재빌드

**Files:**
- Verify: `docker-compose.diagnostics.yml`
- Verify: `docker/diagnostics/Dockerfile`
- Verify: `DOCKER_SETUP_GUIDE.md`
- Verify: `CHANGELOG.md`

- [ ] **Step 1: diagnostics collector 이미지를 실제로 빌드한다**

Run: `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml build docker-diagnostics`
Expected:
- `docker/diagnostics/Dockerfile` 기반 build success
- `apk add --no-cache bash` 완료

- [ ] **Step 2: 통합 기동을 검증한다**

Run: `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml up -d`
Expected:
- `memento-mcp-server` started
- `docker-diagnostics` started

- [ ] **Step 3: 두 서비스 상태를 확인한다**

Run: `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml ps`
Expected:
- `memento-mcp-server` 상태 표시
- `docker-diagnostics` 상태 표시

- [ ] **Step 4: 수집 파일이 실제 생성되는지 확인한다**

Run: `ls -1 ${HOME}/.memento/logs/docker-diagnostics`
Expected:
- `docker-stats.jsonl`
- `docker-inspect.jsonl`
- `docker-disk.log`
- `docker-log-size.jsonl`

- [ ] **Step 5: 스택을 정리한다**

Run: `docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml down`
Expected: services removed without error

- [ ] **Step 6: graphify를 재빌드한다**

Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
Expected: graph rebuild completes successfully

- [ ] **Step 7: 최종 커밋한다**

```bash
git add docker-compose.diagnostics.yml docker/diagnostics/Dockerfile DOCKER_SETUP_GUIDE.md CHANGELOG.md docker-compose.override.example.yml
git commit -m "chore: finalize diagnostics compose stack"
```

---

## Self-Review

- **Spec coverage:**
  - `docker-compose.diagnostics.yml` 추가 → Task 2
  - 수집기 이미지/실행 기반 마련 → Task 1
  - docs/changelog 반영 → Task 3
  - 실제 compose build/up/down 검증 → Task 4
- **Placeholder scan:** `TBD`, `TODO`, “적절히”, “나중에” 같은 placeholder 없음.
- **Type consistency:** 서비스명은 `docker-diagnostics`, 대상 컨테이너명은 `memento-mcp-server`, 오버레이 파일명은 `docker-compose.diagnostics.yml`로 전 구간 일관됨.
