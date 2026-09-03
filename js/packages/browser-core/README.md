# @handoffkit/browser-core

I/O-free Browser Core contracts for HandoffKit 1.20. This package contains
canonical `snake_case` wire models only. It does not fetch HTTP, open sockets,
launch Chromium, or advertise engine capabilities.

`@handoffkit/browser` remains the compatibility facade and must not import
`@handoffkit/browser-real`.

## Install

```bash
pnpm add @handoffkit/browser-core
```

## Models

- `BrowserCapabilities`
- `BrowserPolicy`
- `BrowserSessionRequest` / `BrowserSessionState`
- `BrowserCommand` / `BrowserEvent`
- `SearchRequest` / `SearchResult`
- `ResearchJob` / `ResearchProgress` / `ResearchResult`
- `PageSnapshot`
- `DocumentRecord`
- `ProviderTrace`
- `BrowserError`

Every model includes `contract_version` where it is a top-level envelope, plus
request/command/session identifiers and timestamps when they apply.

## Conformance

Golden vectors live in `shared/contracts/conformance/browser-core-v1.json`.
Round-trip equality is required across JavaScript, Python, Rust, Go, and C++.
