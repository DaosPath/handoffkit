"""Run the public MAI-style sequential doctor benchmark."""

from handoffkit.mai_benchmark import run_mai_style_benchmark

if __name__ == "__main__":
    result = run_mai_style_benchmark(30)
    print(result.to_markdown())
