#pragma once

#include <nlohmann/json.hpp>
#include <functional>
#include <stdexcept>
#include <string>

namespace handoffkit {
namespace browser {

/// Callback dispatch is an explicit test adapter. Use BrowserRealTlsClient for mTLS.
class BrowserRealClient {
public:
    using Dispatch = std::function<nlohmann::json(const nlohmann::json&)>;

    explicit BrowserRealClient(Dispatch dispatch) : dispatch_(std::move(dispatch)) {
        if (!dispatch_) throw std::invalid_argument("Browser Real client requires dispatch");
    }

    nlohmann::json send(const nlohmann::json& command) const { return dispatch_(command); }

private:
    Dispatch dispatch_;
};

}  // namespace browser
}  // namespace handoffkit
