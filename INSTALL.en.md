# 🚀 Memento MCP Server Installation Guide

<div align="center">
  [🇰🇷 한국어](INSTALL.md) | [🇺🇸 English](INSTALL.en.md)
</div>

Provides various installation methods for the AI Agent Memory Assistant MCP Server.

How you install Memento depends on **how fast you want to try it** and **how much of the stack you want to control**. The one-click script is fastest; npx runs without cloning; Docker fits teams; source is for contributors. Pick a path below and follow it through.

## 📋 Installation Method Selection

### 🧩 **Claude Code users: install the plugin**
```
/plugin marketplace add jee1/memento
/plugin install memento@memento
```
This registers the MCP server and ships a skill for the `recall` → `remember` loop. The memory database lives at `${CLAUDE_PLUGIN_DATA}/memory.db` and survives plugin updates.

Four MCP tools are advertised by default: `recall`, `remember`, `memory_injection`, and `feedback`. To reach the rest — anchors, procedural versioning, introspection — add `MEMENTO_TOOLSET=full` to the `memento` server's `env` block in your user or project MCP config (edits to the plugin's own `.mcp.json` are lost on update).

### 🥇 **1st Priority: One-click Installation (Recommended)**
```bash
# Run automatic installation script
curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash
```

### 🥈 **2nd Priority: npx Method (For Developers)**
```bash
# Run immediately (without installation)
npx memento-mcp-server@latest dev

# Auto setup then run
npx memento-mcp-server@latest setup
npx memento-mcp-server@latest start
```

### 🥉 **3rd Priority: Docker Method (For Production)**
```bash
# Development environment
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml up -d

# Production environment
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml up -d
```

### 🛠️ **4th Priority: Source Code Method (For Developers)**
```bash
# Clone repository
git clone https://github.com/jee1/memento.git
cd memento

# One-click installation and run
npm run quick-start
```

## 🎯 Recommended Installation Method by User Type

**Developers and researchers** usually prefer npx or a source clone so they can debug and patch quickly. **General users** can start with the one-click script or Docker when they mainly want a stable server. **Teams and organizations** should standardize on Docker so everyone runs the same image and the same `memory.db` mount policy.

## 📚 Detailed Installation Methods

### 1. One-click Installation

#### Linux/macOS
```bash
curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash
```

#### Windows (PowerShell)
```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/jee1/memento/main/install.sh" -OutFile "install.sh"
bash install.sh
```

### 2. npx Method

#### Basic Usage
```bash
# Development mode (hot reload)
npx memento-mcp-server@latest dev

# Production mode
npx memento-mcp-server@latest start

# HTTP/WebSocket server
npx memento-mcp-server@latest dev-http

# Auto setup
npx memento-mcp-server@latest setup
```

#### Global Installation
```bash
# Global installation
npm install -g memento-mcp-server

# Usage
memento-mcp-server dev
memento-mcp-server start
memento-mcp-server setup
```

### 3. Docker Method

#### Development Environment
```bash
# Run development Docker Compose
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml up -d

# Check logs
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml logs -f

# Stop
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml down
```

#### Production Environment
```bash
# Run production Docker Compose
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml up -d

# Check logs
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml logs -f

# Stop
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml down
```

#### Basic Docker Compose
```bash
# Basic run (production mode)
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop
docker-compose down
```

### 4. Source Code Method

#### Basic Installation
```bash
# Clone repository
git clone https://github.com/jee1/memento.git
cd memento

# Install dependencies
npm install

# Auto setup
npm run setup

# Start development server
npm run dev
```

#### One-click Installation
```bash
# All processes in one command
npm run quick-start
```

## ⚙️ Environment Configuration

### Environment Variable Setup
```bash
# Create .env file
cp env.example .env

# Set API keys (optional)
# OPENAI_API_KEY=your_openai_api_key_here
# GEMINI_API_KEY=your_gemini_api_key_here
```

### Database Initialization
```bash
# Initialize SQLite database
npm run db:init

# Run migrations
npm run db:migrate
```

## 🔧 Available Commands

### Development Commands
```bash
npm run dev              # MCP server development mode
npm run dev:http         # HTTP/WebSocket server development mode
```

### Production Commands
```bash
npm run build            # TypeScript compilation
npm run start            # MCP server production run
npm run start:http       # HTTP/WebSocket server production run
```

### Test Commands
```bash
npm run test             # Run all tests
npm run test:ci:core     # Core search, embedding, and memory tests
npm run test:ci:server   # Server and monitoring tests
npm test -w @jee1/memento-client # Client tests
npm run benchmark:consolidation-quality # Consolidation Score benchmark
```

### Docker Commands
```bash
npm run docker:dev       # Run development Docker
npm run docker:prod      # Run production Docker
npm run docker:build     # Build Docker image
npm run docker:logs      # Check Docker logs
```

### Utility Commands
```bash
npm run setup            # Run auto setup
npm run quick-start      # One-click installation and run
npm run backup:embeddings # Backup embeddings
npm run regenerate:embeddings # Regenerate embeddings
```

## 🌐 Access Information

After installation, you can access the following addresses:

- **MCP Server**: `stdio` or `http://localhost:9001/mcp`
- **HTTP API**: `http://localhost:9001`
- **WebSocket**: `ws://localhost:9001`
- **Admin Dashboard**: `http://localhost:9001/dashboard`

## 🪟 Platform-Specific Execution

### Windows

#### PowerShell/CMD
```powershell
# npx method (recommended)
npx memento-mcp-server@latest dev
npx memento-mcp-server@latest setup

# Using npm exec
npm exec -- memento-mcp-server@latest dev

# After global installation
npm install -g memento-mcp-server
memento-mcp-server dev
```

#### WSL (Windows Subsystem for Linux)
```bash
# Same as Linux
npx memento-mcp-server@latest dev
```

### Linux/macOS

```bash
# npx method (recommended)
npx memento-mcp-server@latest dev
npx memento-mcp-server@latest setup

# Using npm exec
npm exec -- memento-mcp-server@latest dev

# After global installation
npm install -g memento-mcp-server
memento-mcp-server dev
```

### Platform Differences

| Item | Windows | Linux/macOS |
|------|---------|-------------|
| Path separator | `\` | `/` |
| Execution permissions | Auto-handled | Requires `chmod +x` |
| Shebang | Ignored (npm handles) | Used |
| npm exec | Requires explicit command | Requires explicit command |
| npx | Recommended | Recommended |

## 🚨 Troubleshooting

### Common Issues

#### 1. npm exec Error: "could not determine executable to run"

**Cause**: npm exec requires you to explicitly specify the command to run.

**Solution**:
```bash
# ❌ Incorrect usage
npm exec memento-mcp-server@latest

# ✅ Correct usage
npm exec -- memento-mcp-server@latest dev
npm exec -- memento-mcp-server@latest setup

# Or use npx (recommended)
npx memento-mcp-server@latest dev
```

#### 2. Node.js Version Error
```bash
# Node.js 24+ required (package.json engines: >=24)
node --version

# Install Node.js with nvm (Linux/macOS)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 24
nvm use 24
```

#### 2. Port Conflict
```bash
# If port 9001 is in use
# Change PORT / MCP_SERVER_PORT in .env file
PORT=9002
```

#### 3. Database Error
```bash
# Reinitialize database
rm -rf data/memory.db*
npm run db:init
```

#### 4. Docker Error
```bash
# Complete Docker container cleanup
docker-compose down -v
docker system prune -a
docker-compose up -d
```

### Log Checking
```bash
# Application logs
tail -f logs/memento-server.log

# Docker logs
docker-compose logs -f

# System logs (Linux)
journalctl -u memento-mcp-server -f
```

## 📞 Support

- **Issue Reports**: [GitHub Issues](https://github.com/jee1/memento/issues)
- **Documentation**: [Wiki](https://github.com/jee1/memento/wiki)
- **Developer Guide**: [docs/guides/en/developer-guide.md](docs/guides/en/developer-guide.md)
- **API Reference**: [docs/api/en/api-reference.md](docs/api/en/api-reference.md)

## 🎉 Installation Complete!

After installation, proceed with the following steps:

1. **Check Server Status**: `http://localhost:9001/health`
2. **Connect MCP Client**: [Client Guide](packages/memento-client/README.md)
3. **Test API**: [API Documentation](docs/api/en/api-reference.md)
4. **Learn Usage**: [User Manual](docs/guides/en/user-manual.md)

---

**💡 Tip**: For first-time users, you can complete all setup automatically with the `npm run quick-start` command!
