#include <handoffkit/train/runner.hpp>

#include <fstream>
#include <memory>

namespace handoffkit {
namespace train {

nlohmann::json TrainRunResult::to_json() const {
    return nlohmann::json{
        {"report", report.to_json()},
        {"handoff", handoff.to_json()},
        {"report_path", report_path.string()},
    };
}

nlohmann::json DistillThenTrainResult::to_json() const {
    return nlohmann::json{
        {"distill", distill.to_json()},
        {"train", train.to_json()},
    };
}

Result<TrainRunResult> run_train_job(
    const TrainJobSpec& job,
    TrainBackend& backend,
    const TrainRunOptions& options
) {
    if (job.job_id.empty()) {
        return Error::invalid_argument("job_id required", "job_id");
    }
    if (job.dataset.path.empty()) {
        return Error::invalid_argument("dataset.path required", "dataset");
    }

    auto report_r = backend.run(job, options.progress);
    if (!report_r) return report_r.error();

    TrainRunResult result;
    result.report = std::move(report_r.value());

    std::error_code ec;
    std::filesystem::create_directories(job.config.output_dir, ec);
    if (options.write_report_json) {
        result.report_path = job.config.output_dir / "train_report.json";
        std::ofstream out(result.report_path, std::ios::binary);
        if (out) {
            out << result.report.to_json().dump(2);
            result.report.artifact_paths.push_back(result.report_path.string());
        }
    }

    if (options.emit_handoff) {
        result.handoff.task = "Evaluate trained student / package artifacts";
        result.handoff.from_agent = "student_trainer";
        result.handoff.to_agent = "evaluator";
        result.handoff.summary = result.report.success
            ? ("Train job " + job.job_id + " succeeded via " + result.report.backend_id)
            : ("Train job " + job.job_id + " failed: " + result.report.error);
        result.handoff.decisions = {
            result.report.success ? "Artifacts ready under output_dir" : "Inspect train log",
        };
        result.handoff.next_steps = {
            "Score student on held-out prompts",
            "Register model id if packaging",
        };
        result.handoff.important_files = result.report.artifact_paths;
        result.handoff.metadata = {
            {"train_report", result.report.to_json()},
            {"job", job.to_json()},
        };
    }
    return result;
}

Result<DistillThenTrainResult> distill_then_train(
    AnyProvider& teacher,
    const std::vector<std::string>& prompts,
    TrainBackend& student_backend,
    const DistillThenTrainConfig& config
) {
    auto d = distill_generate(teacher, prompts, config.distill);
    if (!d) return d.error();

    TrainJobSpec job;
    job.job_id = config.job_id_prefix + "_" + d.value().dataset.id;
    job.kind = TrainJobKind::DistillSft;
    job.dataset = d.value().dataset;
    job.config = config.train;
    if (job.config.backend_id.empty()) {
        job.config.backend_id = student_backend.id();
    }
    job.meta = {{"pipeline", "distill_then_train"}};

    TrainRunOptions opts;
    opts.emit_handoff = true;
    auto tr = run_train_job(job, student_backend, opts);
    if (!tr) return tr.error();

    DistillThenTrainResult out;
    out.distill = std::move(d.value());
    out.train = std::move(tr.value());
    return out;
}

std::unique_ptr<TrainBackend> make_train_backend(std::string_view backend_id) {
    if (backend_id == "process") {
        return std::make_unique<ProcessTrainBackend>();
    }
    return std::make_unique<EchoTrainBackend>();
}

}  // namespace train
}  // namespace handoffkit
