# 로컬 임베딩 모델 전환 운영 절차 (#1729)

로컬 임베딩 모델을 `paraphrase-multilingual-MiniLM-L12-v2` 에서 `multilingual-e5-small-ko-v2` 로 바꾸는 릴리스를 운영에 올리는 절차다. 설계와 측정은 [ADR](../../adr/2026-11-15-issue-1729-local-embedding-model-swap.md) 에 있다.

## 미리 알 것

- 새 버전이 기동하면 HTTP 서버를 띄운 프로세스가 옛 모델 벡터를 다시 만든다(모델 이주). 이주 중 벡터 검색은 새 모델 행만 비교한다. 의미 레인이 덜 찰 뿐 틀린 결과가 섞이지 않는다.
- 운영 DB 사본 리허설(2026-11-15, 활성 기억 13,510건, 1GiB cgroup): 실행 14회, 580초, 최대 RSS 903MB, 실행 하나 최대 96초. 끝난 뒤 옛 모델 native 행 1건이 남았고 지운 기억의 행이다(이주 대상 아님).
- 기억끼리 기준값의 척도가 바뀐다(CHANGELOG #1729 PR 8). `.env` 에 `CONSOLIDATION_SIMILARITY_THRESHOLD`, `CONSOLIDATION_MERGE_SIMILARITY_THRESHOLD`, `MEMENTO_REMEMBER_DEDUP_THRESHOLD` 를 앞 모델 값으로 적어 두었으면 배포 전에 지운다.
- `CONSOLIDATION_JUDGE` 를 확인한다. `typesafe` 가 아니면 Sleep consolidation 은 코사인 군집만으로 요약한다. agent_panel 판정에서 군집 기준값 띠의 쌍은 두 모델 모두 합칠 쌍이 0% 였고, 사본에서 새 기준값의 군집은 93개에서 153개, 군집에 든 episodic 은 775건에서 964건으로 는다.

## 집 PC (Docker)

1. 백업한다. `npm run db:backup`(호스트 백업이 막히면 `npm run db:backup:docker`).
2. [Docker 배포 절차](docker-deploy-procedure.md)의 표준 절차로 올린다.
3. 배포 직후 Sleep consolidation 을 멈춘다. 관리 화면 배치 탭이나 `POST /admin/batch/pause` 에 `{"jobType":"sleep_consolidation_batch"}`.
4. 모델 드리프트가 0 이 될 때까지 본다. 관리 화면 **임베딩 상태** 카드의 모델 드리프트, 또는 `GET /admin/embedding-health?provider=minilm` 의 `diagnostics.modelDriftCount`. 리허설 기준 약 10분이다.
   - 반복이 0 전에 멈추면 잡 이력의 `embedding_reconciliation` 실패를 본다. 남은 기억은 하루 1회 정기 실행이 다시 본다.
   - OOM 으로 재시작이 되풀이되면 `.env` 에 `BATCH_SCHEDULER_ENABLED=false` 를 두고 다시 올려 루프를 끊은 뒤 원인을 본다. 잡 일시정지는 재시작하면 풀려 루프를 끊지 못한다.
   - `reindex-embeddings --dry-run` 으로 진행을 보지 않는다. 이주를 하나 더 띄운다.
5. 0 이 되면 `npm run db:backup:docker` 를 한 번 더 하고 Sleep consolidation 을 다시 켠다(`POST /admin/batch/resume`, 같은 body). 데이터를 바꾸는 배치가 새 모델로 처음 돌기 직전의 복원점이다.
6. `/health`, 기억 수, 에러 로그, `memory_injection` 결과를 확인한다.
7. 로컬 `docker-compose.override.yml` 에서 `~/.memento/hf-cache` 마운트를 지우고 다시 올린다. 새 버전은 이미지 안 모델 패키지 폴더만 읽는다. 로그의 「로컬 임베딩 모델 로딩 완료」와 임베딩 상태 카드 커버리지로 확인한다.

## 회사 (npm 설치)

- `npm i -g memento-mcp-server@<버전>` 이 모델 패키지 `@jee1/memento-embedding-e5-small-ko-v2`(내려받기 약 84MB)를 함께 받는다. 레지스트리가 이 패키지를 내주지 못하면 설치가 실패한다. 실행 중에는 내려받지 않는다.
- 업그레이드 전에 서버를 멈추고 DB 파일을 `-wal`, `-shm` 과 함께 복사해 둔다.
- HTTP sidecar 가 뜨는 설치는 sidecar 잠금을 얻은 프로세스가 이주한다. 위 4번처럼 확인한다.
- sidecar 없는 stdio 전용 설치는 이주 반복이 없고 정기 실행이 하루 1,000건씩 따라잡는다. 한 번에 끝내려면 MCP 클라이언트를 모두 닫아 서버를 멈춘 뒤 재색인한다. 서버가 떠 있는 동안에는 돌리지 않는다(같은 기억을 겹쳐 계산한다).

  ```bash
  DB_PATH=<서버와 같은 DB 경로> node "$(npm root -g)/memento-mcp-server/dist/scripts/reindex-embeddings.js" --provider minilm
  ```

## 되돌리기

| 사고 | 되돌리는 법 | 잃는 것 |
|---|---|---|
| 벡터만(검색 품질이 나빠졌다) | 전환 PR 을 revert 한 릴리스로 다시 올린다. 같은 이주가 거꾸로 돌아 앞 모델 벡터를 다시 만든다(측정 443초). Docker 는 7번에서 지운 `hf-cache` 마운트를 되살린다. 회사는 앞 버전을 다시 설치하고 위 절차대로 이주한다 | 없음 |
| 데이터(군집이나 합침이 잘못 합쳤다) | 5번 백업을 [Docker 배포 절차](docker-deploy-procedure.md) 「롤백」으로 복원한 뒤 벡터만 되돌리기 | 5번 백업 뒤에 쓴 기억 |
| 기준값(합침이나 중복 판정 규모가 크다) | 그 기능의 잡을 멈추고(중복 판정은 `MEMENTO_REMEMBER_DEDUP_MODE=off`) 모델 정의의 값을 고치는 PR 을 낸다. 급하면 env 세 키를 새 척도의 더 높은 값으로 둔다 | 없음. 잘못 합친 것이 있으면 데이터 사고로 다룬다 |
