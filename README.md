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
| `ICEDQ_URL` | iceDQ instance base URL, e.g. `https://app.icedq.com` |
| `ICEDQ_KEYCLOAK_URL` | Keycloak token endpoint base, e.g. `https://auth.icedq.com/auth/realms/icedq` |
| `ICEDQ_CLIENT_ID` | OAuth client ID (`client_credentials` grant) |
| `ICEDQ_CLIENT_SECRET` | OAuth client secret |
| `ICEDQ_ORG_ID` | iceDQ organization ID |
| `ICEDQ_ACCOUNT_ID` | iceDQ account ID |
| `ICEDQ_WORKSPACE_ID` | Source/target workspace ID |

## Commands (v0.1)

### `icedq export`

Initiates an export, polls until complete, downloads the bundle.

```bash
icedq export --resource workflow --id wkfl-... --output-file ./finance.zip
icedq export --resource folder   --id fldr-... --include-child --output-file ./finance.zip
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

A hand-authored `mapping.json` is required in v0.1. Auto-mapping by name (`generate-mapping`) ships in v0.2.

## Roadmap

- v0.2 — `icedq generate-mapping`, `icedq jobs`, `icedq published`, `icedq validate`
- v0.2 — companion GitHub Actions: `icedq/export-action`, `icedq/validate-action`

The build specification is the source of truth for behavior.
