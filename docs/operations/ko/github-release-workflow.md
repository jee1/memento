# GitHub Release 워크플로우 가이드

GitHub Release 를 발행하면 `release.yml` 이 npm 게시까지 자동으로 합니다. 게시는 OIDC 신뢰 게시(trusted publishing)라 npm 토큰을 쓰지 않고, 손으로 게시하는 단계는 없습니다. 그런데 **Release를 수동으로 먼저 만들어 두면** 워크플로가 같은 `tag_name`으로 다시 만들려다 `already_exists`에 걸릴 수 있습니다. 이 문서는 그 충돌이 왜 생기는지, 현재 워크플로가 어떻게 완화하는지, 트리거를 어떻게 바꾸면 깔끔한지를 정리합니다.

## 릴리스 주기와 순서 (2026-11-19, 2026-11-20 결정)

- **배포와 릴리스는 따로 간다.** main 에 머지된 PR 은 바로 운영 docker 에 배포한다([Docker 배포 절차](docker-deploy-procedure.md)). 릴리스 때문에 PR 머지를 미루지 않는다.
- **릴리스는 매주 월요일.** 직전 릴리스 뒤 바뀐 것이 있을 때만 낸다. 보안 수정, 데이터 손실, 운영 장애, npm 설치나 실행 불가 같은 긴급건은 바로 낸다.
- **태그는 운영에서 돈 커밋에 건다.** main 끝이 아니라 운영 docker 에서 돌려 확인한 릴리스 준비 커밋이다. 순서는 아래와 같다.
  1. 릴리스 준비 PR 에서 버전을 올리고 `npm run release:changelog -- --version <버전>` 으로 CHANGELOG 절을 만든다.
  2. 머지한 뒤 운영에 배포해 돌려 본다.
  3. 그 커밋에 `git tag <버전> <sha>` 를 걸어 푸시하고 `gh release create <버전> --verify-tag` 로 Release 를 발행한다. `release.yml` 이 npm 게시까지 한다.
  4. 릴리스 준비 PR 머지 직후 main 버전을 다음 번호로 올린다(아래 「릴리스 준비 PR 머지 직후 다음 버전으로 올린다」, #1792).

## 🚨 문제: "already_exists" 오류

GitHub Release 생성 시 다음 오류가 발생할 수 있습니다:

```
Validation Failed: {"resource":"Release","code":"already_exists","field":"tag_name"}
```

## 🔍 원인

워크플로우가 `release: types: [published]`로 트리거되는 경우:
1. GitHub에서 Release를 수동으로 생성
2. 워크플로우가 자동으로 실행됨
3. 워크플로우가 같은 태그로 Release를 다시 생성하려고 시도
4. 이미 존재하므로 오류 발생

## ✅ 해결 방법

### 방법 1: 자동 해결 (현재 구현)

워크플로우가 자동으로 Release 존재 여부를 확인하고:
- **존재하지 않으면**: Release 생성
- **이미 존재하면**: 스킵하고 npm publish만 수행

### 방법 2: 워크플로우 트리거 변경 (권장)

태그 푸시 시 워크플로우를 실행하고, Release는 워크플로우에서 생성:

```yaml
on:
  push:
    tags:
      - 'v*'  # v로 시작하는 태그
  workflow_dispatch:
```

이 경우:
1. 태그 푸시 → 워크플로우 실행
2. 워크플로우에서 npm publish
3. 워크플로우에서 Release 생성

### 방법 3: Release 생성 단계 제거

GitHub에서 Release를 수동으로 생성하는 경우, 워크플로우에서 Release 생성 단계를 완전히 제거:

```yaml
# Release 생성 단계 제거
# - name: Create GitHub Release
#   ...
```

## 📋 현재 워크플로우 동작

### 시나리오 1: GitHub에서 Release 수동 생성
1. GitHub에서 Release 생성 (태그: v1.7.3)
2. 워크플로우 자동 실행
3. npm publish 수행
4. Release 존재 확인 → 이미 존재 → 스킵
5. ✅ 성공

### 시나리오 2: 태그만 푸시
1. 태그 푸시 (v1.7.3)
2. 워크플로우 실행 (workflow_dispatch 또는 수동)
3. npm publish 수행
4. Release 존재 확인 → 없음 → 생성
5. ✅ 성공

## 🔧 워크플로우 개선 옵션

### 옵션 A: 태그 푸시 시 자동 실행

```yaml
on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
```

**장점:**
- 태그 푸시만으로 자동 실행
- Release 자동 생성
- 더 자동화된 워크플로우

**단점:**
- GitHub에서 Release를 수동으로 생성하는 경우 중복 가능

### 옵션 B: 현재 방식 유지 (권장)

```yaml
on:
  release:
    types: [published]
  workflow_dispatch:
```

**장점:**
- GitHub에서 Release를 수동으로 생성 가능
- Release 존재 여부 자동 확인
- npm publish는 항상 수행

**단점:**
- Release를 먼저 생성해야 워크플로우 실행

## 💡 권장 워크플로우

### 1. 태그 생성 및 푸시
```bash
git tag 2.3.12 <운영에서 돈 커밋 sha>
git push origin 2.3.12
```

### 2. GitHub Release 발행 (필수)
```bash
gh release create 2.3.12 --verify-tag --notes-file <노트 파일>
```
`release.yml` 은 `release: published` 로 시작하므로 태그만 푸시해서는 게시가 일어나지 않는다.

### 3. 워크플로우 자동 실행
- npm 게시(OIDC 신뢰 게시)
- Release가 없으면 생성, 있으면 스킵

### 4. CHANGELOG 버전 절 만들기 (이슈 #1049)

PR 은 `CHANGELOG.md` 를 고치지 않고 `changelog.d/<이슈번호>-<짧은이름>.md` 조각을 더합니다 (이슈 #1780, 형식은 `changelog.d/README.md`). 릴리스 준비 PR 에서 조각을 새 버전 절로 합치고 조각을 지웁니다.

```bash
npm run release:changelog -- --version 1.31.0 --dry-run   # 합칠 항목만 본다
npm run release:changelog -- --version 1.31.0             # CHANGELOG.md 갱신, 조각 삭제
```

`[Unreleased]` 에 옛 방식으로 남은 항목도 같이 옮겨지고, 결과는 아래 모양입니다.

```markdown
## [Unreleased]

## [1.31.0] - 2026-09-19
```

이 단계를 건너뛰면 `[Unreleased]`가 이미 배포된 항목의 적치장이 됩니다 — `1.5.0` 이후
25개 릴리스가 그렇게 쌓였고 이슈 #1049로 한 번 정리했습니다. 항목별 버전 귀속이
불확실하면 쪼개 적지 말고 GitHub Releases를 정본으로 두십시오. 릴리스 노트 자체는
`gh release create --notes-file`로 직접 작성하며, `release.yml`은 CHANGELOG를 읽지 않습니다.

`npm run check:version-sync` 가 이 절을 게이트로 강제합니다 (#1116). 직전 태그 이후 커밋이
있는데 `[Unreleased]` 항목도 `changelog.d/` 조각도 없으면 CI 가 실패합니다. PR 단계에서는 사용자 영향 경로를 바꾼 PR 이 조각을 더하지 않으면 실패합니다. 매니페스트 버전이 직전 태그보다 앞서
있을 때(= 릴리스 준비 PR)는 생략하므로, 위 4단계를 밟는 릴리스 PR 자체는 막히지 않습니다.

## 🎯 최종 권장사항

현재 구현된 방식이 가장 유연합니다:
- GitHub에서 Release를 수동으로 생성해도 작동
- 태그만 푸시해도 워크플로우 실행 가능 (workflow_dispatch)
- Release 중복 생성 오류 방지

## 버전은 저장소가 단일 출처다 (#1077)

릴리스를 만들기 **전에** 매니페스트와 플러그인 설정의 `version` 을 올려 PR 로 머지해야 합니다.

- `package.json`
- `packages/memento-core/package.json`
- `packages/memento-server/package.json`
- `plugins/memento/.mcp.json` (`args`의 `memento-mcp-server@<version>`)
- `plugins/memento/.claude-plugin/plugin.json` (`version`. 그대로면 플러그인 사용자에게 갱신이 안 나간다)

서로 다르거나 태그와 다르면 릴리스 워크플로가 `E_VERSION_MISMATCH` 로 실패합니다.

예전에는 워크플로가 발행 시점에 루트 `package.json` 을 태그 버전으로 덮어썼습니다. 그
변경은 저장소로 되돌아오지 않았기 때문에, tarball 은 올바른 버전으로 나가도 저장소는 낡은
값에 머물렀고 그 값을 읽는 Docker 배포본이 MCP 클라이언트에게 틀린 버전을 보고했습니다.

세 매니페스트를 함께 올려야 하는 이유는 서버가 버전을 읽는 상대경로가 실행 레이아웃에 따라
다른 파일로 풀리기 때문입니다. npm 발행본에서는 루트 매니페스트로, Docker 배포본에서는
워크스페이스 매니페스트로 풀립니다. `npm run check:version-sync` 가 이 일치를 검사하며 CI 에서도
실행됩니다.


## 릴리스 준비 PR 머지 직후 다음 버전으로 올린다

릴리스 준비 PR(2.3.11 이라면 버전과 CHANGELOG 절을 만든 PR)을 머지한 직후, 다음 PR 로 매니페스트 다섯 곳과 `server.json`, `package-lock.json` 을 다음 패치 버전(2.3.12)으로 올립니다. 올리지 않으면 릴리스 사이에 머지된 커밋이 모두 직전 릴리스 버전을 달고 운영 이미지에 올라갑니다.

- **태그는 운영에서 돈 릴리스 준비 커밋에 건다.** main 의 최신 커밋이 아니라 릴리스 준비 PR 의 머지 커밋에 `git tag 2.3.11 <sha>` 를 걸어 푸시하고, 그 태그로 `gh release create 2.3.11 --verify-tag` 를 합니다. `release.yml` 은 태그 커밋을 체크아웃해 세 매니페스트가 태그와 같은지 검사하므로(`Verify package.json version matches the tag`), 이렇게 하면 main 이 2.3.12 로 앞서 있어도 2.3.11 이 게시됩니다. 태그 없이 Release 를 main 대상으로 만들면 태그가 main 끝에 생겨 `E_VERSION_MISMATCH` 로 멈춥니다.
- **`check:version-sync` 는 이 상태를 통과한다.** 매니페스트 버전이 직전 태그보다 앞서 있으면 CHANGELOG 게이트를 생략합니다(`release-prep`). 버전을 올려 둔 동안 이 게이트는 쉬고, 릴리스 준비 PR 에서 `release:changelog` 가 합칠 항목이 없으면 실패하는 것으로 노트 누락을 막습니다.
- `[Unreleased]` 가 아니라 `changelog.d/` 조각이 다음 절의 재료다. 버전을 올려도 `CHANGELOG.md` 에 2.3.12 절을 미리 만들지 않습니다.
