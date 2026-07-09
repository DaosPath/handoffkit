# @handoffkit/providers

Provider registry and routing for HandoffKit JavaScript.

```js
import { ProviderSelector, suggestedCandidates } from "@handoffkit/providers";

const selector = new ProviderSelector({
  candidates: suggestedCandidates("openrouter"),
});

const result = await selector.select({ real: false });
console.log(result.candidate.model);
```

Network probes are opt-in. Offline commands return known provider metadata.
