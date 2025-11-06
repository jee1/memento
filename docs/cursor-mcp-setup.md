# Cursor MCP Setup Guide

How to configure Memento MCP Server in Cursor.

## 🚨 Troubleshooting: "Cannot destructure property 'package' of 'node.target' as it is null"

This error can occur when using `npx -y memento-mcp-server@latest` due to an internal npm error.

> **Latest Update**: We've improved the package by adding `prepublishOnly` scripts and bin file validation to ensure builds are guaranteed during npm publish. Future versions should work more reliably.

## ✅ Solutions

### Method 1: Use Local Path (Recommended) ⭐

Use the built files from your locally cloned project directly.

#### 1. Build the Project

```bash
# From the project directory
cd /path/to/memento
npm install
npm run build
```

#### 2. Configure Cursor MCP

Add the following to your Cursor settings file or `.cursor/mcp.json`:

**Windows:**
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\username\\git\\memento\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "C:\\Users\\username\\git\\memento\\data\\memory.db"
      }
    }
  }
}
```

**Linux/macOS:**
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["/home/username/git/memento/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "/home/username/git/memento/data/memory.db"
      }
    }
  }
}
```

> **Note**: Change the paths to match your actual project path.

### Method 2: Direct Execution with npx (Simple Method)

Use npx to run the package directly without downloading it first.

#### Cursor MCP Configuration

Add the following to your Cursor settings file or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "./data/memory.db"
      }
    }
  }
}
```

> **DB_PATH Configuration Notes**:
> - Default value: `./data/memory.db` (relative to current working directory)
> - Windows absolute path example: `"DB_PATH": "C:\\Users\\username\\memento\\data\\memory.db"`
> - Linux/macOS absolute path example: `"DB_PATH": "/home/username/memento/data/memory.db"`
> - Relative paths may vary depending on the working directory when npx runs, so using absolute paths is recommended.

> **Notes**: 
> - The `-y` flag automatically accepts package installation prompts.
> - `@latest` uses the latest version. You can specify a version like `@1.0.0` if needed.
> - The package will be automatically downloaded on first run.

#### Advantages
- No separate installation process required
- Always uses the latest version
- Can be used without global installation

#### Disadvantages
- May take time to download on first run
- May fail due to npm cache issues (see Method 4 for troubleshooting)

### Method 3: Global Installation

#### 1. Global Installation

```bash
npm install -g memento-mcp-server
```

#### 2. Cursor MCP Configuration

```json
{
  "mcpServers": {
    "memento": {
      "command": "memento-mcp-server",
      "env": {
        "DB_PATH": "./data/memory.db"
      }
    }
  }
}
```

> **DB_PATH Configuration Note**: It's recommended to explicitly set DB_PATH even with global installation. Using absolute paths is recommended.

### Method 4: Troubleshooting (npm Cache Cleanup)

If you encounter the "Cannot destructure property 'package' of 'node.target' as it is null" error when using npx:

```bash
# Clear npm cache
npm cache clean --force

# Check Node.js version (requires 20 or higher)
node --version

# Try again
npx -y memento-mcp-server@latest
```

If the problem persists, we recommend Method 1 (using local path).

## 📋 Detailed Configuration Examples

### Windows (Complete Example)

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\username\\git\\memento\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "C:\\Users\\username\\git\\memento\\data\\memory.db"
      }
    }
  }
}
```

### Using Relative Path (Within Project)

Create a `.cursor/mcp.json` file in the project root:

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["./dist/server/index.js"],
      "cwd": "C:\\Users\\username\\git\\memento",
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "./data/memory.db"
      }
    }
  }
}
```

> **Note**: Since `cwd` is set, `DB_PATH` can use a relative path. However, using absolute paths is recommended.

## 🔍 Troubleshooting

### 1. Verify Build

```bash
# Windows
dir dist\server\index.js

# Linux/macOS
ls -la dist/server/index.js
```

### 2. Direct Execution Test

```bash
# From the project directory
node dist/server/index.js
```

If it runs successfully, the MCP server has started.

### 3. Check Node.js Version

```bash
node --version  # Should be 20.0.0 or higher
```

### 4. Verify Dependencies

```bash
npm install
npm run build
```

## 🎯 Recommended Setup Steps

1. ✅ Clone the project (already done)
   ```bash
   cd /path/to/memento
   ```

2. ✅ Install dependencies and build
   ```bash
   npm install
   npm run build
   ```

3. ✅ Add local path to Cursor settings
   - Cursor Settings → MCP Servers
   - Or create a `.cursor/mcp.json` file

4. ✅ Restart Cursor

5. ✅ Test connection

## 💡 Additional Tips

### Environment Variable Configuration

If you need specific environment variables:

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\username\\git\\memento\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "C:\\Users\\username\\git\\memento\\data\\memory.db",
        "OPENAI_API_KEY": "your-key-here",
        "GEMINI_API_KEY": "your-key-here",
        "EMBEDDING_PROVIDER": "minilm",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

#### Key Environment Variables

- **DB_PATH** (Recommended): Database file path
  - Default: `./data/memory.db`
  - Windows example: `C:\\Users\\username\\memento\\data\\memory.db`
  - Linux/macOS example: `/home/username/memento/data/memory.db`
  - Using absolute paths is recommended (relative paths may vary depending on execution location)

- **NODE_ENV**: Execution environment (`development` or `production`)
- **OPENAI_API_KEY**: OpenAI API key (when using OpenAI embeddings)
- **GEMINI_API_KEY**: Google Gemini API key (when using Gemini embeddings)
- **EMBEDDING_PROVIDER**: Embedding provider (`tfidf`, `lightweight`, `minilm`, `openai`, `gemini`)
- **LOG_LEVEL**: Log level (`debug`, `info`, `warn`, `error`)

### Debug Mode

If you're developing, you can run the source file directly:

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "tsx", "src/server/index.ts"],
      "cwd": "C:\\Users\\username\\git\\memento",
      "env": {
        "NODE_ENV": "development",
        "DB_PATH": "C:\\Users\\username\\git\\memento\\data\\memory.db",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

## ⚠️ Important Notes

- On Windows, you must escape backslashes (`\`) by using two backslashes (`\\`).
- Using absolute paths is most reliable.
- The `npx` method is convenient but may fail due to npm cache issues. In such cases, we recommend Method 1 (using local path).
- Method 2 (npx) requires an internet connection as it downloads the package on first run.
- **DB_PATH Configuration**: It's recommended to explicitly set the database file path. If not set, the default value (`./data/memory.db`) will be used, but the database may be created in an unexpected location depending on the execution location.
- **Database Directory**: If the directory specified in DB_PATH doesn't exist, it will be created automatically. However, write permissions are required, so specify an appropriate location.
