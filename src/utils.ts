import { createHash } from "node:crypto";

const MAX_PREVIEW_HOST_LABEL_LENGTH = 63;
const PREVIEW_ALIAS_HASH_LENGTH = 4;

export function sanitizeBranchName(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+/g, "-")
    .replace(/-+$/, "");
}

export function buildPreviewAlias(branch: string, workerName?: string): string {
  const branchHash = createHash("sha256")
    .update(branch)
    .digest("hex")
    .slice(0, PREVIEW_ALIAS_HASH_LENGTH);
  const sanitizedBranch = sanitizeBranchName(branch);
  const alias = sanitizedBranch
    ? /^[a-z]/.test(sanitizedBranch)
      ? sanitizedBranch
      : `branch-${sanitizedBranch}`
    : `branch-${branchHash}`;

  // Preserve the previous limit when the config format does not expose the
  // Worker name to the action.
  const maxAliasLength = workerName
    ? MAX_PREVIEW_HOST_LABEL_LENGTH - workerName.length - 1
    : 50;
  if (maxAliasLength < 1) {
    throw new Error(
      `Worker name "${workerName}" leaves no room for a preview alias`,
    );
  }
  if (alias.length <= maxAliasLength) {
    return alias;
  }

  const maxPrefixLength = maxAliasLength - PREVIEW_ALIAS_HASH_LENGTH - 1;
  if (maxPrefixLength < 1) {
    throw new Error(
      `Worker name "${workerName}" leaves too little room for a unique preview alias`,
    );
  }

  const prefix = alias.slice(0, maxPrefixLength).replace(/-+$/, "");
  return `${prefix}-${branchHash}`;
}

export function getWorkerName(
  config: Record<string, unknown> | undefined,
  environment: string,
): string | undefined {
  if (!config || typeof config.name !== "string" || !config.name) {
    return undefined;
  }
  if (!environment) {
    return config.name;
  }

  const environments =
    typeof config.env === "object" && config.env !== null
      ? (config.env as Record<string, unknown>)
      : undefined;
  const environmentConfig = environments?.[environment];
  if (
    typeof environmentConfig === "object" &&
    environmentConfig !== null &&
    typeof (environmentConfig as Record<string, unknown>).name === "string"
  ) {
    return (environmentConfig as Record<string, unknown>).name as string;
  }

  return `${config.name}-${environment}`;
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
        buildPreviewAlias(opts.branch, opts.workerName),
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
