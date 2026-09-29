import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkersArgs,
  hasWranglerEnvironment,
  maxAliasLength,
  sanitizeBranchName,
  workerScriptName,
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

  it("truncates to 50 characters by default", () => {
    const long = "a".repeat(60);
    assert.equal(sanitizeBranchName(long).length, 50);
  });

  it("truncates to a custom maxLength", () => {
    const long = "a".repeat(60);
    assert.equal(sanitizeBranchName(long, 20).length, 20);
  });

  it("strips trailing hyphens after truncation", () => {
    const input = "a".repeat(49) + "---extra";
    const result = sanitizeBranchName(input);
    assert.ok(result.length <= 50);
    assert.ok(!result.endsWith("-"));
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

describe("maxAliasLength", () => {
  it("defaults to 50 when the worker name is unknown", () => {
    assert.equal(maxAliasLength(undefined), 50);
    assert.equal(maxAliasLength(""), 50);
  });

  it("keeps alias, hyphen, and script name at 62 characters", () => {
    const scriptName = "my-worker";
    const aliasLength = maxAliasLength(scriptName);
    assert.equal(aliasLength, 62 - scriptName.length - 1);
    assert.equal(aliasLength + 1 + scriptName.length, 62);
  });

  it("clamps to a minimum of 1 for very long worker names", () => {
    assert.equal(maxAliasLength("a".repeat(70)), 1);
  });
});

describe("workerScriptName", () => {
  it("uses the top-level name when no environment is set", () => {
    assert.equal(
      workerScriptName({ name: "my-example-worker" }, ""),
      "my-example-worker",
    );
  });

  it("uses env.<environment>.name when that name is longer than the top-level name", () => {
    const topLevelName = "my-example-worker";
    const envName = "my-example-worker-staging";
    assert.ok(envName.length > topLevelName.length);
    assert.equal(
      workerScriptName(
        {
          name: topLevelName,
          env: { staging: { name: envName } },
        },
        "staging",
      ),
      envName,
    );
  });

  it("appends the environment when the env block does not set name", () => {
    assert.equal(
      workerScriptName(
        {
          name: "my-example-worker",
          env: { staging: { vars: { FOO: "bar" } } },
        },
        "staging",
      ),
      "my-example-worker-staging",
    );
  });

  it("appends the environment when the env block is missing", () => {
    assert.equal(
      workerScriptName({ name: "my-example-worker" }, "staging"),
      "my-example-worker-staging",
    );
  });

  it("returns undefined when no name can be determined", () => {
    assert.equal(workerScriptName(undefined, "staging"), undefined);
    assert.equal(workerScriptName({}, ""), undefined);
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
    });
    assert.equal(args[3], "feature-proj-123");
  });

  it("keeps the preview label within 62 characters", () => {
    const scriptName = "a".repeat(31);
    const args = buildWorkersArgs({
      isProduction: false,
      branch: "b".repeat(60),
      environment: "",
      wranglerConfig: { name: scriptName },
    });
    const alias = args[3];
    assert.ok(alias);
    assert.equal(alias.length, 62 - scriptName.length - 1);
    assert.ok(`${alias}-${scriptName}`.length <= 62);
  });

  it("measures an env name that is longer than the top-level name", () => {
    const topLevelName = "short";
    const envName = "my-example-worker-staging";
    assert.ok(envName.length > topLevelName.length);
    const branch = "b".repeat(80);
    const args = buildWorkersArgs({
      isProduction: false,
      branch,
      environment: "staging",
      wranglerConfig: {
        name: topLevelName,
        env: { staging: { name: envName } },
      },
    });
    const alias = args[3];
    assert.ok(alias);
    assert.equal(alias.length, maxAliasLength(envName));
    assert.ok(alias.length < maxAliasLength(topLevelName));
    assert.ok(`${alias}-${envName}`.length <= 62);
    const measuredAsTopLevel = sanitizeBranchName(
      branch,
      maxAliasLength(topLevelName),
    );
    assert.ok(`${measuredAsTopLevel}-${envName}`.length > 62);
  });

  it("keeps the label at 62 for an env-suffixed script name", () => {
    const topLevelName = "my-example-worker";
    const scriptName = "my-example-worker-staging";
    const branch = "feature/add-dual-environment-deployment-support";
    const args = buildWorkersArgs({
      isProduction: false,
      branch,
      environment: "staging",
      wranglerConfig: { name: topLevelName },
    });
    const alias = args[3];
    assert.ok(alias);
    assert.notEqual(
      alias,
      sanitizeBranchName(branch, 62 - topLevelName.length),
    );
    assert.equal(`${alias}-${scriptName}`.length, 62);
  });

  it("falls back to a 50 character alias cap without a worker name", () => {
    const args = buildWorkersArgs({
      isProduction: false,
      branch: "b".repeat(60),
      environment: "",
    });
    assert.equal(args[3]?.length, 50);
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
