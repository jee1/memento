# GEMINI.md

## Project Overview

Memento is an intelligent memory management system for AI agents, designed to mimic human memory structures. It functions as a Model Context Protocol (MCP) server, enabling AI agents to store, retrieve, and manage long-term memory effectively.

The project is built with Node.js and TypeScript, utilizing SQLite for the database. The core of Memento lies in its sophisticated hybrid search capabilities, which combine traditional text-based search (FTS5) with modern vector-based semantic search. This allows for more nuanced and context-aware memory retrieval.

Other key features include:
-   **Forgetting Policies:** An algorithm that manages memory decay based on recency, frequency, and importance.
-   **Performance Monitoring:** A built-in system for tracking database performance, search speed, and memory usage.
-   **Multiple Embedding Providers:** Support for various embedding services like OpenAI, Gemini, and a lightweight TF-IDF model.
-   **Docker Support:** Comes with Docker configurations for easy deployment in both development and production environments.

**Repository guidelines:** [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) (full dev rules). Agent entry summary — [AGENTS.md](./AGENTS.md).

## Building and Running

### Prerequisites
-   Node.js (>=20.0.0)
-   npm

### Installation
```bash
npm install
```

### Running the Development Server
To start the server in development mode with hot-reloading:
```bash
npm run dev
```
The server will be available at `http://localhost:9001`.

### Building for Production
To build the project for production:
```bash
npm run build
```
This will compile the TypeScript code into JavaScript in the `dist` directory.

### Running in Production
To start the server in production mode:
```bash
npm run start
```

### Running with Docker
To run the project using Docker:
```bash
# For development
docker-compose -f docker-compose.dev.yml up -d

# For production
docker-compose -f docker-compose.prod.yml up -d
```

## Testing

To run the entire test suite:
```bash
npm run test
```

To run tests in watch mode:
```bash
npm run test -- --watch
```

To generate a test coverage report:
```bash
npm run test -- --coverage
```

## Development Conventions

### Code Style
-   The project follows the standard TypeScript and Node.js conventions.
-   Code is formatted with 2-space indentation.
-   ES Modules are used for imports and exports.

### Testing
-   Tests are written using the [Vitest](https://vitest.dev/) framework.
-   Test files are located alongside the source files with a `.spec.ts` or `.test.ts` extension.
-   The project aims for high test coverage.

### Commits and Pull Requests
-   Commit messages should follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.
-   Pull requests should be detailed and include a clear description of the changes.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
