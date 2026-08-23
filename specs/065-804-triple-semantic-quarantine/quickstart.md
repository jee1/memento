# 실행 안내: 자동 triple semantic 격리

**Plan**: [plan.md](./plan.md) | **Contract**: [contracts/runner-cli.md](./contracts/runner-cli.md)

프로덕션 DB에 대한 **되돌리기 어려운 작업**이다. 순서를 건너뛰지 말 것.

## 사전 조건

```bash
node -v                       # ≥ 24
export DB_PATH=$HOME/.memento/data/memory.db    # 절대 경로. ~ 확장 안 됨
```

## 1단계 — 서버를 켜 둔 채 준비 (서비스 중단 없음)

```bash
# 백업 = 사본 A = 롤백 근거
npm run db:backup

# 크기 대조: 사본 A가 라이브와 비슷해야 한다. 현저히 작으면 중단.
ls -la "$(dirname "$DB_PATH")/backups/" | tail -3
ls -la "$DB_PATH"

# 백업 -wal 이 비어 있는지 (FR-007c). 성공 = clean.
#   존재 여부가 아니라 크기다. 읽기 전용으로 한 번만 열어도 -wal·-shm 은 생긴다.
test ! -s "<사본 A 경로>-wal" && echo "clean" || echo "중단: -wal 에 미반영 쓰기가 남아 있다"

# 사본 B 복제
cp "<사본 A 경로>" /tmp/quarantine-copy-b.db
```

```bash
# dry-run 리포트 (라이브 읽기 전용)
npm run memory:quarantine-065 -- report

# 관계 내보내기 — 재추출 복구의 유일한 근거
npm run memory:quarantine-065 -- export-relations
```

리포트에서 **반드시 확인할 것**:
- 오탐 전수 검증 0건
- `kg_triple` 보존율 100%
- 표본 A 50건이 전부 템플릿 문장인지 (사람이 손으로 쓴 서술이 보이면 중단)
- 형태 (2) 월별 추이 — 비중이 커지고 있으면 제외 근거 재검토

## 2단계 — 사본에서 전후 프로브와 리허설

```bash
# 사본 A의 *복제본* 에 서버를 붙여 before 기록
#   백업 원본에 직접 구동하면 안 된다 — ReflexionWorker 가 procedural 을 새로 쓴다(실측 249→250).
cp "<사본 A 경로>" /tmp/quarantine-copy-a.db
DB_PATH=/tmp/quarantine-copy-a.db npm run dev &
#   질의 10개를 memory_injection으로 호출 → before.json
kill %1

# 사본 B에 전량 격리 리허설 (= 소요 실측)
DB_PATH=/tmp/quarantine-copy-b.db \
  npm run memory:quarantine-065 -- rehearse

# 사본 B에 서버를 붙여 after 기록
DB_PATH=/tmp/quarantine-copy-b.db npm run dev &
#   같은 질의 10개 → after.json
kill %1
```

리허설이 실패하면 **라이브를 건드리지 않는다**. 소요 시간을 기록해 정지 창구를 잡는다.

## 3단계 — 서버 정지 후 라이브 실행

```bash
# 프로덕션 서버 정지 (여기서부터 서비스 중단)
docker compose stop     # 또는 운영 방식에 맞게

npm run db:pre-docker-deploy          # 무결성 점검

npm run memory:quarantine-065 -- execute
npm run memory:quarantine-065 -- cleanup
npm run memory:quarantine-065 -- vacuum
```

`execute`가 게이트에서 멈추면 종료 코드로 원인을 확인한다
([계약 문서](./contracts/runner-cli.md#중단-게이트) 참조). 중단 후에는 `--resume`으로 재개한다.

## 4단계 — 확인 후 재기동

```bash
# 타입별 건수: episodic·procedural 불변
# CASCADE 잔재 0행 (vec·FTS는 확장 로드 경로로 확인)
# DB 크기 감소 기록

docker compose start
```

## 롤백

판별식 자체가 틀렸다고 판단되면:

```bash
docker compose stop
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
cp "<사본 A 경로>" "$DB_PATH"
docker compose start
```

부분 삭제 상태는 **손상이 아니다**. 재개로 이어서 진행하면 되고, 롤백은 판별식이 틀렸을 때만
쓴다(FR-005c).

## 하지 말 것

- 라이브에서 `memory_injection`으로 전후 대조 — `recall_count`·`g_value`를 UPDATE해 측정이
  자기충족적이 된다(FR-003b)
- 산출물을 저장소 안 `.local/` 밖에 두기 — 표본에 기억 본문이 들어 있다(FR-006b)
- 출처 episodic의 `triple_extracted` 리셋 — #805가 유입을 막기 전엔 같은 파편이 다시 쌓인다
  (FR-006k)
