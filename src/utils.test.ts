import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPreviewAlias,
  buildWorkersArgs,
  getWorkerName,
  hasWranglerEnvironment,
  sanitizeBranchName,
  extractDeploymentUrl,
  parseJsonc,
} from "./utils.ts";

describe("sanitizeBranchName", () => {
  it("lowercases the branch name", () => {
    assert.equal(sanitizeBranchName("Feature-Branch"), "feature-branch");
  });

  it("replaces non-alphanumeric characters with hyphens", () => {
    assert.equal(sanitizeBranchName("feat/my_branch"), "feat-my-branch");
  });

  it("collapses consecutive hyphens", () => {
    assert.equal(sanitizeBranchName("a---b"), "a-b");
  });

  it("strips leading hyphens", () => {
    assert.equal(sanitizeBranchName("--leading"), "leading");
  });

  it("strips trailing hyphens", () => {
    assert.equal(sanitizeBranchName("trailing--"), "trailing");
  });

  it("handles typical branch names", () => {
    assert.equal(
      sanitizeBranchName("feature/PROJ-123-add-widget"),
      "feature-proj-123-add-widget",
    );
    assert.equal(
      sanitizeBranchName("dependabot/npm_and_yarn/lodash-4.17.21"),
      "dependabot-npm-and-yarn-lodash-4-17-21",
    );
  });
});

describe("buildPreviewAlias", () => {
  it("fits the alias and Worker name within a DNS label", () => {
    const workerName = "foxglove-app-storybook";
    const alias = buildPreviewAlias("a".repeat(60), workerName);

    assert.equal(`${alias}-${workerName}`.length, 63);
    assert.match(alias, /^a+-[a-f0-9]{4}$/);
  });

  it("uses a hash to distinguish branches with the same prefix", () => {
    const workerName = "foxglove-app-storybook";
    const first = buildPreviewAlias(`${"a".repeat(60)}-one`, workerName);
    const second = buildPreviewAlias(`${"a".repeat(60)}-two`, workerName);

    assert.notEqual(first, second);
  });

  it("makes aliases beginning with a number valid", () => {
    assert.equal(
      buildPreviewAlias("123-feature", "worker"),
      "branch-123-feature",
    );
  });

  it("uses a stable fallback for a branch without valid characters", () => {
    assert.match(buildPreviewAlias("___", "worker"), /^branch-[a-f0-9]{4}$/);
  });

  it("preserves the previous 50-character limit without a Worker name", () => {
    assert.equal(buildPreviewAlias("a".repeat(60)).length, 50);
  });
});

describe("getWorkerName", () => {
  it("returns the top-level Worker name without an environment", () => {
    assert.equal(getWorkerName({ name: "worker" }, ""), "worker");
  });

  it("appends the Wrangler environment to an inherited Worker name", () => {
    assert.equal(
      getWorkerName({ name: "worker", env: { preview: {} } }, "preview"),
      "worker-preview",
    );
  });

  it("uses a Worker name overridden by the Wrangler environment", () => {
    assert.equal(
      getWorkerName(
        { name: "worker", env: { preview: { name: "custom-preview" } } },
        "preview",
      ),
      "custom-preview",
    );
  });
});

describe("buildWorkersArgs", () => {
  it("production with no environment uses bare deploy", () => {
    assert.deepStrictEqual(
      buildWorkersArgs({
        isProduction: true,
        branch: "main",
        environment: "",
      }),
      ["deploy"],
    );
  });

  it("production with environment passes --env", () => {
    assert.deepStrictEqual(
      buildWorkersArgs({
        isProduction: true,
        branch: "main",
        environment: "preview",
      }),
      ["deploy", "--env", "preview"],
    );
  });

  it("preview with no environment omits --env", () => {
    assert.deepStrictEqual(
      buildWorkersArgs({
        isProduction: false,
        branch: "feature/widget",
        environment: "",
        workerName: "worker",
      }),
      ["versions", "upload", "--preview-alias", "feature-widget"],
    );
  });

  it("preview with environment passes --env", () => {
    assert.deepStrictEqual(
      buildWorkersArgs({
        isProduction: false,
        branch: "feature/widget",
        environment: "preview",
        workerName: "worker-preview",
      }),
      [
        "versions",
        "upload",
        "--preview-alias",
        "feature-widget",
        "--env",
        "preview",
      ],
    );
  });

  it("preview sanitizes the branch name into the alias", () => {
    const args = buildWorkersArgs({
      isProduction: false,
      branch: "Feature/PROJ-123",
      environment: "",
      workerName: "worker",
    });
    assert.equal(args[3], "feature-proj-123");
  });
});

describe("hasWranglerEnvironment", () => {
  it("returns false when config is undefined", () => {
    assert.equal(hasWranglerEnvironment(undefined, "preview"), false);
  });

  it("returns false when config has no env field", () => {
    assert.equal(hasWranglerEnvironment({ name: "web" }, "preview"), false);
  });

  it("returns false when env is not an object", () => {
    assert.equal(
      hasWranglerEnvironment({ name: "web", env: "preview" }, "preview"),
      false,
    );
  });

  it("returns false when the requested env is not defined", () => {
    assert.equal(
      hasWranglerEnvironment({ env: { staging: {} } }, "preview"),
      false,
    );
  });

  it("returns true when the requested env is defined as an object", () => {
    assert.equal(
      hasWranglerEnvironment(
        { env: { preview: { vars: { FOO: "bar" } } } },
        "preview",
      ),
      true,
    );
  });

  it("returns true even for an empty env block", () => {
    assert.equal(
      hasWranglerEnvironment({ env: { preview: {} } }, "preview"),
      true,
    );
  });

  it("returns false when the env block is null", () => {
    assert.equal(
      hasWranglerEnvironment({ env: { preview: null } }, "preview"),
      false,
    );
  });
});

describe("extractDeploymentUrl", () => {
  it("extracts a pages.dev URL", () => {
    const output = "Deploying to https://abc123.my-project.pages.dev\nDone!";
    assert.equal(
      extractDeploymentUrl(output),
      "https://abc123.my-project.pages.dev",
    );
  });

  it("extracts a workers.dev URL", () => {
    const output = "Published to https://my-worker.account.workers.dev";
    assert.equal(
      extractDeploymentUrl(output),
      "https://my-worker.account.workers.dev",
    );
  });

  it("returns the last URL when multiple are present", () => {
    const output = [
      "Uploading to https://upload.pages.dev",
      "Preview: https://preview-abc.my-project.pages.dev",
    ].join("\n");
    assert.equal(
      extractDeploymentUrl(output),
      "https://preview-abc.my-project.pages.dev",
    );
  });

  it("returns undefined when no URL matches", () => {
    assert.equal(extractDeploymentUrl("No URLs here"), undefined);
    assert.equal(extractDeploymentUrl(""), undefined);
  });
});

describe("parseJsonc", () => {
  it("parses plain JSON", () => {
    assert.deepStrictEqual(parseJsonc('{"a": 1}'), { a: 1 });
  });

  it("strips single-line comments", () => {
    const input = `{
      // this is a comment
      "name": "hello"
    }`;
    assert.deepStrictEqual(parseJsonc(input), { name: "hello" });
  });

  it("strips block comments", () => {
    const input = `{
      /* block comment */
      "key": "value"
    }`;
    assert.deepStrictEqual(parseJsonc(input), { key: "value" });
  });

  it("strips multi-line block comments", () => {
    const input = `{
      /*
       * multi
       * line
       */
      "x": true
    }`;
    assert.deepStrictEqual(parseJsonc(input), { x: true });
  });

  it("does not strip comment-like content inside strings", () => {
    const input = `{"url": "https://example.com // not a comment"}`;
    assert.deepStrictEqual(parseJsonc(input), {
      url: "https://example.com // not a comment",
    });
  });

  it("handles trailing commas via stripped comments", () => {
    const input = `{
      "a": 1, // trailing comment after comma
      "b": 2
    }`;
    assert.deepStrictEqual(parseJsonc(input), { a: 1, b: 2 });
  });

  it("strips trailing commas", () => {
    const input = `{
      "a": 1,
      "b": [1, 2, 3,],
    }`;
    assert.deepStrictEqual(parseJsonc(input), { a: 1, b: [1, 2, 3] });
  });

  it("strips trailing commas with comments", () => {
    const input = `{
      "name": "web",
      "assets": {
        "directory": "./dist", // trailing comma after value
      }, // trailing comma after object
    }`;
    assert.deepStrictEqual(parseJsonc(input), {
      name: "web",
      assets: { directory: "./dist" },
    });
  });

  it("parses a real wrangler.jsonc with trailing commas and comments", () => {
    const input = `{
      // Wrangler config
      "$schema": "./node_modules/wrangler/config-schema.json",
      "name": "web",
      "compatibility_date": "2026-01-01",
      "assets": {
        "directory": "./dist", /* output dir */
      },
    }`;
    assert.deepStrictEqual(parseJsonc(input), {
      $schema: "./node_modules/wrangler/config-schema.json",
      name: "web",
      compatibility_date: "2026-01-01",
      assets: { directory: "./dist" },
    });
  });

  it("returns empty object for non-object JSON values", () => {
    assert.deepStrictEqual(parseJsonc("[]"), {});
    assert.deepStrictEqual(parseJsonc('"hello"'), {});
    assert.deepStrictEqual(parseJsonc("42"), {});
    assert.deepStrictEqual(parseJsonc("null"), {});
  });

  it("throws on invalid JSON", () => {
    assert.throws(() => parseJsonc("{invalid}"));
  });

  it("handles empty object", () => {
    assert.deepStrictEqual(parseJsonc("{}"), {});
  });

  it("handles nested objects", () => {
    const input = `{
      // top-level comment
      "outer": {
        /* inner comment */
        "inner": 42
      }
    }`;
    assert.deepStrictEqual(parseJsonc(input), { outer: { inner: 42 } });
  });
});
