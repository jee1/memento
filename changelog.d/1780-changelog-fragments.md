Changed
- PR 이 `CHANGELOG.md` 의 같은 자리를 고쳐 서로 충돌하던 것을 없앤다. PR 은 `changelog.d/<이슈번호>-<짧은이름>.md` 조각만 더하고, 릴리스 준비 때 `npm run release:changelog -- --version <x.y.z>` 가 새 버전 절로 합쳐 조각을 지운다. `check:version-sync` 의 PR 게이트와 릴리스 게이트가 조각을 인정하고 형식을 검사한다 (#1780)
