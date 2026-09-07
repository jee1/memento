# Data Model: pack scripts allowlist

No database entities.

## Concepts

| Name | Definition |
|------|------------|
| Pack entry | String path inside `.tgz`, normalized with `/`, typically `package/...` |
| Allowed script file | Exact path in `ALLOWED_PACKAGE_SCRIPT_PATHS` |
| Directory entry | Path ending with `/` or lacking a file suffix under `package/scripts/` — ignored by violation check if it is a prefix of an allowed file or empty dir marker |
| Violation | File path under `package/scripts/` that is not in the allowlist, or ends with `.ts` |

## Allowlist (canonical)

```
package/scripts/auto-setup.js
package/scripts/lib/cli-runtime.js
package/scripts/lib/postinstall-db-init.js
```
