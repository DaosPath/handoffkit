"""Real-world research workflow showcase."""

from handoffkit import run_showcase

if __name__ == "__main__":
    result = run_showcase("research-workflow")
    print(result.to_markdown())
