export function sanitizeBranchName(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+/g, "-")
    .substring(0, 50)
    .replace(/-+$/, "");
}

// Preview Worker deploys default to `--env preview` so they bind to
// `env.preview` resources in `wrangler.jsonc` instead of production resources.
// Production deploys have no default — top-level config is used unless
// `environment` is explicitly set.
export function buildWorkersArgs(opts: {
  isProduction: boolean;
  branch: string;
  environment: string;
}): string[] {
  if (opts.isProduction) {
    const args = ["deploy"];
    if (opts.environment) {
      args.push("--env", opts.environment);
    }
    return args;
  }

  const previewAlias = sanitizeBranchName(opts.branch);
  const env = opts.environment || "preview";
  return ["versions", "upload", "--preview-alias", previewAlias, "--env", env];
}

export function extractDeploymentUrl(output: string): string | undefined {
  const urls = output.match(/https:\/\/[^\s]+\.(?:pages|workers)\.dev/g);
  return urls?.[urls.length - 1];
}

export function parseJsonc(raw: string): Record<string, unknown> {
  const stripped = raw
    .replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) =>
      match.startsWith("/") ? "" : match,
    )
    .replace(/,\s*([\]}])/g, "$1");
  const parsed: unknown = JSON.parse(stripped);
  if (
    parsed == undefined ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return {};
  }
  return parsed as Record<string, unknown>;
}
