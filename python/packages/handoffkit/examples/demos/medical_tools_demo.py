"""Demo public medical evidence lookup tools.

This is for research/benchmark workflows only. It is not medical advice.
"""

from __future__ import annotations

import json

from handoffkit.tools import clinical_trials_search, dailymed_drug_search, pubmed_search


def main() -> int:
    pubmed = pubmed_search.run(query="scleroderma renal crisis case report", max_results=2)
    trials = clinical_trials_search.run(condition="systemic sclerosis", max_results=2)
    labels = dailymed_drug_search.run(drug_name="ibuprofen", max_results=2)
    print(
        json.dumps(
            {
                "pubmed": pubmed,
                "clinical_trials": trials,
                "dailymed": labels,
                "safety_note": "Research lookup only; not medical advice.",
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
