#ifndef HANDOFFKIT_CSP_SECURE_MEMORY_HPP
#define HANDOFFKIT_CSP_SECURE_MEMORY_HPP

#include <cstddef>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#if defined(HANDOFFKIT_WITH_CRYPTO) || defined(HANDOFFKIT_WITH_TLS)
#include <openssl/crypto.h>
#endif

namespace handoffkit::csp {

/// Explicitly wipeable byte storage for short-lived native secrets.
///
/// This is a scoped native buffer, not a claim that OpenSSL, std::string,
/// allocator copies, or managed runtimes are globally zeroized.
class SecureBuffer {
public:
    SecureBuffer() = default;
    explicit SecureBuffer(std::size_t size) : bytes_(size) {}
    explicit SecureBuffer(std::string_view value)
        : bytes_(value.begin(), value.end()) {}
    explicit SecureBuffer(const char* value)
        : SecureBuffer(std::string_view(value == nullptr ? "" : value)) {}
    /// Rvalue strings are wiped after the copy into the owned byte storage.
    /// This closes the common temporary-`std::string` copy at the API edge;
    /// provider/allocator copies outside this object remain out of scope.
    explicit SecureBuffer(std::string&& value)
        : bytes_(value.begin(), value.end()) {
        wipe(value.data(), value.size());
    }
    SecureBuffer(const SecureBuffer&) = delete;
    SecureBuffer& operator=(const SecureBuffer&) = delete;
    SecureBuffer(SecureBuffer&& other) noexcept
        : bytes_(std::move(other.bytes_)) {
        other.clear();
    }
    SecureBuffer& operator=(SecureBuffer&& other) noexcept {
        if (this != &other) {
            clear();
            bytes_ = std::move(other.bytes_);
            other.clear();
        }
        return *this;
    }
    ~SecureBuffer() { clear(); }

    [[nodiscard]] std::byte* data() noexcept {
        return reinterpret_cast<std::byte*>(bytes_.data());
    }
    [[nodiscard]] const std::byte* data() const noexcept {
        return reinterpret_cast<const std::byte*>(bytes_.data());
    }
    [[nodiscard]] std::size_t size() const noexcept { return bytes_.size(); }
    [[nodiscard]] bool empty() const noexcept { return bytes_.empty(); }
    [[nodiscard]] std::string_view view() const noexcept {
        return {reinterpret_cast<const char*>(bytes_.data()), bytes_.size()};
    }

    void clear() noexcept {
        if (!bytes_.empty()) {
            wipe(bytes_.data(), bytes_.size());
        }
        bytes_.clear();
        bytes_.shrink_to_fit();
    }

private:
    static void wipe(void* value, std::size_t size) noexcept {
        if (value == nullptr || size == 0) return;
#if defined(HANDOFFKIT_WITH_CRYPTO) || defined(HANDOFFKIT_WITH_TLS)
        OPENSSL_cleanse(value, size);
#else
        volatile unsigned char* bytes = static_cast<volatile unsigned char*>(value);
        for (std::size_t index = 0; index < size; ++index) bytes[index] = 0;
#endif
    }

    std::vector<unsigned char> bytes_;
};

}  // namespace handoffkit::csp

#endif
