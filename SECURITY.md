# Security Policy

## Supported Versions

Security fixes are provided for the latest minor release line of `@icedq/cli`.

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities **privately** — do not open a public
issue, pull request, or discussion for a suspected vulnerability.

Preferred channel:

- **GitHub Private Vulnerability Reporting** — use the "Report a vulnerability"
  button under the repository's **Security** tab.

Alternatively, email **security@icedq.ai** with:

- a description of the issue and its potential impact,
- steps to reproduce (proof-of-concept if available),
- affected version(s) and environment details.

## What to Expect

- **Acknowledgement** of your report within **3 business days**.
- An assessment and remediation plan, with regular status updates.
- A fix released as a new version, with the affected versions deprecated via
  `npm deprecate` where appropriate.
- Credit for the disclosure if you wish (let us know how you'd like to be named).

Please give us a reasonable window to remediate before any public disclosure.

## Handling Secrets

`@icedq/cli` reads credentials such as `ICEDQ_CLIENT_SECRET` from environment
variables and never logs them. When using the CLI in CI, store secrets in your
CI provider's secret store and pass them via environment variables rather than
on the command line, since command-line arguments can be exposed in shell
history and process listings.
