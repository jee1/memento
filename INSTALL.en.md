# 🚀 Memento MCP Server Installation Guide

<div align="center">
  [🇰🇷 한국어](INSTALL.md) | [🇺🇸 English](INSTALL.en.md)
</div>

Provides various installation methods for the AI Agent Memory Assistant MCP Server.

## 📋 Installation Method Selection

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
docker-compose -f docker-compose.dev.yml up -d

# Production environment
docker-compose -f docker-compose.prod.yml up -d
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

### 👨‍💻 **Developers/Researchers**
- **npx method** or **source code method** recommended
- Optimized for rapid prototyping and debugging

### 👤 **General Users**
- **One-click installation** or **Docker method** recommended
- Simple installation and stable execution

### 🏢 **Teams/Organizations**
- **Docker method** required
- Standardized deployment and scalability

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
memento-mcp dev
memento-mcp start
memento-mcp setup
```

### 3. Docker Method

#### Development Environment
```bash
# Run development Docker Compose
docker-compose -f docker-compose.dev.yml up -d

# Check logs
docker-compose -f docker-compose.dev.yml logs -f

# Stop
docker-compose -f docker-compose.dev.yml down
```

#### Production Environment
```bash
# Run production Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# Check logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop
docker-compose -f docker-compose.prod.yml down
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
npm run dev:http-v2      # HTTP server v2 development mode
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
npm run test:client      # Client tests
npm run test:search      # Search functionality tests
npm run test:embedding   # Embedding functionality tests
npm run test:lightweight-embedding # Lightweight embedding tests
npm run test:gemini-embedding # Gemini embedding tests
npm run test:forgetting  # Forgetting policy tests
npm run test:performance # Performance benchmarks
npm run test:monitoring  # Performance monitoring tests
npm run test:error-logging # Error logging tests
npm run test:performance-alerts # Performance alert tests
npm run test:vector-search # Vector search tests
npm run test:memory-injection # Memory injection tests
npm run test:batch-scheduler # Batch scheduler tests
npm run test:consolidation-quality # Consolidation Score quality validation
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

- **MCP Server**: `stdio` or `ws://localhost:8080/mcp`
- **HTTP API**: `http://localhost:8080`
- **WebSocket**: `ws://localhost:8080`
- **Admin Dashboard**: `http://localhost:8080/admin`

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
# Node.js 20+ required
node --version

# Install Node.js with nvm (Linux/macOS)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

#### 2. Port Conflict
```bash
# If port 8080 is in use
# Change PORT in .env file
PORT=8081
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

1. **Check Server Status**: `http://localhost:8080/health`
2. **Connect MCP Client**: [Client Guide](packages/mcp-client/README.md)
3. **Test API**: [API Documentation](docs/api/en/api-reference.md)
4. **Learn Usage**: [User Manual](docs/guides/en/user-manual.md)

---

**💡 Tip**: For first-time users, you can complete all setup automatically with the `npm run quick-start` command!
