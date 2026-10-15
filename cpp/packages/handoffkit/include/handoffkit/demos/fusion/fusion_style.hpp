#pragma once

// Fusion-style demos (demo layer only — not core runtime).
//
// Layout:
//   include/handoffkit/demos/fusion/   public headers
//   src/demos/fusion/                 implementations (cache, engine, profiles, ...)

#define HANDOFFKIT_DEMOS_FUSION_STYLE_HPP_INCLUDED
#include <handoffkit/demos/demo_types.hpp>
#include <handoffkit/demos/fusion/types.hpp>
#include <handoffkit/demos/fusion/engine.hpp>
#include <handoffkit/demos/fusion/cache.hpp>
#include <handoffkit/demos/fusion/audit_loc.hpp>

namespace handoffkit {
namespace demos {

/// Offline dual-branch then merge (EchoProvider). Catalog id: `fusion_style`.
Result<DemoResult> run_fusion_style_demo(const DemoOptions& options = {});

/// Provider-backed dual-branch + merger via FusionEngine.
/// Lean: 3 LLM calls. Ultra (`options.extra["ultra"]=true`): 5 calls.
/// Profile via options.extra["profile"] (default: shipping for CLI compat, neutral recommended).
/// Catalog id: `fusion_style_router` (or `fusion_style_ultra` when ultra).
Result<DemoResult> run_fusion_style_router_demo(const DemoOptions& options = {});

/// Cache lab: put/get round-trip offline demo.
Result<DemoResult> run_fusion_cache_lab_demo(const DemoOptions& options = {});

/// Neutral ultra offline/echo (task-faithful merge).
Result<DemoResult> run_fusion_neutral_ultra_demo(const DemoOptions& options = {});

/// Convert engine result into catalog DemoResult.
DemoResult demo_result_from_fusion(const fusion::FusionRunResult& run, std::string name, std::string title);

}  // namespace demos
}  // namespace handoffkit
