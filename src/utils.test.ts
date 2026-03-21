import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
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

  it("truncates to 50 characters", () => {
    const long = "a".repeat(60);
    assert.equal(sanitizeBranchName(long).length, 50);
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
