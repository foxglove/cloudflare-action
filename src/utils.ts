export function sanitizeBranchName(branch: string, maxLength = 50): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+/g, "-")
    .substring(0, maxLength)
    .replace(/-+$/, "");
}

// Cloudflare error 10021 rejects a preview alias when `<alias>-<script>` is
// 63 characters or longer. Cap that label at 62: alias length is
// `62 - scriptName.length - 1`, where the subtracted 1 is the joining hyphen.
// Unknown script names keep a 50-character alias cap.
const MAX_PREVIEW_LABEL_LENGTH = 62;

export function maxAliasLength(scriptName: string | undefined): number {
  if (!scriptName) return 50;
  return Math.max(1, MAX_PREVIEW_LABEL_LENGTH - scriptName.length - 1);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Script name `wrangler versions upload` / `wrangler deploy` will use.
 *
 * With no `--env`, this is the top-level `name`. With an environment, Wrangler
 * uses `env.<environment>.name` when that field is set; otherwise it appends
 * `-<environment>` to the top-level name (`my-example-worker` + `--env staging`
 * uploads `my-example-worker-staging`).
 */
export function workerScriptName(
  config: Record<string, unknown> | undefined,
  environment: string,
): string | undefined {
  const topLevelName = nonEmptyString(config?.name);
  if (!environment) {
    return topLevelName;
  }
  const envName = environmentScriptName(config, environment);
  if (envName) {
    return envName;
  }
  if (topLevelName) {
    return `${topLevelName}-${environment}`;
  }
  return undefined;
}

function environmentScriptName(
  config: Record<string, unknown> | undefined,
  environment: string,
): string | undefined {
  if (!config || typeof config.env !== "object" || config.env === null) {
    return undefined;
  }
  const environments = config.env as Record<string, unknown>;
  const block = environments[environment];
  if (typeof block !== "object" || block === null) {
    return undefined;
  }
  return nonEmptyString((block as Record<string, unknown>).name);
}

export function buildWorkersArgs(opts: {
  isProduction: boolean;
  branch: string;
  environment: string;
  wranglerConfig?: Record<string, unknown>;
}): string[] {
  const scriptName = workerScriptName(opts.wranglerConfig, opts.environment);
  const args: string[] = opts.isProduction
    ? ["deploy"]
    : [
        "versions",
        "upload",
        "--preview-alias",
        sanitizeBranchName(opts.branch, maxAliasLength(scriptName)),
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
