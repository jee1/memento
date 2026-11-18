# changelog.d

PR 은 `CHANGELOG.md` 를 고치지 않고 이 폴더에 조각 파일 하나를 더한다. 같은 자리를 여러 PR 이 고쳐서 생기던 충돌을 없애려는 방식이다 (#1780).

## 파일 이름

`<이슈번호>-<짧은이름>.md` (소문자, 숫자, 하이픈). 예: `1781-flaky-forgetting.md`

## 형식

첫 줄에 절 이름 하나(`Added`, `Changed`, `Fixed`, `Removed`, `Security`), 이어서 `- ` 로 시작하는 항목을 한 개 이상 적는다. 항목이 길면 다음 줄을 두 칸 들여 쓴다.

```
Fixed
- forgetting 점수 비교 테스트의 시각을 고정해 가끔 실패하지 않게 한다 (#1781)
```

## 규칙

- 사용자에게 보이는 변경(`packages/`, `static/` 등)을 하는 PR 은 조각을 더한다. `no-changelog` 라벨이나 `docs`, `test`, `chore`, `style`, `ci` 제목 타입은 지금처럼 면제다.
- 절이 둘 이상이면 파일을 나눈다 (`1781-a.md`, `1781-b.md`).
- 형식은 `npm run check:version-sync` 가 검사한다. 로컬에서 `npx tsx scripts/release-changelog.ts --check` 로도 볼 수 있다.
- 릴리스 준비 PR 이 `npx tsx scripts/release-changelog.ts --version <x.y.z>` 로 조각을 `CHANGELOG.md` 의 새 버전 절에 합치고 지운다. 조각을 손으로 지우지 않는다.
- 옛 방식으로 `CHANGELOG.md` 의 `[Unreleased]` 에 남아 있는 항목은 첫 릴리스에서 같이 새 버전 절로 옮겨진다.
