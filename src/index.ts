import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { Octokit } from "@octokit/rest";
import {
  sanitizeBranchName,
  extractDeploymentUrl,
  parseBooleanInput,
  parseJsonc,
} from "./utils.js";

type DeployMode = "pages" | "workers";

const RETRY_DELAY_MS = 10_000;

interface Config {
  apiToken: string;
  accountId: string;
  mode: DeployMode;
  directory: string;
  projectName: string;
  environment: string;
  branch: string;
  isProduction: boolean;
  productionBranch: string;
  workingDirectory: string;
  wranglerVersion: string;
  gitHubToken: string;
  deployAttempts: number;
}

interface DeployResult {
  url: string | undefined;
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readWranglerName(workingDirectory: string): string | undefined {
  const dir = workingDirectory || ".";
  for (const filename of ["wrangler.jsonc", "wrangler.json"]) {
    const filepath = path.join(dir, filename);
    if (!fs.existsSync(filepath)) continue;
    const parsed = parseJsonc(fs.readFileSync(filepath, "utf-8"));
    if (typeof parsed.name === "string" && parsed.name) {
      return parsed.name;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Wrangler
// ---------------------------------------------------------------------------

async function installWrangler(version: string): Promise<void> {
  const pkg = version ? `wrangler@${version}` : "wrangler@latest";
  core.info(`Installing ${pkg}...`);
  await exec.exec("npm", ["install", "--global", pkg]);
}

async function runWrangler(
  args: string[],
  config: Config,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = "";
  let stderr = "";

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  if (config.apiToken) env.CLOUDFLARE_API_TOKEN = config.apiToken;
  if (config.accountId) env.CLOUDFLARE_ACCOUNT_ID = config.accountId;

  const exitCode = await exec.exec("wrangler", args, {
    cwd: config.workingDirectory || undefined,
    env,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString();
      },
      stderr: (data: Buffer) => {
        stderr += data.toString();
      },
    },
    ignoreReturnCode: true,
  });

  return { stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
// Deploy strategies
// ---------------------------------------------------------------------------

async function deployPages(config: Config): Promise<DeployResult> {
  const args = [
    "pages",
    "deploy",
    config.directory,
    "--project-name",
    config.projectName,
    "--branch",
    config.branch,
  ];

  const { stdout, stderr, exitCode } = await runWrangler(args, config);

  if (exitCode !== 0) {
    throw new Error(
      `wrangler pages deploy failed (exit code ${exitCode}):\n${stderr}`,
    );
  }

  return { url: extractDeploymentUrl(stdout + "\n" + stderr), stdout, stderr };
}

async function deployWorkers(config: Config): Promise<DeployResult> {
  let args: string[];

  if (config.isProduction) {
    args = ["deploy"];
    if (config.environment) {
      args.push("--env", config.environment);
    }
  } else {
    const previewAlias = sanitizeBranchName(config.branch);
    args = ["versions", "upload", "--preview-alias", previewAlias];
    if (config.environment) {
      args.push("--env", config.environment);
    }
  }

  const { stdout, stderr, exitCode } = await runWrangler(args, config);

  if (exitCode !== 0) {
    const cmd = config.isProduction
      ? "wrangler deploy"
      : "wrangler versions upload";
    throw new Error(`${cmd} failed (exit code ${exitCode}):\n${stderr}`);
  }

  return { url: extractDeploymentUrl(stdout + "\n" + stderr), stdout, stderr };
}

async function deploy(config: Config): Promise<DeployResult> {
  return config.mode === "pages" ? deployPages(config) : deployWorkers(config);
}

async function deployWithRetry(config: Config): Promise<DeployResult> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.deployAttempts; attempt++) {
    try {
      return await deploy(config);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === config.deployAttempts) break;

      core.warning(
        `Deploy attempt ${attempt}/${config.deployAttempts} failed: ${lastError.message}. ` +
          `Retrying in ${RETRY_DELAY_MS / 1000}s...`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }

  throw new Error(
    `Deploy failed after ${config.deployAttempts} attempt(s): ${lastError?.message ?? "Unknown error"}`,
  );
}

// ---------------------------------------------------------------------------
// GitHub Deployments
// ---------------------------------------------------------------------------

async function deleteOldDeployments(
  octokit: Octokit,
  owner: string,
  repo: string,
  environment: string,
  ref: string,
  excludeId: number,
): Promise<void> {
  const { data: deployments } = await octokit.rest.repos.listDeployments({
    owner,
    repo,
    environment,
    ref,
    per_page: 100,
  });

  for (const deployment of deployments) {
    if (deployment.id === excludeId) continue;
    try {
      await octokit.rest.repos.createDeploymentStatus({
        owner,
        repo,
        deployment_id: deployment.id,
        state: "inactive",
      });
      await octokit.rest.repos.deleteDeployment({
        owner,
        repo,
        deployment_id: deployment.id,
      });
      core.info(`Deleted old deployment ${deployment.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      core.warning(`Failed to delete deployment ${deployment.id}: ${msg}`);
    }
  }
}

async function createGitHubDeployment(
  token: string,
  environmentName: string,
  environmentUrl: string,
  ref: string,
): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    core.warning("GITHUB_REPOSITORY not set — skipping GitHub Deployment");
    return;
  }

  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    core.warning(`Invalid GITHUB_REPOSITORY: ${repository}`);
    return;
  }

  const octokit = new Octokit({ auth: token });

  core.info(`Creating GitHub Deployment for "${environmentName}"...`);

  const { data: deployment } = await octokit.rest.repos.createDeployment({
    owner,
    repo,
    ref,
    environment: environmentName,
    description: `Deploy to ${environmentName}`,
    required_contexts: [],
    auto_merge: false,
  });

  if (!("id" in deployment)) {
    throw new Error("Failed to create deployment — no ID returned");
  }

  core.info(`Created deployment ${deployment.id}`);

  const runId = process.env.GITHUB_RUN_ID;
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const logUrl = runId
    ? `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`
    : undefined;

  await octokit.rest.repos.createDeploymentStatus({
    owner,
    repo,
    deployment_id: deployment.id,
    state: "success",
    environment_url: environmentUrl,
    log_url: logUrl,
    description: "Deployment successful",
    auto_inactive: false,
  });

  core.info(`Deployment status set to success: ${environmentUrl}`);

  await deleteOldDeployments(
    octokit,
    owner,
    repo,
    environmentName,
    ref,
    deployment.id,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const apiToken = core.getInput("apiToken", { required: true });
  core.setSecret(apiToken);

  const typeInput = core.getInput("type", { required: true });
  if (typeInput !== "pages" && typeInput !== "workers") {
    throw new Error(`type must be "pages" or "workers", got "${typeInput}"`);
  }
  const mode: DeployMode = typeInput;

  const accountId =
    core.getInput("accountId") || process.env.CLOUDFLARE_ACCOUNT_ID || "";
  const directory = core.getInput("directory");
  const projectName = core.getInput("projectName");
  const environment = core.getInput("environment");
  const workingDirectory = core.getInput("workingDirectory");
  const wranglerVersion = core.getInput("wranglerVersion");
  const gitHubToken = core.getInput("gitHubToken");
  const deployAttempts = parseInt(core.getInput("deployAttempts") || "1", 10);
  const productionBranch = core.getInput("productionBranch") || "main";
  const previewDeploy = parseBooleanInput(
    core.getInput("previewDeploy"),
    "previewDeploy",
    true,
  );

  if (mode === "pages" && !projectName) {
    throw new Error("projectName is required for Pages deployments");
  }
  if (mode === "pages" && !directory) {
    throw new Error("directory is required for Pages deployments");
  }

  const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
  if (!branch) {
    throw new Error(
      "Could not determine branch name (GITHUB_HEAD_REF and GITHUB_REF_NAME are both empty)",
    );
  }

  const isProduction = branch === productionBranch;

  const config: Config = {
    apiToken,
    accountId,
    mode,
    directory,
    projectName,
    environment,
    branch,
    isProduction,
    productionBranch,
    workingDirectory,
    wranglerVersion,
    gitHubToken,
    deployAttempts,
  };

  if (Number.isNaN(deployAttempts) || deployAttempts < 1) {
    throw new Error("deployAttempts must be an integer >= 1");
  }

  const modeLabel = mode === "pages" ? "Pages" : "Workers";
  const deployType = isProduction ? "production" : "preview";

  core.info(`Mode: Cloudflare ${modeLabel}`);
  core.info(`Branch: ${branch}`);
  core.info(`Deploy type: ${deployType}`);
  if (mode === "pages") {
    core.info(`Project: ${projectName}`);
    core.info(`Directory: ${directory}`);
  }
  if (environment) {
    core.info(`Environment: ${environment}`);
  }
  core.info(`Attempts: ${deployAttempts}\n`);

  if (!isProduction && !previewDeploy) {
    core.info("Preview deploys are disabled — skipping deployment.");
    core.setOutput("deployment-url", "");
    core.setOutput("command-output", "");
    core.setOutput("command-stderr", "");
    return;
  }

  const label =
    projectName || readWranglerName(config.workingDirectory) || "workers";

  await core.group("Install Wrangler", () => installWrangler(wranglerVersion));

  const result = await core.group(`Deploy to Cloudflare ${modeLabel}`, () =>
    deployWithRetry(config),
  );

  core.setOutput("deployment-url", result.url ?? "");
  core.setOutput("command-output", result.stdout);
  core.setOutput("command-stderr", result.stderr);

  if (result.url) {
    core.info(`\nDeployment URL: ${result.url}`);
  } else {
    core.warning("Could not extract deployment URL from wrangler output");
  }

  if (gitHubToken && result.url) {
    const environmentLabel = `${label} (${deployType})`;

    await core.group("Create GitHub Deployment", () =>
      createGitHubDeployment(
        gitHubToken,
        environmentLabel,
        result.url!,
        branch,
      ),
    );
  }
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  core.setFailed(message);
});
