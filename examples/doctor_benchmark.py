"""Run the real-case offline doctor benchmark harness."""

from handoffkit.doctor_benchmark import run_doctor_benchmark

if __name__ == "__main__":
    result = run_doctor_benchmark(30)
    print(result.to_markdown())
