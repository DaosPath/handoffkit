# HandoffKit Threat Model (P2)

**Scope:** Python package `handoffkit`, JS `@handoffkit/*`, Studio web (`apps/web`).  
**Not in scope:** Local gitignored workspaces under `.local-tests/`, third-party model hosts.

## Assets

| Asset | Sensitivity |
|-------|-------------|
| API keys (provider env vars) | High |
| HandoffState / traces / reports | Medium–High (may contain task text) |
| Tool side effects (FS, shell) | High |
| Studio run history | Medium |
| Benchmark corpora | Low–Medium |

## Trust boundaries

1. **Untrusted model output** → tool calls, handoff fields, structured JSON.
2. **Untrusted user task text** → prompts, paths, shell commands.
3. **Workspace FS** → must not escape sandbox root.
4. **Studio HTTP** → local demo surface; not multi-tenant hardened yet.
5. **CI/CD publish** → OIDC to PyPI/npm; no long-lived PyPI tokens in repo.

## Threats & mitigations

| Threat | Mitigation (status) |
|--------|---------------------|
| Shell injection via tools | `shell=False` argv only; metacharacters blocked; dangerous command denylist (**P0**) |
| Path traversal via file tools | Workspace sandbox (`ToolSandbox` / `HANDOFFKIT_WORKSPACE`) (**P0**) |
| Unexpected mutating tools | Approvals default **on** for `run_command` / `write_file` (**P0**) |
| Prompt injection → tool abuse | Structured tool schemas; require_approval; never auto-approve in prod |
| Secret leakage in logs/traces | Do not put keys in HandoffState; redaction in providers tests; Studio should avoid logging Authorization headers |
| Supply chain (release) | Trusted Publishing; CI quality-gate before publish |
| Studio multi-user abuse | Auth/workspaces foundation only; **not production multi-tenant** until DB auth lands |
| Medical data misuse | Benchmarks labeled educational; not clinical advice |

## Residual risks

- Model-driven tools can still do harm **inside** the workspace after approval bypass.
- Studio file-backed history is single-node; no encryption at rest by default.
- JS/Python provider HTTP clients trust configured base URLs (SSRF risk if user-controlled).
- Extended APIs may change faster than Stable; pin versions in production.

## Recommended production posture

1. Set `HANDOFFKIT_WORKSPACE` to a dedicated directory.
2. Keep `require_approval=True` (default) for agent tool loops; explicit allowlist in your app.
3. Do not expose Studio demos publicly without auth + rate limits.
4. Pin `handoffkit==x.y.z` and review CHANGELOG for security notes.
5. Treat model output as untrusted input at every boundary.

## Contact

Security issues: see root `SECURITY.md`.
