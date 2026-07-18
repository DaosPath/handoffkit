# Fusion-style Panel Demo

> Research-only orchestration demo. Not medical advice, not clinical validation, and not for patient care.

## Task

Design a next-pass strategy for a research-only clinical benchmark that scored 233/400 with MiMo. Improve reliability without using gold labels or making clinical claims.

## Panel

| Model | Role | Confidence | Answer |
|---|---|---|---|
| mimo-v2.5/offline | broad diagnostician | medium | Use a domain router before expensive reasoning: pathology, infection, endocrine/electrolyte, neuro, drug reaction, and rare syndrome. |
| deepseek-v4-pro/offline | mechanism checker | medium-high | Require every final label to cite case evidence and a competing diagnosis it ruled out. Penalize answers without mechanism. |
| glm-5.2/offline | adversarial reviewer | high | Run rescue only on low-confidence or disagreement cases. Generic reruns waste budget and did not move the score enough. |
| qwen3.7-max/offline | retrieval planner | medium-high | Generate 3-5 retrieval queries per case, then build a compact evidence packet before the panel votes. |

## Judge Analysis

### Consensus
- Use multiple specialist perspectives instead of one generic rerun.
- Run retrieval before final voting, not only inside the final prompt.
- Reserve rescue for failed, low-confidence, or disagreement cases.

### Contradictions
- Breadth-first diagnosis can increase recall but also broad false positives.
- Mechanism-heavy review improves precision but may miss rare presentations.

### Coverage Gaps
- Need per-domain error taxonomy before claiming improvement.
- Need clean infra metrics separated from clinical misses.

### Unique Insights
- mimo-v2.5/offline: Use a domain router before expensive reasoning: pathology, infection, endocrine/electrolyte, neuro, drug reaction, and rare syndrome.
- deepseek-v4-pro/offline: Require every final label to cite case evidence and a competing diagnosis it ruled out. Penalize answers without mechanism.
- glm-5.2/offline: Run rescue only on low-confidence or disagreement cases. Generic reruns waste budget and did not move the score enough.
- qwen3.7-max/offline: Generate 3-5 retrieval queries per case, then build a compact evidence packet before the panel votes.

### Blind Spots
- No benchmark score should be marketed as clinical capability.
- Fusion can improve consistency, but it can also amplify shared false assumptions.

## Final Answer

Build HandoffKit Fusion as a research orchestrator: evidence planner -> parallel model panel -> contradiction judge -> targeted rescue -> final label normalizer. Track accuracy, clean accuracy, rescue gain, harmful rescue rate, and infra failures separately. Start offline/deterministic; enable real providers only with --real and cached shards.
