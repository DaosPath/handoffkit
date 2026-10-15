#include <handoffkit/train/backend.hpp>
#include <handoffkit/train/dataset.hpp>

#include <chrono>
#include <cstdio>
#include <fstream>
#include <sstream>

#if defined(_WIN32)
#include <stdlib.h>
#define handoffkit_popen _popen
#define handoffkit_pclose _pclose
#else
#define handoffkit_popen popen
#define handoffkit_pclose pclose
#endif

namespace handoffkit {
namespace train {
namespace {

std::int64_t now_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

Result<void> ensure_dir(const std::filesystem::path& p) {
    std::error_code ec;
    std::filesystem::create_directories(p, ec);
    if (ec) {
        return Result<void>::failure(
            Error::invalid_argument("cannot create dir: " + p.string() + " " + ec.message())
        );
    }
    return Result<void>::success();
}

std::string substitute(std::string s, const TrainJobSpec& job) {
    auto rep = [&](const std::string& key, const std::string& val) {
        const std::string token = "{" + key + "}";
        for (std::size_t pos = 0; (pos = s.find(token, pos)) != std::string::npos;) {
            s.replace(pos, token.size(), val);
            pos += val.size();
        }
    };
    rep("dataset", job.dataset.path.string());
    rep("output_dir", job.config.output_dir.string());
    rep("epochs", std::to_string(job.config.epochs));
    rep("base_model", job.config.base_model);
    rep("job_id", job.job_id);
    rep("learning_rate", std::to_string(job.config.learning_rate));
    return s;
}

}  // namespace

Result<TrainReport> EchoTrainBackend::run(const TrainJobSpec& job, TrainProgressFn progress) {
    const auto t0 = now_ms();
    TrainReport report;
    report.job_id = job.job_id;
    report.backend_id = id();

    auto examples = load_jsonl(job.dataset.path);
    if (!examples) {
        report.success = false;
        report.error = examples.error().message;
        report.wall_ms = static_cast<int>(now_ms() - t0);
        return report;  // return report as success Result carrying failure flags
    }
    auto& exs = examples.value();
    if (exs.empty()) {
        report.success = false;
        report.error = "dataset empty";
        report.wall_ms = static_cast<int>(now_ms() - t0);
        return report;
    }

    auto ed = ensure_dir(job.config.output_dir);
    if (!ed) {
        report.success = false;
        report.error = ed.error().message;
        report.wall_ms = static_cast<int>(now_ms() - t0);
        return report;
    }

    const int epochs = std::max(1, job.config.epochs);
    int steps = job.config.max_steps;
    if (steps <= 0) steps = epochs * static_cast<int>(exs.size());

    report.metrics.examples_seen = exs.size();
    report.metrics.steps = steps;
    double loss = 1.0;
    int step = 0;
    for (int e = 1; e <= epochs; ++e) {
        loss = loss * 0.7 + 0.05;  // fake decay
        report.metrics.loss_per_epoch.push_back(loss);
        if (progress) {
            progress(e, step, "echo epoch " + std::to_string(e) + " loss=" + std::to_string(loss));
        }
        step += static_cast<int>(exs.size());
        if (step >= steps) break;
    }
    report.metrics.final_loss = report.metrics.loss_per_epoch.empty()
        ? 0.0
        : report.metrics.loss_per_epoch.back();

    const auto metrics_path = job.config.output_dir / "metrics.json";
    const auto marker_path = job.config.output_dir / "adapter.echo.json";
    const auto log_path = job.config.output_dir / "train.log";

    {
        std::ofstream m(metrics_path, std::ios::binary);
        m << report.metrics.to_json().dump(2);
    }
    {
        nlohmann::json marker{
            {"backend", "echo"},
            {"base_model", job.config.base_model},
            {"job_id", job.job_id},
            {"examples", exs.size()},
            {"note", "synthetic adapter marker — not a real weight file"},
        };
        std::ofstream a(marker_path, std::ios::binary);
        a << marker.dump(2);
    }
    {
        std::ofstream log(log_path, std::ios::binary);
        log << "EchoTrainBackend job=" << job.job_id << "\n"
            << "dataset=" << job.dataset.path.string() << "\n"
            << "epochs=" << epochs << " steps=" << steps << "\n"
            << "final_loss=" << report.metrics.final_loss << "\n";
    }

    report.log_path = log_path;
    report.artifact_paths = {metrics_path.string(), marker_path.string(), log_path.string()};
    report.success = true;
    report.meta = {
        {"dataset_count", exs.size()},
        {"epochs", epochs},
    };
    report.wall_ms = static_cast<int>(now_ms() - t0);
    return report;
}

Result<TrainReport> ProcessTrainBackend::run(const TrainJobSpec& job, TrainProgressFn progress) {
    const auto t0 = now_ms();
    TrainReport report;
    report.job_id = job.job_id;
    report.backend_id = id();

    if (job.config.extra_args.empty()) {
        report.success = false;
        report.error = "process backend requires config.extra_args (argv)";
        report.wall_ms = static_cast<int>(now_ms() - t0);
        return report;
    }

    auto ed = ensure_dir(job.config.output_dir);
    if (!ed) {
        report.success = false;
        report.error = ed.error().message;
        report.wall_ms = static_cast<int>(now_ms() - t0);
        return report;
    }

    std::ostringstream cmd;
    for (std::size_t i = 0; i < job.config.extra_args.size(); ++i) {
        if (i) cmd << ' ';
        std::string part = substitute(job.config.extra_args[i], job);
        // naive quote if spaces
        if (part.find(' ') != std::string::npos) {
            cmd << '"' << part << '"';
        } else {
            cmd << part;
        }
    }

    if (progress) progress(0, 0, "process: " + cmd.str());

    const auto log_path = job.config.output_dir / "process_train.log";
    std::string full = cmd.str() + " 2>&1";
    FILE* pipe = handoffkit_popen(full.c_str(), "r");
    if (!pipe) {
        report.success = false;
        report.error = "popen failed for: " + cmd.str();
        report.wall_ms = static_cast<int>(now_ms() - t0);
        return report;
    }
    std::string captured;
    char buf[4096];
    while (fgets(buf, sizeof(buf), pipe)) {
        captured += buf;
    }
    const int rc = handoffkit_pclose(pipe);

    {
        std::ofstream log(log_path, std::ios::binary);
        log << "cmd: " << cmd.str() << "\nexit: " << rc << "\n\n" << captured;
    }
    report.log_path = log_path;
    report.artifact_paths = {log_path.string()};
    report.meta = {{"exit_code", rc}, {"cmd", cmd.str()}};

    if (rc != 0) {
        report.success = false;
        report.error = "trainer process exit " + std::to_string(rc);
        report.wall_ms = static_cast<int>(now_ms() - t0);
        return report;
    }
    report.success = true;
    report.metrics.final_loss = 0.0;
    report.metrics.steps = 1;
    if (progress) progress(1, 1, "process backend finished ok");
    report.wall_ms = static_cast<int>(now_ms() - t0);
    return report;
}

}  // namespace train
}  // namespace handoffkit
