import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), "utf-8")) as T;
}

interface Marketplace {
  name: string;
  owner: { name: string };
  plugins: Array<{ name: string; source: string }>;
}

interface PluginManifest {
  name: string;
  version?: string;
}

interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
}

describe("Claude Code plugin marketplace (#764)", () => {
  const marketplace = readJson<Marketplace>(".claude-plugin/marketplace.json");
  const entry = marketplace.plugins[0]!;
  const pluginDir = entry.source.replace(/^\.\//, "");

  it("lists the memento plugin from a source directory that exists", () => {
    expect(marketplace.name).toBe("memento");
    expect(marketplace.owner.name).toBeTruthy();
    expect(entry.name).toBe("memento");
    expect(existsSync(join(root, pluginDir, ".claude-plugin/plugin.json"))).toBe(true);
  });

  it("pins a plugin version so users receive updates", () => {
    // 버전이 없으면 claude plugin validate --strict 가 실패한다.
    const plugin = readJson<PluginManifest>(join(pluginDir, ".claude-plugin/plugin.json"));
    expect(plugin.name).toBe(entry.name);
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("launches the published npm server and keeps the database in plugin data", () => {
    const mcp = readJson<McpConfig>(join(pluginDir, ".mcp.json"));
    const server = mcp.mcpServers.memento;

    expect(server).toBeDefined();
    expect(server?.command).toBe("npx");
    expect(server?.args).toContain("memento-mcp-server@latest");
    // 플러그인 업데이트 시 DB가 날아가지 않도록 CLAUDE_PLUGIN_DATA 아래에 둔다.
    expect(server?.env?.DB_PATH).toBe("${CLAUDE_PLUGIN_DATA}/memory.db");
  });

  it("ships the recall→remember loop skill with a matching frontmatter name", () => {
    const skillPath = join(pluginDir, "skills/memento-memory-loop/SKILL.md");
    const skill = readFileSync(join(root, skillPath), "utf-8");

    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toContain("name: memento-memory-loop");
    expect(skill).toMatch(/^description: .+/m);
    expect(skill).toContain("recall");
    expect(skill).toContain("remember");
  });
});
