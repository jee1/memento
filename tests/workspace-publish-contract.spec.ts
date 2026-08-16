import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  files?: string[];
  publishConfig?: { access?: string };
  dependencies?: Record<string, string>;
}

function readPkg(relativeDir: string): PackageJson {
  return JSON.parse(readFileSync(join(root, relativeDir, "package.json"), "utf-8")) as PackageJson;
}

const PUBLISHED = ["packages/memento-client", "packages/memento-assistant"];

describe("workspace publish contract (#765)", () => {
  it("published SDK packages live under the owned @jee1 scope", () => {
    // @memento scope는 타인 소유(npm, 2018~)라 사용할 수 없다.
    expect(readPkg("packages/memento-client").name).toBe("@jee1/memento-client");
    expect(readPkg("packages/memento-assistant").name).toBe("@jee1/memento-assistant");
  });

  it.each(PUBLISHED)("%s is publishable with public access and a LICENSE", (dir) => {
    const pkg = readPkg(dir);
    expect(pkg.private).toBeUndefined();
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.files).toContain("LICENSE");
    expect(existsSync(join(root, dir, "LICENSE"))).toBe(true);
  });

  it("assistant pins a published client range that matches the client version", () => {
    const assistant = readPkg("packages/memento-assistant");
    // "*"는 npm 발행 시 그대로 나가 임의 버전을 끌어온다.
    expect(assistant.dependencies?.["@jee1/memento-client"]).toBe(
      `^${readPkg("packages/memento-client").version}`,
    );
  });

  it("internal packages stay private so they are never published", () => {
    expect(readPkg("packages/memento-core").private).toBe(true);
    expect(readPkg("packages/memento-server").private).toBe(true);
    expect(readPkg("packages/memento-agent-integration").private).toBe(true);
  });

  it("release workflow publishes client before assistant, stable releases only", () => {
    const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf-8");
    const step = workflow.slice(workflow.indexOf("Publish workspace SDK packages to npm"));

    expect(step).toContain("if: steps.version.outputs.npm_tag == 'latest'");
    expect(step.indexOf("packages/memento-client:@jee1/memento-client")).toBeLessThan(
      step.indexOf("packages/memento-assistant:@jee1/memento-assistant"),
    );
    // 같은 버전 재발행은 릴리스를 실패시키므로 건너뛴다.
    expect(step).toContain('if npm view "$PKG@$PKG_VERSION" version');
  });
});
