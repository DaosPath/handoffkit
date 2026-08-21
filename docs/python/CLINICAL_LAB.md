# Clinical Sequential Reasoning Lab (1.20)

Status: **experimental / research and education only / not clinically validated**.

This is not medical advice, not clinical decision support, not a device, and
not a reproduction of MAI-DxO or SDBench. Methodology takes sequential-diagnosis
principles from [Microsoft Research](https://www.microsoft.com/en-us/research/publication/sequential-diagnosis-with-language-models/)
and the public [MedCaseReasoning](https://huggingface.co/datasets/zou-lab/MedCaseReasoning) test
([paper](https://arxiv.org/abs/2505.11733)).

## Capability matrix

| Capability | Status |
|---|---|
| Deterministic sandbox (predefined cases) | experimental |
| Clinical validity | unavailable |
| Official 897-case run | unavailable |
| Independent semantic judges | unavailable |
| Live model providers (Ollama/NVIDIA/Groq) | unavailable (adapter scaffold only) |
| Retrieval-assisted live track | unavailable (Browser Real not connected) |
| PostgreSQL store | planned |
| Durable local JSON/SQLite recovery | experimental (atomic write + checksum tests) |
| Official corpus pin + full checksum | unavailable (no confirmed commit SHA; hash is not invented) |

## Honesty

- `correct` is fail-closed without independent judges. Coverage and calibration
  never vote on diagnosis correctness.
- `exact_match` / `alias_match` are regression metrics only. They are not
  clinical accuracy and must not be published as such.
- `clinical_validity` is always `null`. Results are marked `heuristic_only`
  unless independent judges are supplied.
- Local heuristic functions are not “three blind judges”.
- `gold_replay` is a recorded fixture only. It never counts as accuracy.
- Official scored runs require **exactly 897** test cases, three independent
  judges, and `status=complete`. No 897/897 score is claimed.
- This is a predefined-case sandbox. Personal symptoms, identifiers, and
  free-text personal cases are rejected on create and on every action.
  Detection is heuristic, not a perfect PHI filter. Rejected text is not
  persisted, logged, or echoed.
- Research experience never falls back to the professional sandbox.
- A recorded execution must come from an immutable fixture. Dynamically
  generated runs are labeled `live_sandbox`.
- Resource units are the primary cost metric. USD profiles are optional and
  labeled simulated.
- No treatment or prescription is offered.

## Python

```bash
handoffkit clinical run --experience professional --blind-id pro-sandbox-001 --json
handoffkit clinical benchmark --official
handoffkit clinical audit reports/some-report.json
handoffkit clinical serve --port 8787
```

`handoffkit.clinical` is the canonical engine. Import it as a module; it is not
part of the frozen root `handoffkit.__all__`. The HTTP demo binds loopback and
returns JSON snapshots, not a live event stream.

## JavaScript

`@handoffkit/clinical` is browser-safe contracts plus `ClinicalClient`.
The Node engine lives at `@handoffkit/clinical/engine`.

## Studio

`/demos/clinical-lab` has three experiences: research (unavailable until the
corpus is pinned), professional sandbox, and a public simulated-case explorer.
The old `/demos/mai-style-panel` is a deprecated adapter and no longer accepts
free-text personal cases. The adapter has a separate local Ollama path that
discovers installed models at runtime; this does not make the Clinical Lab's
live-provider capability available and does not change any clinical-validity
or 897-case status.

## Official corpus

The official corpus is **unavailable**. `DATASET_REVISION_PIN` is empty because
`main` is not an immutable pin. A real pin must be a 40-character commit SHA
with a SHA-256 of the full canonical case content. The 897 cases are not
bundled. Until that build exists, `clinical benchmark --official` fails closed
with `run_incomplete`.
