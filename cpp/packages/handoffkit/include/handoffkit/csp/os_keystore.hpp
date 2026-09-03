#ifndef HANDOFFKIT_CSP_OS_KEYSTORE_HPP
#define HANDOFFKIT_CSP_OS_KEYSTORE_HPP

#include <cstddef>
#include <string>
#include <string_view>

namespace handoffkit::csp {

/// Provider-backed OS secret storage.
///
/// Provider selection is compile-time and fail-closed: Windows Credential
/// Manager, macOS Keychain, or Linux Secret Service when that maintained
/// platform provider is present. Other platforms return
/// `os_keystore_unavailable`. This class does not turn a file store into an OS
/// keystore and does not promise process-wide zeroization of returned strings.
class OsKeyStore {
public:
    explicit OsKeyStore(std::wstring target_name);

    [[nodiscard]] static bool available() noexcept;

    void put(std::string_view secret);
    [[nodiscard]] std::string get() const;
    void erase() noexcept;

    [[nodiscard]] const std::wstring& target_name() const noexcept { return target_name_; }

private:
    std::wstring target_name_;
};

}  // namespace handoffkit::csp

#endif
