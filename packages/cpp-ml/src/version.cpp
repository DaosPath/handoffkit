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
    // F0: scaffold only — all training flags false by design.
    c.tensor_cpu = false;
    c.mini_transformer = false;
    c.lora = false;
#if defined(HANDOFFKIT_ML_CUDA) && HANDOFFKIT_ML_CUDA
    c.cuda = true;  // flag present; kernels still Fase 4
#else
    c.cuda = false;
#endif
    c.preference = false;
    return c;
}

const char* status_message() noexcept {
    return "handoffkit-ml 0.1.x — F0 scaffold only. "
           "Weight training not implemented yet (Fase 1+). "
           "This package is an optional complement; handoffkit_core stays light.";
}

}  // namespace ml
}  // namespace handoffkit
