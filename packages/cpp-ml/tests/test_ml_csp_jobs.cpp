#include <handoffkit/ml/csp_jobs.hpp>

#include <cassert>

int main() {
    handoffkit::csp::TrainingJob job;
    job.job_id = "train-1";
    job.dataset.uri = "file:///workspace/train.jsonl";
    job.output = "file:///workspace/run";
    job.config = {{"epochs", 5}, {"device", "cpu"}};

    const auto adapted = handoffkit::ml::adapt_training_job(job);
    assert(adapted.config.epochs == 5);
    assert(adapted.config.device == "cpu");
    assert(adapted.dataset_path == "/workspace/train.jsonl");

    const auto progress = handoffkit::ml::make_job_progress(
        "train-1", "training", "running", 2, 10, 1.25, "2026-01-01T00:00:00Z"
    );
    assert(progress.progress == 0.2);
    assert(progress.loss == 1.25);
    return 0;
}
