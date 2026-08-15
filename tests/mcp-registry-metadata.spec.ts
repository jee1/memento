import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), "utf-8")) as T;
}

interface ServerJson {
  $schema: string;
  name: string;
  description: string;
  version: string;
  packages: Array<{
    registryType: string;
    registryBaseUrl: string;
    identifier: string;
    version: string;
    transport: { type: string };
  }>;
}

interface RootPackageJson {
  name: string;
  version: string;
  mcpName?: string;
}

describe("MCP registry metadata (#763)", () => {
  const server = readJson<ServerJson>("server.json");
  const pkg = readJson<RootPackageJson>("package.json");

  it("server.json name matches package.json mcpName under the io.github.jee1 namespace", () => {
    expect(pkg.mcpName).toBe("io.github.jee1/memento-mcp-server");
    expect(server.name).toBe(pkg.mcpName);
  });

  it("declares the published npm package on the official registry base url", () => {
    const npmPackage = server.packages.find((entry) => entry.registryType === "npm");
    expect(npmPackage).toBeDefined();
    expect(npmPackage?.identifier).toBe(pkg.name);
    expect(npmPackage?.registryBaseUrl).toBe("https://registry.npmjs.org");
    expect(npmPackage?.transport.type).toBe("stdio");
  });

  it("keeps server.json versions aligned with package.json (release.yml rewrites both)", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0]?.version).toBe(pkg.version);
  });

  it("stays within the registry schema limits", () => {
    expect(server.$schema).toMatch(
      /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/[\d-]+\/server\.schema\.json$/,
    );
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });
});

describe("release workflow registry publish (#763)", () => {
  const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf-8");

  it("grants OIDC permission and authenticates with github-oidc", () => {
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("./mcp-publisher login github-oidc");
    expect(workflow).toContain("./mcp-publisher publish");
  });

  it("rewrites both server.json version fields from the release tag", () => {
    expect(workflow).toContain(
      "jq --arg v \"$VERSION\" '.version = $v | .packages[0].version = $v' server.json",
    );
  });

  it("skips registry publish for pre-releases", () => {
    expect(workflow).toContain("if: steps.version.outputs.npm_tag == 'latest'");
  });
});
