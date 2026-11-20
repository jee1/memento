# GitHub release workflow

This guide covers **creating and publishing GitHub Releases** for Memento, including the common `already_exists` tag error when CI and manual releases collide. Follow the Korean doc for the full checklist; this page orients English readers to the flow.

Full procedures (KO): [github-release-workflow.md (KO)](../ko/github-release-workflow.md).

## Cadence

- Deploy and release are separate. Every PR merged to main goes to the production Docker instance right away (`npm run deploy:docker`). PRs are not held for a release.
- Releases go out every Monday, only when something changed since the last release. Urgent fixes (security, data loss, production outage, broken npm install) go out at once.
- The tag goes on the release-prep commit that already ran in production, not on the tip of main. Right after the release-prep PR merges, main is bumped to the next version (#1792).

## Typical flow

Ensure `CHANGELOG` and version bumps align (PRs add `changelog.d/` fragments instead of editing `CHANGELOG.md`; the release-prep PR merges them with `npm run release:changelog -- --version <x.y.z>`, see `changelog.d/README.md`, #1780). Tag the commit that ran in production (`git tag <x.y.z> <sha>`), push the tag, then publish the GitHub Release with `gh release create <x.y.z> --verify-tag`. Publishing the Release starts `release.yml` (`release: published`), which publishes to npm through OIDC trusted publishing. There is no manual npm publish step, and pushing a tag alone does not publish. If a workflow fails with `already_exists` on `tag_name`, a release for that tag already exists—either reuse it or bump the version before retrying.
