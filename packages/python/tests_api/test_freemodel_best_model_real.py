import os

import pytest

from handoffkit import Agent
from handoffkit.providers import OpenAIProvider, choose_openai_compatible_model

pytestmark = pytest.mark.skipif(
    os.getenv("HANDOFFKIT_RUN_API_TESTS") != "1",
    reason="Set HANDOFFKIT_RUN_API_TESTS=1 to run real API tests.",
)


def test_freemodel_best_model_real_response() -> None:
    if not os.getenv("OPENAI_API_KEY"):
        pytest.skip("OPENAI_API_KEY is required for real API tests.")

    selection = choose_openai_compatible_model(
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.freemodel.dev/v1"),
        timeout=45.0,
    )
    provider = OpenAIProvider(
        model=selection.model,
        base_url=selection.base_url,
        timeout=45.0,
    )
    agent = Agent(
        name="FreemodelBestModelRealTest",
        role="Reply briefly and clearly.",
        provider=provider,
    )
    response = agent.run(
        "Create a concise architecture plan for a Python CLI calculator.",
        max_tokens=120,
        temperature=0,
    )

    assert selection.model
    assert isinstance(response, str)
    assert response.strip()
