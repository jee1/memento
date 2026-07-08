# GitHub release workflow

This guide covers **creating and publishing GitHub Releases** for Memento, including the common `already_exists` tag error when CI and manual releases collide. Follow the Korean doc for the full checklist; this page orients English readers to the flow.

Full procedures (KO): [github-release-workflow.md (KO)](../ko/github-release-workflow.md).

## Typical flow

Tag the release, ensure `CHANGELOG` and version bumps align, publish the GitHub Release, then let CI publish npm artifacts if your pipeline is wired for `release: published`. If a workflow fails with `already_exists` on `tag_name`, a release for that tag already exists—either reuse it or bump the version before retrying.
