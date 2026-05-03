# 문서 전수 검수 워크플로 (git worktree)

## 목적

기능 개발 워크스페이스와 분리하여 문서만 수정·검증하고 PR을 낸다. 생성물(`graphify-out/` 등)은 **재생성**으로 맞춘다.

## 1. worktree 추가

저장소 루트에서(경로는 팀에 맞게 조정):

```bash
git fetch origin
git worktree add ../memento-docs-audit origin/main
cd ../memento-docs-audit
```

`main` 대신 `develop` 등 정책 브랜치를 쓰는 경우 스펙의 기준 브랜치에 맞춘다.

## 2. 문서 전용 브랜치

```bash
git switch -c docs/audit-$(date +%Y-%m-%d)
```

## 3. graphify 등 생성물

코드 변경이 포함된 경우, 루트에서(가상환경·의존성은 [AGENTS.md](../../../AGENTS.md) 및 graphify 스킬 따름):

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

생성 diff만 별도 커밋으로 두면 리뷰가 쉽다.

## 4. 기계 검증 (로컬)

```bash
npm ci
npm run docs:audit-links
npm run docs:verify-npm-scripts
npm run lint
npm run type-check
npm run test
```

문서만 바꾼 PR이라도 팀 정책에 따라 위를 최소한 `docs:audit-links`와 `docs:verify-npm-scripts`까지 실행한다.

## 5. PR 본문에 넣을 요약

- 검수 범위: 사람 유지 문서 / 생성물 재생성 여부
- `npm run docs:audit-links` / `docs:verify-npm-scripts` 결과
- 의도적 보류 항목은 이슈 번호 링크
