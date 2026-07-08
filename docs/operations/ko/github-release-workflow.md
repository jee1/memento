# GitHub Release 워크플로우 가이드

릴리스 태그를 푸시하면 GitHub Actions가 npm 게시·Release 노트 생성까지 이어집니다. 그런데 **Release를 수동으로 먼저 만들어 두면** 워크플로가 같은 `tag_name`으로 다시 만들려다 `already_exists`에 걸릴 수 있습니다. 이 문서는 그 충돌이 왜 생기는지, 현재 워크플로가 어떻게 완화하는지, 트리거를 어떻게 바꾸면 깔끔한지를 정리합니다.

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
git tag v1.7.3
git push origin v1.7.3
```

### 2. GitHub에서 Release 생성 (선택)
- GitHub UI에서 Release 생성
- 또는 워크플로우에서 자동 생성

### 3. 워크플로우 자동 실행
- npm publish 수행
- Release가 없으면 생성, 있으면 스킵

## 🎯 최종 권장사항

현재 구현된 방식이 가장 유연합니다:
- GitHub에서 Release를 수동으로 생성해도 작동
- 태그만 푸시해도 워크플로우 실행 가능 (workflow_dispatch)
- Release 중복 생성 오류 방지

