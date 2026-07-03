# Security Policy

## Supported Versions

Security fixes are currently supported for the HandoffKit `1.x` release line.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately using GitHub Security
Advisories for `DaosPath/handoffkit` when available.

If private advisories are not available, open a minimal GitHub issue asking for
a secure contact path. Do not include exploit details, credentials, API keys, or
other secrets in a public issue.

## Secret Handling

HandoffKit release automation is designed for PyPI Trusted Publishing. Package
tokens should not be committed to the repository, printed in logs, or stored in
workflow files.
