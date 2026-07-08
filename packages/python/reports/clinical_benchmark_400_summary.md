# Clinical Benchmark 400 Summary

> Research-only educational benchmark. This is not a medical device, not clinical
> validation, and must not be used for patient care or diagnostic decisions.

## Run

- Date completed: 2026-07-07
- Model: `mimo-v2.5`
- Provider: OpenCode Go
- Orchestration: MAI-style HandoffKit clinical panel
- Max tokens per stage: `32768`
- Cases: `400`
- Shards: `16` files of `25` cases
- Detailed local artifacts: `C:\Hijosdelsol\handoffkit\reports\opencode_mimo_clinical_mai_400_*.json`

## Result

- Correct: `233 / 400`
- Accuracy: `58.25%`
- Misses: `167 / 400`
- Missing cases: `0`
- Total shard runtime: `71082.21s` (`19.75h`)

## Shard Scores

| Shard | Cases | Correct | Accuracy |
| --- | ---: | ---: | ---: |
| 0001-0025 | 25 | 16 | 64% |
| 0026-0050 | 25 | 16 | 64% |
| 0051-0075 | 25 | 16 | 64% |
| 0076-0100 | 25 | 14 | 56% |
| 0101-0125 | 25 | 14 | 56% |
| 0126-0150 | 25 | 13 | 52% |
| 0151-0175 | 25 | 14 | 56% |
| 0176-0200 | 25 | 18 | 72% |
| 0201-0225 | 25 | 15 | 60% |
| 0226-0250 | 25 | 18 | 72% |
| 0251-0275 | 25 | 13 | 52% |
| 0276-0300 | 25 | 14 | 56% |
| 0301-0325 | 25 | 12 | 48% |
| 0326-0350 | 25 | 13 | 52% |
| 0351-0375 | 25 | 12 | 48% |
| 0376-0400 | 25 | 15 | 60% |

## Notes

- The first long run stopped near the final shard because Windows console encoding
  could not print a Unicode hyphen. The run was resumed from cached partials and
  completed without repeating the full benchmark.
- Full model outputs, partials, logs, and OpenCode benchmark artifacts are
  intentionally kept local and ignored by Git.
- This summary is small enough to share in documentation, but should always carry
  the research-only safety note above.

## Suggested Next Analysis

- Separate infrastructure failures from clinical misses using audit reports.
- Group misses by domain: tumor/pathology, infectious disease, endocrine,
  electrolyte, neuro, drug reaction, and rare syndrome.
- Compare base pass vs rescue pass on only failed or low-confidence cases.
- Run a second model or ensemble only on unresolved misses to control cost.
