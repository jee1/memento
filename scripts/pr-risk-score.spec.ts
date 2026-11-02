import { describe, expect, it } from "vitest";
import {
  keepHigherLabel,
  parseNumstat,
  renderMarkdown,
  scoreRisk,
} from "./pr-risk-score.js";

const file = (path: string, additions = 10, deletions = 0) => ({
  path,
  additions,
  deletions,
});

describe("scoreRisk", () => {
  it("문서만 바뀐 PR 은 0점 low", () => {
    const result = scoreRisk([file("docs/agents/commands.md", 300)]);
    expect(result.score).toBe(0);
    expect(result.level).toBe("low");
  });

  it("테스트를 동반한 작은 소스 수정은 low", () => {
    const result = scoreRisk([
      file("packages/memento-core/src/domains/memory/foo.ts", 20),
      file("packages/memento-core/src/domains/memory/foo.spec.ts", 30),
    ]);
    expect(result.score).toBe(0);
  });

  it("테스트 없는 소스 수정은 테스트 15점", () => {
    const result = scoreRisk([
      file("packages/memento-core/src/domains/memory/foo.ts", 20),
    ]);
    expect(result.factors.find((f) => f.name === "테스트")?.points).toBe(15);
  });

  it("인증 경로 + 마이그레이션 + 공개 계약 + 대형 diff 는 high", () => {
    const result = scoreRisk(
      [
        file(
          "packages/memento-server/src/server/auth/token-guard.ts",
          400,
          200,
        ),
        file(
          "packages/memento-core/src/infrastructure/database/sqlite/migration/migrations/042-x.sql",
          10,
        ),
        file("packages/memento-core/src/tools/recall.ts", 5),
      ],
      "feat(server)!: rotate tokens",
    );
    expect(result.score).toBe(100);
    expect(result.level).toBe("high");
  });

  it("테스트 파일의 보안 키워드는 보안 점수를 올리지 않는다", () => {
    const result = scoreRisk([
      file("packages/memento-server/src/test/token-auth.spec.ts"),
    ]);
    expect(result.factors.find((f) => f.name === "보안")?.points).toBe(0);
  });

  it("제목의 breaking 표기는 파괴적 변경 20점", () => {
    expect(
      scoreRisk([], "refactor(quality)!: drop metric").factors.find(
        (f) => f.name === "파괴적 변경",
      )?.points,
    ).toBe(20);
  });
});

describe("검색 경로 최소 medium", () => {
  const core = "packages/memento-core/src";

  it.each([
    `${core}/domains/search/repositories/vector-search/vector-search-knn-query.ts`,
    `${core}/domains/search/repositories/vector-search.repository.ts`,
    `${core}/domains/search/algorithms/search-engine/search-engine-sql-builder.ts`,
    `${core}/domains/search/algorithms/hybrid-result-ranker.ts`,
    `${core}/domains/search/services/relevance-gate/rejection-gate.ts`,
    `${core}/shared/utils/memory-filter-sql.ts`,
  ])("%s 동작 코드 변경은 0점이어도 medium", (path) => {
    const result = scoreRisk([
      file(path, 5),
      file(`${path.replace(/\.ts$/, ".spec.ts")}`, 5),
    ]);
    expect(result.score).toBe(0);
    expect(result.level).toBe("medium");
  });

  it("검색 경로의 테스트만 바뀌면 low", () => {
    const result = scoreRisk([
      file(
        `${core}/domains/search/repositories/vector-search/vector-search-knn-query.spec.ts`,
      ),
    ]);
    expect(result.level).toBe("low");
  });

  it("검색 경로가 high 점수와 겹치면 high 를 낮추지 않는다", () => {
    const result = scoreRisk(
      [
        file(`${core}/shared/utils/memory-filter-sql.ts`, 600),
        file(`${core}/tools/recall.ts`, 5),
        file(`${core}/domains/x/migrations/001.sql`, 5),
      ],
      "feat!: x",
    );
    expect(result.level).toBe("high");
  });
});

describe("keepHigherLabel", () => {
  const low = scoreRisk([]);

  it("수동 medium 이 있으면 low 점수여도 medium 유지, 점수 등급을 남긴다", () => {
    const kept = keepHigherLabel(low, ["bug", "risk:medium"]);
    expect(kept.level).toBe("medium");
    expect(kept.scoredLevel).toBe("low");
    expect(renderMarkdown(kept)).toContain("risk:medium 라벨을 유지한다");
  });

  it("점수가 더 높으면 점수를 따른다", () => {
    const result = scoreRisk([
      file("packages/memento-server/src/auth/token.ts"),
    ]);
    expect(result.level).toBe("medium");
    const kept = keepHigherLabel(result, ["risk:low"]);
    expect(kept).toBe(result);
  });

  it("라벨이 없거나 risk 라벨이 아니면 점수 그대로", () => {
    expect(keepHigherLabel(low, [""])).toBe(low);
    expect(keepHigherLabel(low, ["risk:bogus", "bug"])).toBe(low);
  });

  it("수동 high 도 유지한다", () => {
    expect(keepHigherLabel(low, ["risk:high"]).level).toBe("high");
  });
});

describe("parseNumstat", () => {
  it('바이너리 "-" 와 탭 포함 경로를 처리한다', () => {
    expect(parseNumstat("3\t1\ta.ts\n-\t-\timg.png\n")).toEqual([
      { path: "a.ts", additions: 3, deletions: 1 },
      { path: "img.png", additions: 0, deletions: 0 },
    ]);
  });
});

describe("renderMarkdown", () => {
  it("sticky 마커와 레벨을 포함한다", () => {
    const md = renderMarkdown(scoreRisk([]));
    expect(md).toContain("<!-- pr-risk-score -->");
    expect(md).toContain("**low**");
  });
});
