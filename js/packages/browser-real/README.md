# @handoffkit/browser-real

Supervised Browser Real service. Headless Chromium is the first engine, launched
only by this package. `@handoffkit/browser` never imports this module.

Chromium is **not** installed as a hidden postinstall. Install it explicitly:

```bash
pnpm --dir js/packages/browser-real run install-chromium
```

The service speaks Browser Core commands/events over the existing Node TLS 1.3
mTLS transport. The CLI requires `HANDOFFKIT_BROWSER_REAL_CONFIG` (endpoint,
CA/cert/key, trust domain, fingerprint grants, replay/state stores, artifact
root, profile root, policy). Without a valid file it exits; it never opens an
insecure listener.

Capabilities are a live getter after each probe. CAPTCHA/challenge pages return
`provider_challenge` with no bypass. The default profile is ephemeral and
isolated; the operator's normal browser profile is never reused. Persistence is
only via a managed `profile_id` under `profileRoot`.

The default non-persistent supervisor owns a Playwright `BrowserServer` and
tracks its child PID. A real Chromium process exit is surfaced as
`session.interrupted`; `session.retry` starts a fresh process and revalidates
the last URL. Shutdown closes the owned process. This is recovery evidence,
not a four-hour stability or cross-architecture guarantee.

In-process `dispatch()` is a test adapter. Network clients must send CSP
envelopes on channel `browser.control` (`kind=request|response`,
`payload_type=browser.command|browser.event`, monotonic sequence, cryptographic
nonce, certificate-derived `source`).

Local evidence commands (after the explicit Chromium install) are:

```bash
HANDOFFKIT_BROWSER_REAL_PLAYWRIGHT=1 pnpm --dir js/packages/browser-real test test/playwright.test.js
node scripts/js/browser-real-bench.mjs
```

The benchmark writes `reports/BROWSER_1.20_REAL_BENCH.json` with environmental
p50/p95/p99 measurements. It does not replace the hosted 4-hour/1000-navigation
soak gate.

Egress policy is fail-closed for literal private/loopback subresources, DNS
answers containing non-global addresses, and redirect targets. Chromium uses a
CDP Fetch interceptor for real request/redirect coverage; the route hook remains
the compatibility path for non-Chromium engines.
