# Contributing

Thanks for contributing to Memento. This guide is for **first-time PR authors**: where to start, and what to include for bug, feature, or docs contributions. Deeper setup lives in [developer-guide.md](docs/guides/en/developer-guide.md) and [AGENTS.md](AGENTS.md).

## 🚀 Quick start

Fork the [memento repository](https://github.com/jee1/memento) on GitHub, clone it locally, install dependencies, then run the dev server and tests once.

Requirements: **Node.js ≥24**, **npm ≥10**. Match the version in the root [`.nvmrc`](.nvmrc) (currently `24`).

### 1. Fork the repository

1. Fork the repository on GitHub.
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/memento.git
   cd memento
   ```

### 2. Set up the development environment

Use **npm only** (`engines`: Node.js ≥24, npm ≥10). yarn and pnpm are not supported.

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Run tests
npm run test
```

## 📋 How to contribute

### Bug reports

If you find a bug, open a GitHub Issue with **what you expected**, **how to reproduce it**, and **your environment**. Use a numbered list for repro steps; OS and Node.js version are usually enough for environment.

### Feature proposals

For new features, focus on **which problem you are solving** and **who it is for**. Implementation ideas help the discussion move faster.

### Code contributions

Code PRs usually **align scope in an issue first**, implement on a `feature/` or `fix/` branch, then open a PR with tests and Conventional Commits. The GitHub PR template (`.github/PULL_REQUEST_TEMPLATE.md`) and [PR description example](docs/operations/ko/pr-description-example-npm-workflow.md) (Korean; no EN file yet) speed up review. Compound Engineering (`/ce-compound`) follows the template's **Knowledge compounding** section.

1. **Open an issue** — write scope and acceptance criteria first.
2. **Create a branch** — `feature/<slug>` or `fix/<slug>`.
3. **Implement and test** — add or update Vitest specs.
4. **Commit and PR** — Conventional Commits such as `feat:`, `fix:`, `docs:`.

## 🛠️ Development guidelines

Use TypeScript (Node.js ≥24), 2-space indent, single quotes, and semicolons. Linting follows the repository ESLint config (there is no separate format/Prettier script). Before opening a PR, pass `npm run lint`, `npm run type-check`, and `npm test`.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/). Scopes that name a package or domain are easier to search. There is no commitlint or husky hook; compliance is a **docs and review policy**. Per [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md), **Korean commit descriptions are preferred**.

```
type(scope): description

[optional body]

[optional footer(s)]
```

**Type examples:**
- `feat`: new feature
- `fix`: bug fix
- `docs`: documentation
- `style`: code style (formatting, semicolons, etc.)
- `refactor`: refactoring
- `test`: add or update tests
- `chore`: build process or tooling

**Examples:**
```
feat(search): add hybrid search engine
fix(memory): fix memory leak
docs(readme): update install guide
```

### Testing

Put unit specs (`*.spec.ts`) under each package's `src/` with Vitest. Put workspace and integration scenarios in the root `tests/`. Running `npm run test` for the full suite before a PR is recommended.

### Branch strategy

`main` is the stable release branch. Use `feature/*` for features, `fix/*` for fixes, `docs/*` for docs, and `chore/*` for maintenance.

## 📁 Project structure

This is an npm workspaces monorepo. Domain, DB, and MCP tool logic live in **`packages/memento-core`**; the MCP/HTTP server lives in **`packages/memento-server`**. Root **`tests/`** holds workspace and integration Vitest suites; build, verification, and ops helpers are mainly under **`scripts/`**.

```
packages/
├── memento-core/               # @memento/core — domain logic, DB, MCP tools
├── memento-server/             # MCP stdio + HTTP server
├── memento-client/             # @jee1/memento-client — server client
├── memento-assistant/          # @jee1/memento-assistant — external assistant SDK
└── memento-agent-integration/  # @memento/agent-integration — coding-agent lifecycle
apps/
├── experimental-example/             # @memento/core in-process example
├── experimental-assistant-example/   # memento-assistant SDK example
└── multi-agent-orchestration/        # multi-agent reader/writer reference
scripts/              # build, verification, and ops helpers
tests/                # root workspace integration and quality-gate specs
```

For directory roles in more detail, see [AGENTS.md](AGENTS.md).

## 🔍 Code review process

When a PR opens, CI runs `lint`, `type-check`, and `test`, plus additional gates (security, quality, and so on) depending on the workflow. Merge to `main` after at least one reviewer approval. Apply feedback as commits on the same branch.

## 🐛 Bug fixes

For bug PRs, prefer **repro test → fix → full suite green → update related docs**. If reproduction is hard, leave environment details and logs on the Issue so reviewers can follow along.

## ✨ New features

Align design and acceptance criteria on an Issue first, then include tests, implementation, and user/API docs in the PR. If a public API or MCP tool signature changes, update `docs/api` and the CHANGELOG together.

## 📚 Documentation

When you update docs:
- **Korean first**: write the Korean docs first.
- **English translation**: update English docs when needed.
- **Include examples**: add code samples and usage cases.
- **Stay current**: keep docs in sync with code changes.

## 🤝 Community

- **Issues**: [GitHub Issues](https://github.com/jee1/memento/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jee1/memento/discussions)
- **Docs**: [Wiki](https://github.com/jee1/memento/wiki)

## 📄 License

This project is released under the MIT License. Contributions are licensed under the same terms.

## 🙏 Thanks

Thanks to every contributor. Your work makes Memento better.

---

**Questions? Open an issue or join a discussion anytime.**
