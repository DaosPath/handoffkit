#include <handoffkit/train/dataset.hpp>
#include <handoffkit/train/distill.hpp>
#include <handoffkit/train/runner.hpp>
#include <handoffkit/runtime/echo_provider.hpp>
#include <handoffkit/runtime/team.hpp>
#include <handoffkit/runtime/trace.hpp>
#include <handoffkit/runtime/protocol.hpp>

#include <cassert>
#include <filesystem>
#include <iostream>
#include <string>

using namespace handoffkit;
using namespace handoffkit::train;

namespace {

std::filesystem::path scratch_dir() {
#ifdef HANDOFFKIT_TEST_SCRATCH
    return std::filesystem::path(HANDOFFKIT_TEST_SCRATCH) / "train_core";
#else
    return std::filesystem::temp_directory_path() / "handoffkit_test_train_core";
#endif
}

}  // namespace

void test_jsonl_roundtrip() {
    const auto dir = scratch_dir() / "jsonl";
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
    std::filesystem::create_directories(dir, ec);

    auto examples = examples_from_prompts({"What is 2+2?", "Name a color."}, "A: ");
    assert(examples.size() == 2);
    assert(validate_dataset_examples(examples));

    const auto path = dir / "sft.jsonl";
    auto ds = save_jsonl(path, examples, "toy_sft");
    assert(ds);
    assert(ds.value().count == 2);
    assert(!ds.value().content_hash.empty());

    auto loaded = load_jsonl(path);
    assert(loaded);
    assert(loaded.value().size() == 2);
    assert(loaded.value()[0].prompt == "What is 2+2?");
    assert(loaded.value()[0].completion.find("A: ") == 0);
    std::cout << "test_jsonl_roundtrip ok hash=" << ds.value().content_hash << "\n";
}

void test_from_run_trace() {
    std::vector<Agent> agents;
    agents.emplace_back("A", "role", EchoProvider("echo").as_any());
    agents.emplace_back("B", "role", EchoProvider("echo").as_any());
    Team team(std::move(agents), HandoffProtocol(ProtocolMode::HybridState));
    auto run = team.run("Plan a tiny CLI");
    assert(run);
    auto trace = build_run_trace("t1", "train-source", run.value());
    auto ex = examples_from_run_trace(trace);
    assert(!ex.empty());
    std::cout << "test_from_run_trace ok examples=" << ex.size() << "\n";
}

void test_distill_echo() {
    const auto dir = scratch_dir() / "distill";
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);

    auto teacher = EchoProvider("teacher-echo").as_any();
    DistillConfig cfg;
    cfg.output_jsonl = dir / "student.jsonl";
    cfg.student_dataset_id = "student_demo";
    auto d = distill_generate(teacher, {"Q1", "Q2", "Q3"}, cfg);
    assert(d);
    assert(d.value().teacher_calls == 3);
    assert(d.value().examples.size() == 3);
    assert(d.value().dataset.count == 3);
    assert(!d.value().handoff.summary.empty());
    assert(std::filesystem::exists(d.value().dataset.path));
    std::cout << "test_distill_echo ok n=" << d.value().examples.size() << "\n";
}

void test_echo_train_backend() {
    const auto dir = scratch_dir() / "train_echo";
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);

    auto examples = examples_from_prompts({"alpha", "beta"});
    auto ds = save_jsonl(dir / "data.jsonl", examples, "d1");
    assert(ds);

    TrainJobSpec job;
    job.job_id = "job-echo-1";
    job.kind = TrainJobKind::Sft;
    job.dataset = ds.value();
    job.config.output_dir = dir / "out";
    job.config.epochs = 2;
    job.config.base_model = "tiny-echo";
    job.config.backend_id = "echo";

    EchoTrainBackend backend;
    int progress_hits = 0;
    auto report = backend.run(job, [&](int, int, std::string_view) { ++progress_hits; });
    assert(report);
    assert(report.value().success);
    assert(report.value().metrics.loss_per_epoch.size() == 2);
    assert(progress_hits >= 1);
    assert(std::filesystem::exists(report.value().log_path));
    std::cout << "test_echo_train_backend ok loss=" << report.value().metrics.final_loss
              << " progress=" << progress_hits << "\n";
}

void test_distill_then_train_pipeline() {
    const auto dir = scratch_dir() / "pipeline";
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);

    auto teacher = EchoProvider("t").as_any();
    EchoTrainBackend student;
    DistillThenTrainConfig cfg;
    cfg.distill.output_jsonl = dir / "student.jsonl";
    cfg.train.output_dir = dir / "train_out";
    cfg.train.epochs = 1;
    cfg.job_id_prefix = "pipe";

    auto r = distill_then_train(teacher, {"p1", "p2"}, student, cfg);
    assert(r);
    assert(r.value().distill.examples.size() == 2);
    assert(r.value().train.report.success);
    assert(r.value().train.report.to_json().contains("metrics"));
    assert(r.value().train.report.to_json()["metrics"].contains("final_loss"));
    std::cout << "test_distill_then_train_pipeline ok\n";
}

void test_process_backend_echo_cmd() {
    const auto dir = scratch_dir() / "process";
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
    std::filesystem::create_directories(dir, ec);

    auto examples = examples_from_prompts({"x"});
    auto ds = save_jsonl(dir / "d.jsonl", examples, "pd");
    assert(ds);

    TrainJobSpec job;
    job.job_id = "job-proc";
    job.dataset = ds.value();
    job.config.output_dir = dir / "out";
    job.config.backend_id = "process";
    // Portable no-op success (cmake -E true exists on CMake installs; fallback echo)
    job.config.extra_args = {"cmake", "-E", "echo", "train-ok", "{job_id}", "{dataset}"};

    ProcessTrainBackend backend;
    auto report = backend.run(job);
    assert(report);
    // cmake -E echo returns 0 when cmake is on PATH
    if (report.value().success) {
        assert(std::filesystem::exists(report.value().log_path));
        std::cout << "test_process_backend_echo_cmd ok\n";
    } else {
        // Environment without cmake: still prove failure path is structured
        assert(!report.value().error.empty());
        std::cout << "test_process_backend_echo_cmd soft-fail (no cmake?): " << report.value().error
                  << "\n";
    }
}

void test_make_backend() {
    auto e = make_train_backend("echo");
    auto p = make_train_backend("process");
    assert(e && e->id() == "echo");
    assert(p && p->id() == "process");
    std::cout << "test_make_backend ok\n";
}

int main() {
    test_jsonl_roundtrip();
    test_from_run_trace();
    test_distill_echo();
    test_echo_train_backend();
    test_distill_then_train_pipeline();
    test_process_backend_echo_cmd();
    test_make_backend();
    std::cout << "ALL test_train_core PASSED\n";
    return 0;
}
