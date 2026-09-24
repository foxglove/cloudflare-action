export function sanitizeBranchName(branch: string, maxLength = 50): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+/g, "-")
    .substring(0, maxLength)
    .replace(/-+$/, "");
}

// The alias and Worker name combined (joined by a hyphen) form a single DNS
// label for the preview URL, which is capped at 63 characters. Leave 50
// characters for the alias when the Worker name isn't known.
export function maxAliasLength(workerName: string | undefined): number {
  if (!workerName) return 50;
  return Math.max(1, 62 - workerName.length);
}

export function buildWorkersArgs(opts: {
  isProduction: boolean;
  branch: string;
  environment: string;
  workerName?: string;
}): string[] {
  const args: string[] = opts.isProduction
    ? ["deploy"]
    : [
        "versions",
        "upload",
        "--preview-alias",
        sanitizeBranchName(opts.branch, maxAliasLength(opts.workerName)),
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
