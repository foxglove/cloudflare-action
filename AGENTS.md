# AGENTS.md — foxglove/cloudflare-action

## Purpose

This is a GitHub Action that deploys to Cloudflare Pages and Cloudflare Workers. It was created as a replacement for `cloudflare/wrangler-action` which lacks preview deploy support for Workers, GitHub Deployment status integration, deploy retries, and stale deployment cleanup.

## Architecture

This is a Node.js GitHub Action (runs via `node20`). The entire action is a single TypeScript file compiled and bundled into `dist/index.js` using `esbuild`.

```
action.yml          GitHub Action definition (inputs, outputs, entrypoint)
src/index.ts        All action logic — deploy, retry, GitHub Deployments
dist/index.js       Compiled bundle (checked into git, required by GitHub Actions)
package.json        Dependencies and build scripts
tsconfig.json       TypeScript configuration
```

### Key design decisions

- **Auto-detection over configuration.** Pages vs Workers mode is determined by whether the `directory` input is set. No mode flag.
- **Single file.** All logic lives in `src/index.ts`. The action is small enough that splitting into multiple files adds complexity without benefit.
- **Global wrangler install.** Wrangler is installed globally via `yarn global add wrangler@<version>` so it's available for retries without re-downloading.
- **`dist/` is checked in.** GitHub Actions requires the compiled JS to be in the repo. Never add `dist/` to `.gitignore`.

### Deploy strategies

| Mode    | Production                            | Preview                                            |
| ------- | ------------------------------------- | -------------------------------------------------- |
| Pages   | `wrangler pages deploy --branch main` | `wrangler pages deploy --branch <branch>`          |
| Workers | `wrangler deploy`                     | `wrangler versions upload --preview-alias <alias>` |

Preview aliases for Workers are derived from the branch name — lowercased, non-alphanumeric characters replaced with hyphens, truncated to 50 characters.

### GitHub Deployments

When `gitHubToken` is provided, the action creates a GitHub Deployment with the environment URL so it appears on PRs and in the repo's Deployments tab. Old deployments for the same environment and ref are automatically cleaned up (marked inactive then deleted).

## Development

### Build

```sh
yarn install
yarn build      # compiles src/index.ts → dist/index.js via esbuild
```

### Type-check

```sh
yarn typecheck   # tsc --noEmit
```

### Testing locally

The action depends on `@actions/core` and `@actions/exec` which expect GitHub Actions runner environment variables. For local testing, set these env vars:

```sh
export GITHUB_REF_NAME=my-branch
export GITHUB_REPOSITORY=owner/repo
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
```

Then run `node dist/index.js` directly, passing inputs via `INPUT_` env vars (e.g. `INPUT_APITOKEN`, `INPUT_DIRECTORY`).

## Making changes

1. Edit `src/index.ts`.
2. Run `yarn build` to regenerate `dist/index.js`.
3. **Always commit both `src/` and `dist/` changes together.** The `dist/` bundle is what GitHub Actions actually executes.
4. Run `yarn typecheck` to verify types.

## Adding new inputs

1. Add the input to `action.yml` under `inputs:`.
2. Read it in `src/index.ts` via `core.getInput("inputName")`.
3. Update the README's Inputs table.
4. Rebuild with `yarn build`.

## Dependencies

- `@actions/core` — GitHub Actions toolkit (logging, inputs, outputs, secrets)
- `@actions/exec` — Execute shell commands with output capture
- `@octokit/rest` — GitHub REST API client (for Deployments)
- `esbuild` — Bundles TypeScript + node_modules into a single JS file
