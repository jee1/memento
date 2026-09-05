# Contract: postinstall DB init helper

## `runPostinstallDbInit(options?)`

- **Input**: optional `{ dbPath?: string }` (else env/`mementoConfig` default via core).
- **Behavior**: load `@memento/core`, call `initializeDatabase`, `closeDatabase`, return void on success.
- **Failure**: throw / reject — caller must not swallow; postinstall exits non-zero.
- **Forbidden**: invoking `packages/**` source paths or `tsx` for this step.
- **Logging**: caller may log step success/failure; helper may stay quiet or log via core logger.
