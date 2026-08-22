import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkflow(): string {
  return readFileSync(join(process.cwd(), ".github/workflows/security-check.yml"), "utf-8");
}

function readCiWorkflow(): string {
  return readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
}

describe("security-check workflow", () => {
  it("runs lint without forwarding positional args into nested npm scripts", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("- name: ESLint Security Check");
    expect(workflow).toContain("run: npm run lint");
    expect(workflow).not.toContain("npm run lint -- --max-warnings 500");
  });
});

describe("CI workflow", () => {
  it("runs lint truthfully without masking failures or forwarding arguments", () => {
    const workflow = readCiWorkflow();

    expect(workflow).toContain("- run: npm run lint");
    expect(workflow).not.toContain("|| echo");
    expect(workflow).not.toContain("npm run lint -- --max-warnings 0");
  });

  it("runs the restored fast package and scripts test lanes", () => {
    const workflow = readCiWorkflow();

    expect(workflow).toContain("test-agent-integration:");
    expect(workflow).toContain("npm run test:ci -w @memento/agent-integration");
    expect(workflow).toContain("test-assistant:");
    expect(workflow).toContain("npm run test:ci -w @jee1/memento-assistant");
    expect(workflow).toContain("test-scripts:");
    expect(workflow).toContain("npm run test:ci:scripts");
  });

  it("keeps scripts fast lane pattern-based and assistant CI truthful", () => {
    const rootPkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf-8")
    ) as { scripts: Record<string, string> };
    const assistantPkg = JSON.parse(
      readFileSync(join(process.cwd(), "packages/memento-assistant/package.json"), "utf-8")
    ) as { scripts: Record<string, string> };

    expect(rootPkg.scripts["test:ci:scripts"]).toContain("scripts");
    expect(rootPkg.scripts["test:ci:scripts"]).not.toContain("acquire-longmemeval.spec.ts");
    expect(assistantPkg.scripts["test:ci"]).toContain("vitest --run src");
    expect(assistantPkg.scripts["test:ci"]).not.toContain("--passWithNoTests");
  });
});
