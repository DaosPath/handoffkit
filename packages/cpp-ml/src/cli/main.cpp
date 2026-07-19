#include <handoffkit/ml/ml.hpp>
#include <handoffkit/ml/version.hpp>

#include <iostream>
#include <string>
#include <string_view>
#include <vector>

namespace {

void print_help() {
    std::cout
        << "handoffkit-ml " << handoffkit::ml::version()
        << " (" << handoffkit::ml::phase() << ")\n"
        << "Optional C++ weight-training complement — NOT handoffkit_core.\n\n"
        << "Usage:\n"
        << "  handoffkit-ml help\n"
        << "  handoffkit-ml version\n"
        << "  handoffkit-ml doctor\n"
        << "  handoffkit-ml sft --dataset PATH --out DIR   (Fase 2+; not in F0)\n"
        << "  handoffkit-ml generate --ckpt PATH ...      (Fase 2+; not in F0)\n\n"
        << "Product split:\n"
        << "  handoffkit-cli train …   core: distill / jobs / echo|process backends\n"
        << "  handoffkit-ml  sft …     this package: native tensors / optim (later)\n\n"
        << "No Python. Core never links this library.\n";
}

int cmd_doctor() {
    const auto cap = handoffkit::ml::capabilities();
    std::cout << handoffkit::ml::status_message() << "\n"
              << "version=" << handoffkit::ml::version() << "\n"
              << "phase=" << handoffkit::ml::phase() << "\n"
              << "cap.tensor_cpu=" << (cap.tensor_cpu ? "true" : "false") << "\n"
              << "cap.mini_transformer=" << (cap.mini_transformer ? "true" : "false") << "\n"
              << "cap.lora=" << (cap.lora ? "true" : "false") << "\n"
              << "cap.cuda=" << (cap.cuda ? "true" : "false") << "\n"
              << "cap.preference=" << (cap.preference ? "true" : "false") << "\n"
              << "success=true\n";
    return 0;
}

int cmd_not_yet(std::string_view name) {
    std::cerr << "handoffkit-ml: command '" << name
              << "' is not available in " << handoffkit::ml::phase()
              << " (need Fase 2+).\n"
              << "See packages/cpp-ml/README.md and NONGOALS.md.\n";
    return 2;
}

}  // namespace

int main(int argc, char** argv) {
    std::vector<std::string> args;
    args.reserve(static_cast<std::size_t>(argc > 0 ? argc - 1 : 0));
    for (int i = 1; i < argc; ++i) args.emplace_back(argv[i]);

    if (args.empty() || args[0] == "help" || args[0] == "-h" || args[0] == "--help") {
        print_help();
        return 0;
    }
    if (args[0] == "version" || args[0] == "--version" || args[0] == "-V") {
        std::cout << "handoffkit-ml " << handoffkit::ml::version() << "\n";
        return 0;
    }
    if (args[0] == "doctor") {
        return cmd_doctor();
    }
    if (args[0] == "sft" || args[0] == "train" || args[0] == "generate" ||
        args[0] == "lora") {
        return cmd_not_yet(args[0]);
    }

    std::cerr << "handoffkit-ml: unknown command '" << args[0] << "'\n";
    print_help();
    return 2;
}
