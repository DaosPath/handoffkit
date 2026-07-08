import os

import pytest

from handoffkit import Agent
from handoffkit.providers import OpenAIProvider

pytestmark = pytest.mark.skipif(
    os.getenv("HANDOFFKIT_RUN_API_TESTS") != "1",
    reason="Set HANDOFFKIT_RUN_API_TESTS=1 to run real API tests.",
)


def test_openai_compatible_provider_real_response() -> None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        pytest.skip("OPENAI_API_KEY is required for real API tests.")

    provider = OpenAIProvider(
        api_key=api_key,
        base_url=os.getenv("OPENAI_BASE_URL"),
        model=os.getenv("OPENAI_MODEL"),
        timeout=45.0,
    )
    agent = Agent(
        name="OpenAICompatibleRealTest",
        role="Reply with the requested phrase only.",
        provider=provider,
    )
    response = agent.run(
        "Reply with exactly: HandoffKit API OK",
        max_tokens=20,
        temperature=0,
    )

    assert isinstance(response, str)
    assert response.strip()
