# HandoffKit 1.20 Browser Platform — baseline (2026-08-13)

This file records the working tree at the start of the absorbed 1.20 train.
It is evidence for planning, not a release claim.

## Git

- Branch: `browser/1.20-platform`
- Recorded HEAD at plan application: `feb2112d7fdc4bf2cafdad4f99b7c5269a722caa`
  (`docs(browser): clarify host visibility boundary`)
- The uncommitted Browser Lite / recipes / Hermes Android / Draco / C++ work
  already on this tree was **preserved**. Nothing was reverted.

## Capability classification (at baseline)

| Capability | Status |
|---|---|
| Browser Core contracts (JS/Python/Rust/Go/C++) | implemented + conformance vectors |
| `@handoffkit/browser` Lite facade | implemented, compatibility preserved |
| `@handoffkit/browser-lite` named product | implemented (re-export) |
| `@handoffkit/browser-real` supervised service | implemented skeleton + security gates; Chromium probe not CI-proven |
| Platform search order + `provider_trace` | implemented (opt-in `search_plan=platform`) |
| `strict_provider` | implemented |
| HTML tables / JSON-LD / metadata | implemented in JS/Python |
| robots.txt heuristics | implemented |
| Workspace `project_index` | implemented, opt-in, not a web-wide index |
| ResearchPack v2 fields | implemented; live grounding benchmark not scored |
| Studio Browser Inspector | implemented; empty unless `HANDOFFKIT_STUDIO_BROWSER_EVENTS` |
| Hermes progress/sources | implemented as a client; does not host Chromium |
| Soak / packaging / 9/10 dimensions | not available |

## Non-claims

- 1.20 remains **beta** until every scorecard dimension is ≥9/10 with real gates.
- No PR, merge, tag, or publication follows from this baseline.
- Windows ARM64 is not claimed.
- Chromium is installed only by `pnpm --dir packages/js/browser-real run install-chromium`.
