"""Real-world customer support escalation showcase."""

from handoffkit import run_showcase

if __name__ == "__main__":
    result = run_showcase("support-escalation")
    print(result.to_markdown())
