"""Real-world coding agents showcase."""

from handoffkit import run_showcase

if __name__ == "__main__":
    result = run_showcase("coding-review")
    print(result.to_markdown())
