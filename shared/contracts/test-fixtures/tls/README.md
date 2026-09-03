# TLS test fixtures

`generate.py` creates a fresh certificate hierarchy with PyCA `cryptography`
for Python, Node, Go, and Rust integration tests. Its required `--output`
directory must be outside the repository. Private keys exist only in that
temporary directory, use mode `0600` where supported, and are never committed.

Valid certificates use a short window relative to generation time. The expired
certificate is generated with a validity window wholly in the past.

Example:

```console
python generate.py --output /tmp/handoffkit-tls-fixtures
```

Identity URI format:

`spiffe://<trust-domain>/peer/<peer-id>/node/<node-id>[/worker/<worker-id>]`
