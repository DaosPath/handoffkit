"""Experimental Cryptography Laboratory (Isolated - Non-Production)."""

IS_EXPERIMENTAL_RESEARCH_ONLY = True


class ResearchSecurityError(RuntimeError):
    """Raised when an attempt is made to use research crypto in production."""


def assert_research_enabled(explicit_ack: bool = False) -> None:
    if not explicit_ack:
        raise ResearchSecurityError(
            "Crypto Lab research primitives require explicit_ack=True "
            "and must never be run in production."
        )
