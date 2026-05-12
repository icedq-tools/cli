# Using the iceDQ GitHub Actions

This guide walks through using [`icedq-tools/export-action`](https://github.com/icedq-tools/export-action) and [`icedq-tools/import-action`](https://github.com/icedq-tools/import-action) to promote iceDQ rules and workflows across environments (Dev → QA → UAT → Prod) directly from GitHub Actions workflows.

Both Actions are thin composite wrappers around [`@icedq/cli`](https://www.npmjs.com/package/@icedq/cli). Anything achievable in YAML is also achievable from a `run: icedq ...` step — the Actions just save you boilerplate.

---

## Table of contents

- [What you get](#what-you-get)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Promotion pipeline (Dev → QA → UAT → Prod)](#promotion-pipeline-dev--qa--uat--prod)
- [Authoring mapping files](#authoring-mapping-files)
- [Action inputs reference](#action-inputs-reference)
- [Action outputs reference](#action-outputs-reference)
- [Self-hosted runners (private networks)](#self-hosted-runners-private-networks)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## What you get

| Action | What it does |
|---|---|
| `icedq-tools/export-action` | Initiates an export, polls until complete, downloads the bundle ZIP, optionally uploads it as a workflow artifact. |
| `icedq-tools/import-action` | Submits a bundle to a target workspace, polls until complete, parses the import log for skipped rules, optionally fails the workflow on any skip (`strict: true`). |

Both Actions handle:

- OAuth `client_credentials` token acquisition and refresh against Keycloak
- Async job polling with exponential backoff (initial 2s, ×2 backoff, capped at 30s)
- Multipart bundle upload (import) and binary bundle download (export)
- GitHub-flavored Markdown summaries posted to `$GITHUB_STEP_SUMMARY`
- Token masking in logs

---

## Prerequisites

### 1. Create a Keycloak `client_credentials` client

In your iceDQ Keycloak realm, create a confidential client with:

- **Access type:** confidential
- **Standard flow enabled:** off
- **Direct access grants:** off
- **Service accounts enabled:** **on** (this enables `client_credentials`)
- **Required service-account roles** for the iceDQ APIs you plan to call (export, import, taskruns, exports/download, exports/log, imports/log, imports/terminate)

Note the client's **Client ID** and **Client Secret** — you'll store these as GitHub secrets.

> **Recommendation:** create one client per environment (Dev, QA, UAT, Prod). Then a leaked Dev secret cannot promote into Prod.

### 2. Collect your iceDQ identifiers

You'll need these from your iceDQ admin:

- **Org ID** — same across all environments in most setups
- **Account ID** — same across environments
- **Workspace IDs** — one per environment (Dev, QA, UAT, Prod)
- **iceDQ instance URL** — may be the same hostname across environments, or different per environment if separately hosted
- **Keycloak URL** — base URL up to and including the realm path, e.g. `https://auth.example.com/realms/icedq`

### 3. Configure GitHub secrets and environments

In your GitHub repo, go to **Settings → Secrets and variables → Actions**.

Create per-environment secrets (use [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) for required-reviewer gates on UAT/Prod):

```
ICEDQ_URL_DEV          ICEDQ_URL_QA          ICEDQ_URL_UAT          ICEDQ_URL_PROD
ICEDQ_KEYCLOAK_URL     (often shared across environments)
ICEDQ_CLIENT_ID_DEV    ICEDQ_CLIENT_ID_QA    ICEDQ_CLIENT_ID_UAT    ICEDQ_CLIENT_ID_PROD
ICEDQ_CLIENT_SECRET_*  (one per environment)
ICEDQ_ORG_ID
ICEDQ_ACCOUNT_ID
```

Workspace IDs are not secrets — store them as repo or environment **variables**:

```
DEV_WORKSPACE_ID       QA_WORKSPACE_ID       UAT_WORKSPACE_ID       PROD_WORKSPACE_ID
```

---

## Quick start

### Export a workflow on every push

```yaml
# .github/workflows/icedq-export.yml
name: iceDQ — export workflow on push

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  export:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: icedq-tools/export-action@v1
        with:
          icedq-url:     ${{ secrets.ICEDQ_URL_DEV }}
          keycloak-url:  ${{ secrets.ICEDQ_KEYCLOAK_URL }}
          client-id:     ${{ secrets.ICEDQ_CLIENT_ID_DEV }}
          client-secret: ${{ secrets.ICEDQ_CLIENT_SECRET_DEV }}
          org-id:        ${{ secrets.ICEDQ_ORG_ID }}
          account-id:    ${{ secrets.ICEDQ_ACCOUNT_ID }}
          workspace-id:  ${{ vars.DEV_WORKSPACE_ID }}
          resource:      folder
          id:            ${{ vars.FINANCE_FOLDER_ID }}
          include-child: 'true'
          output-file:   ./exports/finance.zip
```

The bundle is uploaded as a workflow artifact named `icedq-bundle` by default — downstream jobs can download it via `actions/download-artifact@v4`.

### Import a bundle into QA

```yaml
# .github/workflows/icedq-import-qa.yml
name: iceDQ — import to QA

on:
  push:
    branches: [main]
    paths: ['exports/**']
  workflow_dispatch:

jobs:
  import:
    runs-on: ubuntu-latest
    environment: qa
    steps:
      - uses: actions/checkout@v4

      - uses: icedq-tools/import-action@v1
        with:
          icedq-url:     ${{ secrets.ICEDQ_URL_QA }}
          keycloak-url:  ${{ secrets.ICEDQ_KEYCLOAK_URL }}
          client-id:     ${{ secrets.ICEDQ_CLIENT_ID_QA }}
          client-secret: ${{ secrets.ICEDQ_CLIENT_SECRET_QA }}
          org-id:        ${{ secrets.ICEDQ_ORG_ID }}
          account-id:    ${{ secrets.ICEDQ_ACCOUNT_ID }}
          workspace-id:  ${{ vars.QA_WORKSPACE_ID }}
          bundle:        ./exports/finance.zip
          kind:          workflows
          mapping-file:  ./mappings/qa.json
          strict:        'true'
```

---

## Promotion pipeline (Dev → QA → UAT → Prod)

Combine both Actions plus GitHub Environments to enforce a controlled promotion flow with required reviewers on UAT and Prod.

```yaml
# .github/workflows/icedq-promote.yml
name: iceDQ — promote rules

on:
  push:
    branches: [main]
    paths: ['mappings/**', 'exports/**']
  workflow_dispatch:

jobs:

  # ───────── 1. Capture latest from Dev ─────────
  export-from-dev:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: icedq-tools/export-action@v1
        with:
          icedq-url:     ${{ secrets.ICEDQ_URL_DEV }}
          keycloak-url:  ${{ secrets.ICEDQ_KEYCLOAK_URL }}
          client-id:     ${{ secrets.ICEDQ_CLIENT_ID_DEV }}
          client-secret: ${{ secrets.ICEDQ_CLIENT_SECRET_DEV }}
          org-id:        ${{ secrets.ICEDQ_ORG_ID }}
          account-id:    ${{ secrets.ICEDQ_ACCOUNT_ID }}
          workspace-id:  ${{ vars.DEV_WORKSPACE_ID }}
          resource:      folder
          id:            ${{ vars.FINANCE_FOLDER_ID }}
          include-child: 'true'
          output-file:   ./bundle.zip
          artifact-name: icedq-bundle

  # ───────── 2. Promote to QA ─────────
  promote-qa:
    needs: export-from-dev
    runs-on: ubuntu-latest
    environment: qa
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: icedq-bundle
          path: .
      - uses: icedq-tools/import-action@v1
        with:
          icedq-url:     ${{ secrets.ICEDQ_URL_QA }}
          keycloak-url:  ${{ secrets.ICEDQ_KEYCLOAK_URL }}
          client-id:     ${{ secrets.ICEDQ_CLIENT_ID_QA }}
          client-secret: ${{ secrets.ICEDQ_CLIENT_SECRET_QA }}
          org-id:        ${{ secrets.ICEDQ_ORG_ID }}
          account-id:    ${{ secrets.ICEDQ_ACCOUNT_ID }}
          workspace-id:  ${{ vars.QA_WORKSPACE_ID }}
          bundle:        ./bundle.zip
          kind:          workflows
          mapping-file:  ./mappings/qa.json
          strict:        'true'

  # ───────── 3. Promote to UAT (manual approval) ─────────
  promote-uat:
    needs: promote-qa
    runs-on: ubuntu-latest
    environment: uat        # ← configure required reviewers in repo settings
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with: { name: icedq-bundle, path: . }
      - uses: icedq-tools/import-action@v1
        with:
          icedq-url:     ${{ secrets.ICEDQ_URL_UAT }}
          keycloak-url:  ${{ secrets.ICEDQ_KEYCLOAK_URL }}
          client-id:     ${{ secrets.ICEDQ_CLIENT_ID_UAT }}
          client-secret: ${{ secrets.ICEDQ_CLIENT_SECRET_UAT }}
          org-id:        ${{ secrets.ICEDQ_ORG_ID }}
          account-id:    ${{ secrets.ICEDQ_ACCOUNT_ID }}
          workspace-id:  ${{ vars.UAT_WORKSPACE_ID }}
          bundle:        ./bundle.zip
          kind:          workflows
          mapping-file:  ./mappings/uat.json
          strict:        'true'

  # ───────── 4. Promote to Prod (manual approval) ─────────
  promote-prod:
    needs: promote-uat
    runs-on: ubuntu-latest
    environment: production    # ← required reviewers + branch protection
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with: { name: icedq-bundle, path: . }
      - uses: icedq-tools/import-action@v1
        with:
          icedq-url:     ${{ secrets.ICEDQ_URL_PROD }}
          keycloak-url:  ${{ secrets.ICEDQ_KEYCLOAK_URL }}
          client-id:     ${{ secrets.ICEDQ_CLIENT_ID_PROD }}
          client-secret: ${{ secrets.ICEDQ_CLIENT_SECRET_PROD }}
          org-id:        ${{ secrets.ICEDQ_ORG_ID }}
          account-id:    ${{ secrets.ICEDQ_ACCOUNT_ID }}
          workspace-id:  ${{ vars.PROD_WORKSPACE_ID }}
          bundle:        ./bundle.zip
          kind:          workflows
          mapping-file:  ./mappings/prod.json
          strict:        'true'
```

**Notes on this pipeline:**

- The same artifact bundle flows through all four environments — no re-export per environment, ensuring identical bytes are imported everywhere.
- Each environment has its own `mapping-file` because target connection/parameter UUIDs differ per workspace.
- `strict: 'true'` fails the job if any rule is skipped (e.g., a missing target connection). The next environment is gated on `needs:` so failures stop the chain.
- Configure required reviewers on the `uat` and `production` GitHub Environments to enforce manual approvals.

---

## Authoring mapping files

In v0.1, the import Action requires a hand-authored mapping JSON file (`mapping-file` input). Auto-generation by name (`icedq generate-mapping`) ships in v0.2.

### Mapping document shape

```json
{
  "mapping": {
    "connections": [
      {
        "existingId": "conn-source-uuid",
        "newId":      "conn-target-uuid",
        "action":     "override"
      }
    ],
    "parameters": [
      {
        "existingId": "parm-source-uuid",
        "action":     "append"
      }
    ],
    "customFields": [
      {
        "existingId": "field-source-uuid",
        "newId":      "field-target-uuid",
        "action":     "override"
      }
    ]
  },
  "useFqn": false
}
```

### Action semantics

| Object | Supported actions | What each does |
|---|---|---|
| Connections | `override` only | Re-link rules in the target to use `newId` instead of the source's `existingId`. Target connection must already exist. |
| Custom fields | `override` only | Same as connections. Target field must already exist. |
| Parameters | `append`, `override`, `upsert` | `append` (CLI default): add new parameter keys to target without overwriting existing values. `override`: re-link rules to a different `newId`. `upsert` (API default): overwrite all matching keys — **dangerous in production**, always specify `append` or `override` explicitly. |

### Tip: keep mappings under version control

Store mapping files in your repo (e.g., `mappings/qa.json`, `mappings/uat.json`, `mappings/prod.json`) so changes to UUID mappings are auditable and reviewable in PRs.

---

## Action inputs reference

### Common to both Actions

| Input | Required | Default | Description |
|---|---|---|---|
| `icedq-url` | yes | — | iceDQ instance base URL |
| `keycloak-url` | yes | — | Keycloak realm token endpoint base |
| `client-id` | yes | — | OAuth `client_credentials` client ID |
| `client-secret` | yes | — | OAuth client secret |
| `org-id` | yes | — | Org ID |
| `account-id` | yes | — | Account ID |
| `workspace-id` | yes | — | Workspace ID (source for export, target for import) |
| `timeout` | no | `1800` | Polling timeout in seconds |
| `cli-version` | no | `latest` | Pin a specific `@icedq/cli` version |
| `verify-ssl` | no | `true` | Verify TLS certificates |

### `export-action` only

| Input | Required | Default | Description |
|---|---|---|---|
| `resource` | yes | — | `rule`, `workflow`, or `folder` |
| `id` | yes | — | Resource UUID |
| `include-child` | no | `false` | Recurse folder children (folder only) |
| `output-file` | yes | — | Path to write the bundle ZIP |
| `upload-artifact` | no | `true` | Upload bundle as workflow artifact |
| `artifact-name` | no | `icedq-bundle` | Workflow artifact name |

### `import-action` only

| Input | Required | Default | Description |
|---|---|---|---|
| `bundle` | yes | — | Path to the export ZIP |
| `kind` | yes | — | `rules` or `workflows` |
| `mapping-file` | yes | — | Path to mapping JSON |
| `use-fqn` | no | `false` | Resolve by name instead of UUID (recovery flag) |
| `strict` | no | `false` | Exit non-zero on any skipped rule |
| `terminate-on-conflict` | no | `false` | Cancel any active import in the target workspace before submitting |
| `retain-log` | no | — | Path to write the full import log |

---

## Action outputs reference

### `export-action`

| Output | Description |
|---|---|
| `task-id` | iceDQ `taskInstanceId` |
| `status` | Terminal status (`Completed`, `Terminated`, `Error`) |
| `bundle-path` | Path to the downloaded bundle ZIP |

### `import-action`

| Output | Description |
|---|---|
| `task-id` | iceDQ `taskInstanceId` |
| `status` | Terminal status |
| `skipped-count` | Number of rules skipped by the import (parsed from log) |
| `log-path` | Path to the captured import log (if `retain-log` was set) |

Use outputs in subsequent steps:

```yaml
- uses: icedq-tools/import-action@v1
  id: import
  with: { ... }
- name: Notify on skipped rules
  if: steps.import.outputs.skipped-count != '0'
  run: echo "::warning::${{ steps.import.outputs.skipped-count }} rule(s) skipped"
```

---

## Self-hosted runners (private networks)

For iceDQ instances on private networks (typical for enterprise customers), GitHub-hosted runners cannot reach the iceDQ API. Use [self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners) inside your network:

```yaml
jobs:
  import:
    runs-on: [self-hosted, icedq]   # ← match your runner's labels
    steps:
      - uses: actions/checkout@v4
      - uses: icedq-tools/import-action@v1
        with: { ... }
```

The Actions are runner-agnostic — no other configuration changes are needed. Make sure your runners have:

- Node.js 18+ available (or let `actions/setup-node@v4` install it — needs egress to nodejs.org)
- npm registry access (for installing `@icedq/cli`) — either public registry or your internal mirror
- Network access to the iceDQ API and Keycloak endpoints

---

## Troubleshooting

### "Authentication failed: HTTP 401 from Keycloak"

- Wrong client ID / secret. Confirm the secrets are set on the right GitHub Environment.
- The Keycloak client doesn't have **Service accounts enabled**.
- The realm path in `keycloak-url` is wrong. The expected shape is `https://<host>/realms/<realm>` (Keycloak 17+) or `https://<host>/auth/realms/<realm>` (Keycloak ≤16).

### "ConstraintViolation: Mapping connection[0].new id ... is not present in the target workspace"

- A connection UUID in your mapping file doesn't exist in the target workspace. Connections must be **pre-created in the target environment** — they are not auto-created by import.
- Same applies to custom fields.

### "HTTP 409: Active job blocking"

- An export or import is already running in the target workspace. Either wait for it to finish, or pass `terminate-on-conflict: 'true'` on the import-action to cancel it and retry.

### Import shows `Completed` but rules are missing

- Imports are **not atomic**. If rule #37 of 50 fails validation, rules 1–36 commit and 38–50 continue. Skipped rules appear in the import log.
- Pass `strict: 'true'` to fail the job on any skip.
- Use `retain-log: ./import.log` plus `actions/upload-artifact@v4` to persist the full log for forensics.

### Token expired mid-poll on long-running jobs

- The CLI proactively refreshes Keycloak tokens 30s before expiry, so this should not happen. If it does, check your Keycloak access-token TTL — extremely short TTLs (<60s) can race the refresh logic.

---

## FAQ

**Q: Can I run the CLI directly without the Actions?**
Yes. The Actions are convenience wrappers; the CLI is the source of truth. `npm install -g @icedq/cli` and use `icedq export ...` / `icedq import ...` from a `run:` step or anywhere else (Jenkins, Azure DevOps, Cloud Build, ad-hoc terminal).

**Q: Why is `mapping-file` required? Can't the import figure it out?**
Auto-generation by name is in v0.2 (`icedq generate-mapping`). For v0.1, you author mapping files by hand. Since UUIDs differ per workspace, the mapping is what tells the import which target UUID corresponds to each source UUID.

**Q: Can I export and import in a single job?**
Yes — you don't need to upload an artifact between jobs if the same job does both. But splitting them across jobs gives you the artifact for forensics and lets each environment require independent reviewer approval.

**Q: Does the Action support GitHub Enterprise Server?**
Yes — both Actions are pure composite Actions with no GHES-specific code paths. As long as your runners can reach the iceDQ API and Keycloak, GHES works the same as github.com.

**Q: How do I migrate from manual `curl` scripts?**
Replace your auth + polling boilerplate with the Action. Existing mapping JSON files in API shape work as-is — pass them via `mapping-file`.

---

## Companion docs

- [`@icedq/cli` README](https://github.com/icedq-tools/cli#readme) — direct CLI usage
- [`icedq-tools/export-action`](https://github.com/icedq-tools/export-action) — Action source and per-input reference
- [`icedq-tools/import-action`](https://github.com/icedq-tools/import-action) — Action source and per-input reference
