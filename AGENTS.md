# AGENTS.md — foxglove/cloudflare-action

## Purpose

This is a GitHub Action that deploys to Cloudflare Pages and Cloudflare Workers. It was created as a replacement for `cloudflare/wrangler-action` which lacks preview deploy support for Workers, GitHub Deployment status integration, deploy retries, and stale deployment cleanup.

## Architecture

This is a Node.js GitHub Action (runs via `node24`). Entry logic lives in `src/index.ts`; shared helpers (branch sanitization, URL extraction, minimal JSONC parsing for `wrangler.jsonc`) live in `src/utils.ts`. Everything is bundled into a single CommonJS file with esbuild.

```
action.yml           GitHub Action definition (inputs, outputs, entrypoint)
src/index.ts         Main action — deploy, retry, GitHub Deployments
src/utils.ts         Pure helpers imported by index
src/*.test.ts        Node built-in tests (`yarn test`)
dist/index.cjs       Compiled bundle (checked into git, required by GitHub Actions)
package.json         Dependencies and build scripts
tsconfig.json        TypeScript configuration
.yarnrc.yml          Yarn configuration
yarn.lock            Yarn lockfile
.gitignore           Git ignore rules
LICENSE              MIT license
```

### Key design decisions

- **Explicit mode selection.** Users set `type: pages` or `type: workers`. No magic detection.
- **Small surface area.** Core flow stays in `src/index.ts`; keep `utils.ts` limited to testable, side-effect-free helpers.
- **Global wrangler install.** Wrangler is installed globally via `npm install -g wrangler@<version>` so it's available for retries without re-downloading. We use npm (not yarn) here because the action runs on GitHub Actions runners where npm is always available but yarn version is unpredictable.
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
yarn build      # esbuild: src/index.ts (+ bundled deps) → dist/index.cjs
```

### Type-check and format

```sh
yarn typecheck   # tsc --noEmit
yarn fmt         # Prettier write
yarn fmt:check   # Prettier check (used in CI)
```

### Tests

```sh
yarn test        # node --test src/*.test.ts
```

### CI

See `.github/workflows/ci.yml`

### Testing locally

The action depends on `@actions/core` and `@actions/exec` which expect GitHub Actions runner environment variables. For local testing, set these env vars:

```sh
export GITHUB_REF_NAME=my-branch
export GITHUB_REPOSITORY=owner/repo
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
```

Then run `node dist/index.cjs` directly, passing inputs via `INPUT_*` env vars (e.g. `INPUT_APITOKEN`, `INPUT_TYPE`, `INPUT_DIRECTORY` — use the same names GitHub Actions uses for your inputs).

## Making changes

1. Edit source files.
2. Run `yarn ci` (runs `yarn fmt && yarn typecheck && yarn build && yarn test`).
3. **Commit `src/` and `dist/` together.** The `dist/` bundle is what GitHub Actions runs; CI fails with `git diff --exit-code` if the committed bundle does not match the build.

## Adding new inputs

1. Add the input to `action.yml` under `inputs:`.
2. Read it in `src/index.ts` via `core.getInput("inputName")`.
3. Update the README Inputs table.
4. Follow **Making changes**.

## Dependencies

- `@actions/core` — GitHub Actions toolkit (logging, inputs, outputs, secrets)
- `@actions/exec` — Execute shell commands with output capture
- `@octokit/rest` — GitHub REST API client (for Deployments)
- `esbuild` — Bundles TypeScript + node_modules into a single JS file
