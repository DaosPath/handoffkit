#include <handoffkit/ml/device.hpp>
#include <handoffkit/ml/ml.hpp>
#include <handoffkit/ml/version.hpp>

namespace handoffkit {
namespace ml {

const char* version() noexcept {
    return HANDOFFKIT_ML_VERSION_STRING;
}

const char* phase() noexcept {
    return HANDOFFKIT_ML_PHASE;
}

Capabilities capabilities() noexcept {
    Capabilities c;
    c.tensor_cpu = true;
    c.mini_transformer = true;
    c.lora = true;
    auto dev = query_devices();
    c.cuda = dev.cuda_compiled;
    c.preference = true;
    c.quant_stub = true;
    c.dist_stub = true;
    return c;
}

const char* status_message() noexcept {
    return "handoffkit-ml — native C++ train complement (not core). "
           "CPU tensor/GPT-mini/SFT/LoRA/preference; CUDA/multi-GPU stubs (F4/F6).";
}

}  // namespace ml
}  // namespace handoffkit
