# Repository Guidelines

## Project Structure & Module Organization
Source code lives under `src/`. `src/server/` exposes the MCP entry points (`index.ts` for CLI, `http-server.ts` for HTTP). Domain logic is grouped by concern: `src/services/` (embedding, forgetting, monitoring), `src/algorithms/` (search engines), `src/utils/` (database helpers), and `src/types/` for shared contracts. Persistence assets live in `src/database/` (schema + init scripts) and compile into `dist/database/` during builds. Local SQLite state is written to `data/`; treat it as disposable. Documentation sits in `docs/`, and build artifacts compile to `dist/` (never edit by hand).

## Build, Test, and Development Commands
Run `npm install` once before other tasks. `npm run dev` starts the MCP server in watch mode; use `npm run dev:http` for the HTTP facade. `npm run build` transpiles TypeScript and copies the SQL schema, while `npm run start` boots the compiled server. Quality gates: `npm run lint`, `npm run type-check`, and `npm test` (Vitest). Scenario scripts such as `npm run test:client`, `npm run test:search`, and `npm run test:forgetting` exercise higher-level workflows.

## Coding Style & Naming Conventions
We target Node.js ≥ 20 and modern TypeScript with ES modules. Default to two-space indentation, trailing commas, and single quotes as seen in `src/server/index.ts`. File names follow kebab-case (`memory-embedding-service.ts`); classes use PascalCase, functions camelCase. Keep business logic typed with shared interfaces from `src/types/`. Format code before commits via `npm run lint -- --fix` when applicable.

## Testing Guidelines
Vitest backs the unit and integration tests with clear file naming conventions:

- **Unit Tests** (`.spec.ts`): Place in the same directory as the module being tested
  - Example: `src/algorithms/search-engine.spec.ts`
  - Test individual functions/classes with mocks
- **E2E Tests** (`test-*.ts`): Place in `src/test/` directory
  - Example: `src/test/test-client.ts`
  - Test complete workflows with real MCP server

Prefer deterministic data via the `DatabaseUtils` helpers. Run `npm test` for the suite, and add relevant scenario scripts (e.g., `npm run test:performance`) to PR comments when used. Clean or reset `data/` if tests modify the local SQLite database.

## Commit & Pull Request Guidelines
Follow the existing conventional commit style (`feat:`, `fix:`, `chore:`) with concise, action-oriented summaries; include Korean context when helpful to the team. Reference tracking issues in the body. PRs should describe intent, outline testing evidence, and call out schema or configuration changes. Attach logs or screenshots for HTTP/UI-facing updates, and request review from domain owners when touching search, forgetting, or database modules.

## Environment & Database Notes
Copy `env.example` to `.env` and override API keys or database paths as needed. Use `npm run db:init` for fresh setups and `npm run db:migrate` when altering the SQLite schema; include migration notes in PRs. Keep secrets out of source control and avoid committing generated files under `data/` or `dist/`.
