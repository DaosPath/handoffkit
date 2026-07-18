#pragma once

#include <optional>
#include <string>
#include <utility>
#include <variant>

namespace handoffkit {

enum class ErrorCode {
    InvalidArgument,
    ValidationFailed,
    ToolNotFound,
    ProviderFailed,
    ProtocolUnsupported,
    ParseError,
};

struct Error {
    ErrorCode code = ErrorCode::InvalidArgument;
    std::string message;
    std::string field;

    static Error invalid_argument(std::string message, std::string field = {}) {
        return Error{ErrorCode::InvalidArgument, std::move(message), std::move(field)};
    }

    static Error validation_failed(std::string message, std::string field = {}) {
        return Error{ErrorCode::ValidationFailed, std::move(message), std::move(field)};
    }

    static Error tool_not_found(std::string message) {
        return Error{ErrorCode::ToolNotFound, std::move(message), {}};
    }

    static Error provider_failed(std::string message) {
        return Error{ErrorCode::ProviderFailed, std::move(message), {}};
    }

    static Error protocol_unsupported(std::string message) {
        return Error{ErrorCode::ProtocolUnsupported, std::move(message), {}};
    }

    static Error parse_error(std::string message, std::string field = {}) {
        return Error{ErrorCode::ParseError, std::move(message), std::move(field)};
    }
};

/// Lightweight Result type (C++20-friendly stand-in for std::expected).
template <typename T>
class Result {
public:
    Result(T value) : storage_(std::move(value)) {}
    Result(Error error) : storage_(std::move(error)) {}

    static Result success(T value) { return Result(std::move(value)); }
    static Result failure(Error error) { return Result(std::move(error)); }

    [[nodiscard]] bool has_value() const noexcept {
        return std::holds_alternative<T>(storage_);
    }

    [[nodiscard]] explicit operator bool() const noexcept { return has_value(); }

    [[nodiscard]] T& value() & { return std::get<T>(storage_); }
    [[nodiscard]] const T& value() const& { return std::get<T>(storage_); }
    [[nodiscard]] T&& value() && { return std::get<T>(std::move(storage_)); }

    [[nodiscard]] Error& error() & { return std::get<Error>(storage_); }
    [[nodiscard]] const Error& error() const& { return std::get<Error>(storage_); }

    [[nodiscard]] T value_or(T fallback) const {
        if (has_value()) {
            return std::get<T>(storage_);
        }
        return fallback;
    }

private:
    std::variant<T, Error> storage_;
};

template <>
class Result<void> {
public:
    Result() : error_(std::nullopt) {}
    explicit Result(Error error) : error_(std::move(error)) {}

    static Result success() { return Result(); }
    static Result failure(Error error) { return Result(std::move(error)); }

    [[nodiscard]] bool has_value() const noexcept { return !error_.has_value(); }
    [[nodiscard]] explicit operator bool() const noexcept { return has_value(); }

    [[nodiscard]] Error& error() & { return *error_; }
    [[nodiscard]] const Error& error() const& { return *error_; }

private:
    std::optional<Error> error_;
};

}  // namespace handoffkit
