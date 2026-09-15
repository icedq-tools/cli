# @icedq/cli

CLI for iceDQ rule and workflow promotion across environments.

Wraps the iceDQ import/export REST APIs to handle authentication, async job polling, multipart bundle uploads, and import log parsing in a single command.

## Install

```bash
npm install -g @icedq/cli
```

Requires Node.js 18 or newer.

## Authenticate

Set the following environment variables (or pass equivalent flags):

| Variable | Description |
|---|---|
| `ICEDQ_BASE_URL` | iceDQ instance base URL, e.g. `https://app.icedq.com` |
| `ICEDQ_KEYCLOAK_URL` | Keycloak token endpoint base, e.g. `https://auth.icedq.com/auth/realms/icedq` |
| `ICEDQ_CLIENT_ID` | OAuth client ID (`client_credentials` grant) |
| `ICEDQ_CLIENT_SECRET` | OAuth client secret |
| `ICEDQ_ORG_ID` | iceDQ organization ID |
| `ICEDQ_ACCOUNT_ID` | iceDQ account ID |
| `ICEDQ_WORKSPACE_ID` | Source/target workspace ID |

For the GitHub Actions workflows, injecting `ICEDQ_CLIENT_SECRET` from a GitHub secret is already the correct, industry-standard approach — GitHub masks it in logs, and hosted runners are single-job and ephemeral. There's no need to change how you use the Actions.

If you're running the CLI directly — locally, or on a self-hosted runner — you also have the option of `--client-secret-file <path>`, which reads the secret from a file instead (its content is used verbatim, trimmed of surrounding whitespace). It takes precedence over both `--client-secret` and `ICEDQ_CLIENT_SECRET` if provided, and avoids the secret ever appearing in your shell history or `ps`/process-list output the way typing `--client-secret` directly would:

```bash
icedq export --resource workflow --id wkfl-... --output ./finance.zip --client-secret-file ./client-secret.txt
```

## Commands

### `icedq export`

Initiates an export, polls until complete, downloads the bundle.

```bash
icedq export --resource workflow --id wkfl-... --output ./finance.zip
icedq export --resource folder   --id fldr-... --include-child --output ./finance.zip
```

### `icedq generate-mapping`

Uploads an export bundle, resolves connections/parameters/custom fields by name against the target workspace, and writes a ready-to-use mapping JSON.

```bash
icedq generate-mapping --bundle ./finance.zip --output ./mapping.json
```

### `icedq import`

Submits a bundle, polls until complete, parses the log.

```bash
icedq import \
  --bundle ./finance.zip \
  --kind workflows \
  --mapping-file ./mapping.json \
  --strict \
  --retain-log ./icedq-import.log
```

A hand-authored `mapping.json` works too — see each companion Action's own documentation (linked below) for examples.

## GitHub Actions

For CI/CD usage via GitHub Actions, use these three companion Actions — each documentation covers its own inputs/outputs, usage examples:

- [`icedq-tools/export-action`](https://github.com/marketplace/actions/icedq-export) — export rules/workflows/folders to a bundle
- [`icedq-tools/generate-mapping-action`](https://github.com/marketplace/actions/icedq-generate-mapping) — auto-generate a mapping file from a bundle
- [`icedq-tools/import-action`](https://github.com/marketplace/actions/icedq-import) — import a bundle into a target workspace

## Roadmap

- **Connections** — export and import support, alongside the existing rules, workflows, and folders.
- **`icedq run`** — trigger a rule or workflow run directly (with a companion `run-action`), rather than only promoting them between environments.
- **`icedq status`** — check on or reattach to an existing export/import/run task, for recovering from a timed-out or interrupted poll.
