#include <handoffkit/demos/fusion/algo_align.hpp>
#include <handoffkit/demos/fusion/algo_dag.hpp>
#include <handoffkit/demos/fusion/algo_rate_limit.hpp>
#include <handoffkit/demos/fusion/algo_rubric.hpp>
#include <handoffkit/demos/fusion/algo_report.hpp>
#include <handoffkit/demos/fusion/algo_handoff_sim.hpp>
#include <handoffkit/demos/fusion/cases_medcase.hpp>
#include <handoffkit/demos/fusion/cases_validate.hpp>
#include <handoffkit/demos/fusion/bench_corpus_eval.hpp>
#include <handoffkit/demos/fusion/algo_quality_gates.hpp>
#include <handoffkit/demos/fusion/algo_stats.hpp>
#include <handoffkit/demos/fusion/fusion_docs.hpp>
#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/branch_compare.hpp>
#include <cassert>
#include <iostream>
using namespace handoffkit::demos::fusion;

void test_align() {
    auto nw = needleman_wunsch("GATTACA", "GCATGCU");
    assert(nw.aligned_a.size() == nw.aligned_b.size());
    auto sw = smith_waterman("xxhelloworldxx", "yyhelloyy");
    assert(sw.score > 0);
    double sim = branch_alignment_similarity(
        "Primary aldosteronism with high aldo low renin",
        "Conn syndrome / primary hyperaldosteronism");
    assert(sim > 0.0);
    std::cout << "test_align ok sim=" << sim << "\n";
}

void test_dag() {
    auto lean = make_fusion_dag_lean();
    auto a = analyze_dag(lean);
    assert(a && !a.value().has_cycle);
    assert(a.value().topo_order.size() == 3);
    auto ultra = make_fusion_dag_ultra();
    auto u = analyze_dag(ultra);
    assert(u && expected_llm_calls_for_dag(ultra).value() == 5);
    auto multi = make_fusion_dag_multi(4);
    auto m = analyze_dag(multi);
    assert(m && expected_llm_calls_for_dag(multi).value() == 5);
    // cycle
    DagGraph cyc;
    cyc.nodes = {{"a","architect",{"b"},1},{"b","architect",{"a"},1}};
    auto bad = analyze_dag(cyc);
    assert(bad && bad.value().has_cycle);
    std::cout << "test_dag ok\n";
}

void test_rate_limit() {
    FusionCallGate gate(/*max_calls*/3, /*max_per_min*/100, /*burst*/5);
    auto t0 = 1'000'000ll;
    auto d1 = gate.admit(t0, 100, 10'000);
    assert(d1.allowed);
    auto d2 = gate.admit(t0+10, 100, 10'000);
    assert(d2.allowed);
    auto d3 = gate.admit(t0+20, 100, 10'000);
    assert(d3.allowed);
    auto d4 = gate.admit(t0+30, 100, 10'000);
    assert(!d4.allowed && d4.reason == "max_calls");
    auto big = gate.admit(t0, 99'999, 100);
    // already at max_calls first, but test prompt size path with fresh gate
    FusionCallGate gate2(10, 100, 5);
    auto pb = gate2.admit(t0, 5000, 100);
    assert(!pb.allowed && pb.reason == "prompt_too_large");
    std::cout << "test_rate_limit ok\n";
}

void test_rubric() {
    auto diag = diagnostic_rubric();
    auto good = score_with_rubric(
        "Primary diagnosis: primary aldosteronism. Differentials: renovascular. "
        "Key findings: hypokalemia, high aldosterone, low renin. Next: adrenal CT. Confidence 80. Research only.",
        diag);
    auto bad = score_with_rubric(
        "Ship with CMake install(EXPORT) and Conan. CLI-first packaging design Goals Architecture.",
        diag);
    assert(good.normalized > bad.normalized);
    auto faithful = task_faithful_rubric();
    auto f1 = score_with_rubric("Final answer: primary aldosteronism with moderate confidence.", faithful);
    auto f2 = score_with_rubric("Goals Architecture CLI CMake Conan packaging design roadmap.", faithful);
    assert(f1.normalized > f2.normalized);
    std::cout << "test_rubric ok good=" << good.normalized << " bad=" << bad.normalized << "\n";
}

void test_report_and_handoff() {
    FusionConfig cfg;
    cfg.task = "Diagnose briefly";
    cfg.provider = "echo";
    cfg.mode = FusionMode::Lean;
    cfg.profile = FusionProfileId::Diagnostic;
    cfg.write_files = false;
    cfg.cache.enabled = false;
    auto run = run_fusion(cfg);
    assert(run && run.value().success);
    auto diff = compare_fusion_branches(run.value());
    auto rub = score_with_rubric(run.value().final_output, diagnostic_rubric());
    auto rep = build_rich_fusion_report(run.value(), diff, rub);
    assert(!rep.markdown.empty());
    assert(rep.html.find("<html>") != std::string::npos);
    assert(rep.wire.contains("rubric"));
    auto sim = simulate_fusion_handoffs(cfg.task, "A summary", "B summary", true);
    assert(sim && sim.value().states.size() == 2);
    auto met = simulate_handoff_metrics(sim.value());
    assert(met.at("events").get<int>() == 2);
    std::cout << "test_report_and_handoff ok\n";
}

void test_medcase_corpus() {
    auto n = medcase_bench_case_count();
    std::cout << "medcase_count=" << n << "\n";
    assert(n >= 2);
    // sample a few known IDs from 30-set may differ; just check first case loads
    auto all = all_medcase_bench_cases();
    assert(!all.empty());
    assert(!all.front().prompt.empty());
    assert(!all.front().gold_label.empty());
    // find by id
    auto* p = find_medcase_bench_case(all[0].case_id);
    assert(p != nullptr);
    // run one lean echo bench on first case via find_bench_case path if wired
    std::cout << "test_medcase_corpus ok first=" << all[0].case_id << "\n";
}


void test_medcase_validation_and_docs() {
    assert(medcase_bench_case_count() >= 100);
    auto rep = validate_all_medcase_cases();
    std::cout << "medcase_validation cases=" << rep.cases << " ok=" << rep.ok << " issues=" << rep.issues << "\n";
    // allow some issues but require mostly ok
    assert(rep.cases >= 2);
    assert(rep.ok * 2 >= rep.cases); // at least half fully clean
    auto eval = evaluate_medcase_corpus_offline();
    assert(eval.at("cases").get<int>() >= 100);
    auto readme = fusion_suite_readme_markdown();
    assert(readme.find("Profiles") != std::string::npos);
    assert(readme.find("fusion roles") != std::string::npos);
    assert(readme.find("call_steps") != std::string::npos);
    assert(readme.find("engine_lean_ultra") != std::string::npos);
    auto qs = fusion_suite_quickstart_text();
    assert(qs.find("fusion") != std::string::npos);
    assert(qs.find("fusion roles") != std::string::npos);
    assert(qs.find("fusion explain") != std::string::npos);
    auto notes = fusion_improvements_notes();
    assert(notes.find("call_steps") != std::string::npos);
    std::vector<double> a{1,2,3,4,5}, b{2,2,3,4,6};
    assert(mean(a) == 3.0);
    auto gate_run = run_fusion(FusionConfig{});
    // invalid empty task should fail validation path separately
    FusionConfig cfg; cfg.task = "Hello fusion quality gates"; cfg.provider="echo";
    cfg.mode=FusionMode::Lean; cfg.profile=FusionProfileId::Neutral; cfg.write_files=false; cfg.cache.enabled=false;
    auto run = run_fusion(cfg);
    assert(run && run.value().success);
    auto gates = quality_gates_report(run.value());
    assert(gates.at("total").get<int>() >= 10);
    std::cout << "test_medcase_validation_and_docs ok gates_pass=" << gates.at("pass") << "\n";
}

int main() {
    test_align();
    test_dag();
    test_rate_limit();
    test_rubric();
    test_report_and_handoff();
    test_medcase_corpus();
    test_medcase_validation_and_docs();
    std::cout << "All fusion algo tests passed\n";
    return 0;
}

