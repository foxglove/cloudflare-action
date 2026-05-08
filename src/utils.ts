export function sanitizeBranchName(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+/g, "-")
    .substring(0, 50)
    .replace(/-+$/, "");
}

export function buildWorkersArgs(opts: {
  isProduction: boolean;
  branch: string;
  environment: string;
}): string[] {
  const args: string[] = opts.isProduction
    ? ["deploy"]
    : [
        "versions",
        "upload",
        "--preview-alias",
        sanitizeBranchName(opts.branch),
      ];
  if (opts.environment) {
    args.push("--env", opts.environment);
  }
  return args;
}

// Returns true if a parsed wrangler config defines `env.<envName>` as an
// object. Used to auto-detect preview environments without forcing consumers
// to opt in via input.
export function hasWranglerEnvironment(
  config: Record<string, unknown> | undefined,
  envName: string,
): boolean {
  if (!config || typeof config.env !== "object" || config.env === null) {
    return false;
  }
  const env = config.env as Record<string, unknown>;
  const block = env[envName];
  return typeof block === "object" && block !== null;
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
