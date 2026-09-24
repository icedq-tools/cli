# Contributing & Releasing `@icedq/cli`

A one-page guide to making changes and publishing to npm. **The only way to publish is by creating a GitHub Release** — there are no npm tokens, and manual `npm publish` is blocked at the registry.

---

## 1. Make a change

```bash
git clone https://github.com/icedq-tools/cli.git
cd cli
npm install
git checkout -b my-change
```

- Code lives in `src/`; tests in `tests/unit/` (files named `*.test.js`).
- Run the suite locally: `npm test` (uses Node's built-in test runner — **Node 20+** recommended; some root-hook tests are unreliable on Node < 18.17).
- Keep the dependency surface small. If you add a runtime dep, commit the updated `package-lock.json`.

## 2. Open a pull request

- Push your branch and open a PR against `main`.
- **CI must pass** — tests run on Node 18 / 20 / 22.
- Changes under `.github/workflows/`, `package.json`, `LICENSE`, `NOTICE`, and `CODEOWNERS` require review from **@icedq-tools/maintainers** (enforced by `CODEOWNERS`).
- Merge once green and approved.

## 3. Release to npm

Releases are **forward-only** — every publish needs a new version number (npm rejects re-publishing an existing one).

1. **Bump the version** in a PR:
   - Edit `version` in `package.json` (follow semver: patch for fixes, minor for features).
   - Run `npm install --package-lock-only` so `package-lock.json` matches (or `npm version <new> --no-git-tag-version`).
   - Merge the bump PR into `main` (CI green).
2. **Draft the GitHub Release:** repo → **Releases → Draft a new release**.
   - **Create a new tag** `v<version>` (e.g. `v0.2.1`), **Target: `main`**.
   - **Generate release notes** → **Publish release**.
3. **Approve the deployment:** publishing the release triggers `.github/workflows/release.yml`, which **pauses on the `release` environment**. Go to **Actions → the Release run → Review deployments → Approve and deploy**.
4. The workflow runs `npm ci → npm test → npm publish`. Authentication and **provenance** are automatic via npm **Trusted Publishing (OIDC)** — no token, no flags.

## 4. Verify

```bash
npm view @icedq/cli@<version>
```

On <https://www.npmjs.com/package/@icedq/cli> the new version should show a **Provenance** badge linking back to the commit and workflow run.

---

## Guardrails (why it works this way)

- **No tokens.** npm is set to *require 2FA and disallow tokens*; only the `release.yml` workflow can publish, via OIDC. A leaked credential cannot push a release.
- **Human gate.** The `release` environment requires a maintainer to approve every publish.
- **Pinned actions.** Third-party Actions are pinned to commit SHAs; bump them deliberately.
- **License is per-version and permanent.** Published versions are Apache-2.0 (`0.2.0`+); you cannot change or un-publish a released version's license.
- **Secrets at runtime.** The CLI reads `ICEDQ_CLIENT_SECRET` (and other config) from environment variables. In CI, pass secrets via the environment/secret store — never as command-line flags (they leak into shell history and process listings).

## Security issues

Do not open a public issue. See [`SECURITY.md`](SECURITY.md) for private disclosure.
