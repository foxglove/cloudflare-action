# Cloudflare Deploy Action

A GitHub Action for deploying to **Cloudflare Pages** and **Cloudflare Workers** with first-class support for preview deployments and GitHub Deployment statuses.

## Why this action?

[`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action) is a general-purpose wrapper around Wrangler. In practice it falls short for production CI/CD:

- **No preview deploy support for Workers.** There is no built-in way to deploy a Worker preview per branch. This action uses `wrangler versions upload --preview-alias` to create a unique preview URL for every branch.
- **No GitHub Deployments integration.** PR authors and reviewers cannot see deployment links in the GitHub UI unless you wire it up yourself. This action creates GitHub Deployments with environment URLs automatically.
- **No deploy retries.** Cloudflare deploys occasionally fail transiently. This action supports configurable retry attempts with backoff.
- **Stale deployment cleanup.** Old GitHub Deployments for the same environment and ref are automatically marked inactive and deleted so the Deployments tab stays clean.
- **Supports both Pages and Workers.** Set `type: pages` or `type: workers` — one action for both deployment models.

## Quick start

### Cloudflare Pages

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: npm ci && npm run build

      - name: Deploy to Cloudflare Pages
        uses: foxglove/cloudflare-action@v1
        with:
          type: pages
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: my-pages-project
          directory: dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

On `main` this creates a **production** deployment. On any other branch it creates a **preview** deployment with a branch-specific URL.

### Cloudflare Workers

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4

      - name: Deploy Worker
        uses: foxglove/cloudflare-action@v1
        with:
          type: workers
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

On `main` this runs `wrangler deploy` for a **production** deployment. On any other branch it runs `wrangler versions upload --preview-alias <branch>` to create a **preview** URL without affecting production traffic.

## How it works

### Deploy modes

| `type`    | Production command                    | Preview command                                     |
| --------- | ------------------------------------- | --------------------------------------------------- |
| `pages`   | `wrangler pages deploy --branch main` | `wrangler pages deploy --branch <branch>`           |
| `workers` | `wrangler deploy`                     | `wrangler versions upload --preview-alias <branch>` |

The branch is read from `GITHUB_HEAD_REF` (pull requests) or `GITHUB_REF_NAME` (pushes). A deploy is considered **production** when the branch matches `productionBranch` (default: `main`).

### GitHub Deployments

When `gitHubToken` is provided the action:

1. Creates a GitHub Deployment for the environment (e.g. `my-project (preview)`).
2. Sets the deployment status to **success** with the deployment URL.
3. Deletes previous deployments for the same environment and ref so the Deployments tab stays clean.

This makes deployment URLs visible directly on pull requests and in the repository's **Deployments** tab.

### Preview aliases (Workers)

For non-production branches the action sanitizes the branch name into a URL-safe alias (lowercase, alphanumeric + hyphens, max 50 chars) and passes it to `wrangler versions upload --preview-alias`. This gives each branch its own stable `https://<alias>.<worker>.workers.dev` URL.

## Inputs

| Input              | Required | Default | Description                                                                                   |
| ------------------ | -------- | ------- | --------------------------------------------------------------------------------------------- |
| `type`             | **yes**  |         | `pages` or `workers`                                                                          |
| `apiToken`         | **yes**  |         | Cloudflare API token                                                                          |
| `accountId`        | no       |         | Cloudflare account ID (can also be set via `CLOUDFLARE_ACCOUNT_ID` env var)                   |
| `directory`        | no       |         | Directory of static assets to deploy (required for Pages)                                     |
| `projectName`      | no       |         | Cloudflare Pages project name (required for Pages). Also used as the GitHub Deployment label. |
| `environment`      | no       |         | Wrangler environment name (`--env` flag)                                                      |
| `workingDirectory` | no       |         | Directory to run wrangler commands from                                                       |
| `wranglerVersion`  | no       | latest  | Wrangler version to install                                                                   |
| `gitHubToken`      | no       |         | GitHub token for creating Deployment statuses                                                 |
| `deployAttempts`   | no       | `1`     | Number of deploy attempts before failing                                                      |
| `productionBranch` | no       | `main`  | Branch name that triggers a production deploy                                                 |
| `previewDeploy`    | no       | `true`  | Whether to deploy preview environments for non-production branches (`true`/`false`, any case) |

## Outputs

| Output           | Description                               |
| ---------------- | ----------------------------------------- |
| `deployment-url` | URL of the Cloudflare deployment          |
| `command-output` | Standard output from the wrangler command |
| `command-stderr` | Standard error from the wrangler command  |

## Examples

### Deploy with retries

```yaml
- uses: foxglove/cloudflare-action@v1
  with:
    type: pages
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    projectName: my-project
    directory: dist
    deployAttempts: "3"
```

### Use deployment URL in a subsequent step

```yaml
- name: Deploy
  id: deploy
  uses: foxglove/cloudflare-action@v1
  with:
    type: pages
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    projectName: my-project
    directory: dist

- name: Print URL
  run: echo "Deployed to ${{ steps.deploy.outputs.deployment-url }}"
```

### Pin a specific Wrangler version

```yaml
- uses: foxglove/cloudflare-action@v1
  with:
    type: workers
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    wranglerVersion: "3.99.0"
```

### Worker with a wrangler environment

```yaml
- uses: foxglove/cloudflare-action@v1
  with:
    type: workers
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    environment: staging
```

### Custom production branch

```yaml
- uses: foxglove/cloudflare-action@v1
  with:
    type: pages
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    projectName: my-project
    directory: dist
    productionBranch: release
```

## License

MIT
