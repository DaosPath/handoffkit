#include <handoffkit/demos/fusion/algo_report.hpp>
#include <handoffkit/demos/fusion/text_pipeline.hpp>
#include <sstream>
namespace handoffkit { namespace demos { namespace fusion {

std::string html_escape(std::string_view s) {
  std::string o; o.reserve(s.size()+16);
  for (char c: s) {
    switch(c){
      case '&': o+="&amp;"; break;
      case '<': o+="&lt;"; break;
      case '>': o+="&gt;"; break;
      case '"': o+="&quot;"; break;
      default: o.push_back(c);
    }
  }
  return o;
}

std::string markdown_table(const std::vector<std::vector<std::string>>& rows) {
  if (rows.empty()) return "";
  std::ostringstream ss;
  // header
  ss << "|";
  for (const auto& c: rows[0]) ss << " " << c << " |";
  ss << "\n|";
  for (size_t i=0;i<rows[0].size();++i) ss << "---|";
  ss << "\n";
  for (size_t r=1;r<rows.size();++r) {
    ss << "|";
    for (const auto& c: rows[r]) ss << " " << c << " |";
    ss << "\n";
  }
  return ss.str();
}

FusionRichReport build_rich_fusion_report(const FusionRunResult& run, const BranchDiff& diff, const RubricReport& rubric) {
  FusionRichReport rep;
  std::ostringstream md;
  md << "# Fusion rich report `" << run.run_id << "`\n\n";
  md << "- success: " << (run.success?"true":"false") << "\n";
  md << "- profile: " << fusion_profile_to_string(run.config.profile) << "\n";
  md << "- mode: " << fusion_mode_to_string(run.config.mode) << "\n";
  md << "- llm_calls: " << run.metrics.llm_calls << "\n";
  md << "- cache_hit_rate: " << run.metrics.cache.hit_rate() << "\n\n";
  md << "## Task\n\n" << run.config.task << "\n\n";
  md << "## Final output\n\n" << run.final_output << "\n\n";
  md << "## Branch diff\n\n";
  md << markdown_table({
    {"metric","value"},
    {"token_jaccard", std::to_string(diff.token_jaccard)},
    {"line_overlap", std::to_string(diff.line_overlap)},
    {"lcs_ratio", std::to_string(diff.longest_common_ratio)},
    {"shared_bullets", std::to_string(diff.shared_bullets)},
  });
  md << "\n### Conflicts\n\n";
  if (diff.conflicts.empty()) md << "_none_\n";
  else for (const auto& c: diff.conflicts) md << "- " << c << "\n";
  md << "\n## Rubric\n\nnormalized=" << rubric.normalized << "\n\n";
  std::vector<std::vector<std::string>> rr{{"criterion","raw","weighted"}};
  for (const auto& s: rubric.scores) {
    rr.push_back({s.criterion_id, std::to_string(s.raw), std::to_string(s.weighted)});
  }
  md << markdown_table(rr) << "\n";
  md << "## Text pipeline\n\n";
  auto st = analyze_text_pipeline(run.final_output, true);
  md << "tokens=" << st.tokens << " sentences=" << st.sentences << " bullets=" << st.bullets << "\n";
  md << "\n## Shipping-plan detector\n\n";
  md << (looks_like_shipping_plan(run.final_output) ? "looks_like_shipping_plan=true\n" : "looks_like_shipping_plan=false\n");

  // HTML
  std::ostringstream html;
  html << "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Fusion "
       << html_escape(run.run_id) << "</title>\n"
       << "<style>\n"
       << "body{font-family:Segoe UI,system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;line-height:1.45;color:#111}\n"
       << "h1,h2{border-bottom:1px solid #e5e7eb;padding-bottom:.3rem}\n"
       << "pre{background:#f6f8fa;padding:1rem;overflow:auto;white-space:pre-wrap;border-radius:8px}\n"
       << "table{border-collapse:collapse;width:100%;margin:1rem 0}\n"
       << "th,td{border:1px solid #ddd;padding:.45rem .6rem;text-align:left}\n"
       << "th{background:#f3f4f6}\n"
       << ".ok{color:#047857}.bad{color:#b91c1c}.meta{color:#4b5563}\n"
       << ".pill{display:inline-block;background:#eef2ff;color:#3730a3;padding:.15rem .5rem;border-radius:999px;font-size:.85rem;margin-right:.35rem}\n"
       << "</style></head><body>\n";
  html << "<h1>Fusion report</h1>\n<p class=\"meta\">";
  html << "<span class=\"pill\">" << html_escape(fusion_profile_to_string(run.config.profile)) << "</span>";
  html << "<span class=\"pill\">" << html_escape(fusion_mode_to_string(run.config.mode)) << "</span>";
  html << "<span class=\"pill\">calls=" << run.metrics.llm_calls << "</span>";
  html << "<span class=\"pill\">cache=" << run.metrics.cache.hit_rate() << "</span>";
  html << "</p>\n";
  html << "<h2>Task</h2><pre>" << html_escape(run.config.task) << "</pre>\n";
  html << "<h2>Final</h2><pre>" << html_escape(run.final_output) << "</pre>\n";
  html << "<h2>Branches</h2>\n";
  for (const auto& b: run.branches) {
    html << "<h3>" << html_escape(b.branch_id) << " / " << html_escape(b.label) << "</h3>";
    html << "<pre>" << html_escape(b.combined) << "</pre>\n";
  }
  html << "<h2>Diff</h2><pre>" << html_escape(diff.to_json().dump(2)) << "</pre>\n";
  html << "<h2>Rubric</h2><pre>" << html_escape(rubric.to_json().dump(2)) << "</pre>\n";
  html << "</body></html>\n";

  rep.markdown = md.str();
  rep.html = html.str();
  rep.wire = {
    {"run_id", run.run_id},
    {"success", run.success},
    {"diff", diff.to_json()},
    {"rubric", rubric.to_json()},
    {"pipeline", st.to_json()},
    {"looks_like_shipping_plan", looks_like_shipping_plan(run.final_output)},
  };
  return rep;
}

}}}
