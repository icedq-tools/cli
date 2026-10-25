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

If a connection or parameter is named differently per environment (e.g. `finance_db` in DEV vs `finance_db_uat` in UAT), exact name matching won't find it. Pass `--cross-env-names-file` (a `.json` or `.csv` config listing each one's name in every environment) and `--target-env` (which environment you're matching against) to match across the difference instead:

```bash
icedq generate-mapping \
  --bundle ./finance.zip \
  --output ./mapping.json \
  --cross-env-names-file ./resource-names-config.json \
  --target-env UAT
```

See [generate-mapping-action's documentation](https://github.com/marketplace/actions/icedq-generate-mapping) for the config file format.

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

### `icedq run`

Triggers a rule or workflow run (one endpoint, split into two subcommands for clarity) and polls until it reaches a terminal status. On failure, the full run result is printed automatically; on success, only if `--show-result` is passed.

```bash
icedq run rule --id rule-77f73152-17cc-5b35-9841-13e24a4039b7
icedq run workflow --id wkfl-e6284f0a-5379-5eaf-a31a-017236bbe72a --sequence 1,3
icedq run rule --id rule-77f7... --show-result          # also print the result on success
```

If a run goes on far longer than expected, `--terminate-on-timeout` cancels it (sends a terminate request) as soon as `--timeout` is reached, instead of leaving it running server-side:

```bash
icedq run workflow --id wkfl-e6284f0a-... --timeout 600 --terminate-on-timeout
```

**Overrides** — swap connections/parameters, or tag a run with summary variables, at trigger time without touching the saved rule/workflow definition, via `--overrides-file <path>` (`.json` or `.csv`, both validated the same way, producing identical requests for equivalent input):

```bash
icedq run rule --id rule-77f7... --overrides-file overrides.json
```

Connection override (source only — the common case for a rule, which has a single connection):
```json
[{ "connections": [{ "type": "source", "find": "conn-OLD-id", "replace": "conn-NEW-id" }] }]
```
```csv
block,sequence,type,conn_type,find,replace,key,value
1,,connection,source,conn-OLD-id,conn-NEW-id,,
```

Parameter override (swap the parameter file the rule/workflow uses):
```json
[{ "parameters": [{ "find": "parm-OLD-id", "replace": "parm-NEW-id" }] }]
```
```csv
block,sequence,type,conn_type,find,replace,key,value
1,,parameter,,parm-OLD-id,parm-NEW-id,,
```

Summary variables — tag the run's result with key/value metadata instead of swapping a file (`useKeyValuePair: true` on the wire; can be combined with `connections`, but not with `parameters`, in the same block):
```json
[{ "variables": { "triggeredBy": "nightly-ci" } }]
```
```csv
block,sequence,type,conn_type,find,replace,key,value
1,,variable,,,,triggeredBy,nightly-ci
```

Combine a connection swap and a parameter swap in one block by giving the rows/objects the same scope — one JSON object, or CSV rows sharing a `block` id:
```json
[{
  "connections": [{ "type": "source", "find": "conn-OLD-id", "replace": "conn-NEW-id" }],
  "parameters": [{ "find": "parm-OLD-id", "replace": "parm-NEW-id" }]
}]
```
```csv
block,sequence,type,conn_type,find,replace,key,value
1,,connection,source,conn-OLD-id,conn-NEW-id,,
1,,parameter,,parm-OLD-id,parm-NEW-id,,
```

Scope an override to specific workflow steps with the block's own `sequence` (comma-separated inside the quoted CSV cell, or a JSON array) — independent of `--sequence`, which instead controls which steps the *run itself* executes:
```bash
# run only steps 1 and 3, AND scope the connection override to just step 3
icedq run workflow --id wkfl-e628... --sequence 1,3 --overrides-file overrides.json
```
```json
[{ "sequence": [3], "connections": [{ "type": "source", "find": "conn-OLD-id", "replace": "conn-NEW-id" }] }]
```

Rules have no steps, so `sequence` isn't valid there (neither `--sequence` nor inside an override block). All ids are checked (`wkfl-`/`rule-`/`conn-`/`parm-`) before anything is sent.

### `icedq status` / `icedq result` / `icedq terminate`

Given the `instance-id` printed by `icedq run`, check on, fetch full detail for, or cancel a run independently — useful when you triggered a run elsewhere (or earlier) and don't want to poll from the same process. `rule`/`workflow` is purely for symmetry with `icedq run`: both hit the exact same endpoint regardless of resource type.

```bash
icedq status rule --id 185274
icedq status workflow --id 185274 --output-format json   # machine-readable: {"status": "...", ...}
icedq result rule --id 185274
icedq terminate workflow --id 185274
```

## GitHub Actions

For CI/CD usage via GitHub Actions, use these companion Actions — each documentation covers its own inputs/outputs, usage examples:

- [`icedq-tools/export-action`](https://github.com/marketplace/actions/icedq-export) — export rules/workflows/folders to a bundle
- [`icedq-tools/generate-mapping-action`](https://github.com/marketplace/actions/icedq-generate-mapping) — auto-generate a mapping file from a bundle
- [`icedq-tools/import-action`](https://github.com/marketplace/actions/icedq-import) — import a bundle into a target workspace
- [`icedq-tools/run-action`](https://github.com/marketplace/actions/icedq-run) — trigger a rule or workflow run and wait for it to finish

## Roadmap

- **Connections** — export and import support, alongside the existing rules, workflows, and folders.
