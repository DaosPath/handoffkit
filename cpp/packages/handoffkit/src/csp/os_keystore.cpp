#include <handoffkit/csp/os_keystore.hpp>

#include <algorithm>
#include <codecvt>
#include <cstdint>
#include <limits>
#include <locale>
#include <stdexcept>

#include <handoffkit/csp/security.hpp>

#ifdef _WIN32
#include <windows.h>
#include <wincred.h>
#endif

#if defined(HANDOFFKIT_WITH_MACOS_KEYCHAIN)
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#endif

#if defined(HANDOFFKIT_WITH_LIBSECRET)
#include <libsecret/secret.h>
#endif

namespace handoffkit::csp {
namespace {

#if !defined(_WIN32) && !defined(HANDOFFKIT_WITH_MACOS_KEYCHAIN) && \
    !defined(HANDOFFKIT_WITH_LIBSECRET)
[[noreturn]] void unavailable() {
    throw SecurityError(
        "os_keystore_unavailable",
        "No maintained OS keystore provider is available on this platform.");
}
#endif

#ifdef _WIN32
void win_error(const char* operation, DWORD code) {
    throw SecurityError(
        "os_keystore_error",
        std::string("Windows Credential Manager operation failed: ") + operation,
        {{"operation", operation}, {"win32_error", code}});
}
#endif

#if !defined(_WIN32)
std::string target_utf8(const std::wstring& target) {
    try {
        return std::wstring_convert<std::codecvt_utf8<wchar_t>>{}.to_bytes(target);
    } catch (const std::exception&) {
        throw SecurityError(
            "os_keystore_target_invalid", "OS keystore target is not valid UTF-8.");
    }
}

void reject_nul_secret(std::string_view secret) {
    if (std::find(secret.begin(), secret.end(), '\0') != secret.end()) {
        throw SecurityError(
            "os_keystore_secret_invalid",
            "Selected OS keystore provider accepts text secrets and rejects embedded NUL bytes.");
    }
}
#endif

#if defined(HANDOFFKIT_WITH_MACOS_KEYCHAIN)
CFStringRef make_cf_string(const std::string& value) {
    return CFStringCreateWithBytes(
        kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(value.data()),
        static_cast<CFIndex>(value.size()),
        kCFStringEncodingUTF8,
        false);
}

CFMutableDictionaryRef mac_query(CFStringRef account) {
    auto query = CFDictionaryCreateMutable(
        kCFAllocatorDefault,
        0,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    if (query == nullptr) {
        throw SecurityError("os_keystore_error", "macOS Keychain query allocation failed.");
    }
    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, CFSTR("handoffkit.csp"));
    CFDictionarySetValue(query, kSecAttrAccount, account);
    return query;
}

[[noreturn]] void mac_error(const char* operation, OSStatus status) {
    throw SecurityError(
        "os_keystore_error",
        std::string("macOS Keychain operation failed: ") + operation,
        {{"operation", operation}, {"osstatus", static_cast<std::int32_t>(status)}});
}
#endif

#if defined(HANDOFFKIT_WITH_LIBSECRET)
const SecretSchema& linux_schema() {
    static const SecretSchema schema = {
        "com.handoffkit.csp",
        SECRET_SCHEMA_NONE,
        {{"target", SECRET_SCHEMA_ATTRIBUTE_STRING}, {nullptr, SECRET_SCHEMA_ATTRIBUTE_STRING}}};
    return schema;
}

[[noreturn]] void linux_error(const char* operation, GError* error) {
    std::string message = std::string("Linux Secret Service operation failed: ") + operation;
    if (error != nullptr && error->message != nullptr) message += ": " + std::string(error->message);
    const auto domain = error == nullptr ? 0U : error->domain;
    const auto code = error == nullptr ? 0 : error->code;
    if (error != nullptr) g_error_free(error);
    throw SecurityError(
        "os_keystore_error",
        std::move(message),
        {{"operation", operation}, {"g_error_domain", domain}, {"g_error_code", code}});
}
#endif

}  // namespace

OsKeyStore::OsKeyStore(std::wstring target_name) : target_name_(std::move(target_name)) {
    if (target_name_.empty()) {
        throw SecurityError("os_keystore_target_invalid", "OS keystore target name must not be empty");
    }
}

bool OsKeyStore::available() noexcept {
#if defined(_WIN32) || defined(HANDOFFKIT_WITH_MACOS_KEYCHAIN) || \
    defined(HANDOFFKIT_WITH_LIBSECRET)
    return true;
#else
    return false;
#endif
}

void OsKeyStore::put(std::string_view secret) {
#ifdef _WIN32
    if (secret.size() > std::numeric_limits<DWORD>::max()) {
        throw SecurityError("os_keystore_secret_too_large", "OS keystore secret exceeds provider limit");
    }
    CREDENTIALW credential{};
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = const_cast<LPWSTR>(target_name_.c_str());
    credential.CredentialBlobSize = static_cast<DWORD>(secret.size());
    credential.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<char*>(secret.data()));
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    if (!CredWriteW(&credential, 0)) win_error("CredWriteW", GetLastError());
#elif defined(HANDOFFKIT_WITH_MACOS_KEYCHAIN)
    reject_nul_secret(secret);
    const auto target = target_utf8(target_name_);
    auto account = make_cf_string(target);
    if (account == nullptr) throw SecurityError("os_keystore_target_invalid", "Keychain account allocation failed.");
    auto query = mac_query(account);
    auto data = CFDataCreate(
        kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(secret.data()),
        static_cast<CFIndex>(secret.size()));
    if (data == nullptr) {
        CFRelease(query);
        CFRelease(account);
        throw SecurityError("os_keystore_error", "Keychain secret allocation failed.");
    }
    CFDictionarySetValue(query, kSecValueData, data);
    const auto add_status = SecItemAdd(query, nullptr);
    if (add_status == errSecDuplicateItem) {
        CFDictionaryRemoveValue(query, kSecValueData);
        auto update = CFDictionaryCreateMutable(
            kCFAllocatorDefault,
            0,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks);
        if (update == nullptr) {
            CFRelease(data);
            CFRelease(query);
            CFRelease(account);
            throw SecurityError("os_keystore_error", "Keychain update allocation failed.");
        }
        CFDictionarySetValue(update, kSecValueData, data);
        const auto update_status = SecItemUpdate(query, update);
        CFRelease(update);
        if (update_status != errSecSuccess) {
            CFRelease(data);
            CFRelease(query);
            CFRelease(account);
            mac_error("SecItemUpdate", update_status);
        }
    } else if (add_status != errSecSuccess) {
        CFRelease(data);
        CFRelease(query);
        CFRelease(account);
        mac_error("SecItemAdd", add_status);
    }
    CFRelease(data);
    CFRelease(query);
    CFRelease(account);
#elif defined(HANDOFFKIT_WITH_LIBSECRET)
    reject_nul_secret(secret);
    const auto target = target_utf8(target_name_);
    const std::string value(secret);
    GError* error = nullptr;
    const auto stored = secret_password_store_sync(
        &linux_schema(),
        SECRET_COLLECTION_DEFAULT,
        "HandoffKit C++",
        value.c_str(),
        nullptr,
        &error,
        "target",
        target.c_str(),
        nullptr);
    if (!stored) linux_error("secret_password_store_sync", error);
#else
    (void)secret;
    unavailable();
#endif
}

std::string OsKeyStore::get() const {
#ifdef _WIN32
    PCREDENTIALW credential = nullptr;
    if (!CredReadW(target_name_.c_str(), CRED_TYPE_GENERIC, 0, &credential)) {
        const DWORD error = GetLastError();
        if (error == ERROR_NOT_FOUND) {
            throw SecurityError(
                "os_keystore_entry_missing",
                "OS keystore target does not exist",
                {{"target_length", target_name_.size()}});
        }
        win_error("CredReadW", error);
    }
    std::string result;
    if (credential != nullptr && credential->CredentialBlobSize > 0 && credential->CredentialBlob != nullptr) {
        result.assign(reinterpret_cast<const char*>(credential->CredentialBlob), credential->CredentialBlobSize);
    }
    if (credential != nullptr) CredFree(credential);
    return result;
#elif defined(HANDOFFKIT_WITH_MACOS_KEYCHAIN)
    const auto target = target_utf8(target_name_);
    auto account = make_cf_string(target);
    if (account == nullptr) throw SecurityError("os_keystore_target_invalid", "Keychain account allocation failed.");
    auto query = mac_query(account);
    const auto one = static_cast<const void*>(kSecMatchLimitOne);
    const auto yes = static_cast<const void*>(kCFBooleanTrue);
    CFDictionarySetValue(query, kSecReturnData, yes);
    CFDictionarySetValue(query, kSecMatchLimit, one);
    CFTypeRef item = nullptr;
    const auto status = SecItemCopyMatching(query, &item);
    CFRelease(query);
    CFRelease(account);
    if (status == errSecItemNotFound) {
        throw SecurityError("os_keystore_entry_missing", "OS keystore target does not exist");
    }
    if (status != errSecSuccess) mac_error("SecItemCopyMatching", status);
    if (item == nullptr || CFGetTypeID(item) != CFDataGetTypeID()) {
        if (item != nullptr) CFRelease(item);
        throw SecurityError("os_keystore_error", "Keychain returned an invalid secret value.");
    }
    const auto* bytes = CFDataGetBytePtr(static_cast<CFDataRef>(item));
    const auto size = CFDataGetLength(static_cast<CFDataRef>(item));
    std::string result(reinterpret_cast<const char*>(bytes), static_cast<std::size_t>(size));
    CFRelease(item);
    return result;
#elif defined(HANDOFFKIT_WITH_LIBSECRET)
    const auto target = target_utf8(target_name_);
    GError* error = nullptr;
    gchar* value = secret_password_lookup_sync(
        &linux_schema(), nullptr, &error, "target", target.c_str(), nullptr);
    if (value == nullptr && error != nullptr) linux_error("secret_password_lookup_sync", error);
    if (value == nullptr) {
        throw SecurityError("os_keystore_entry_missing", "OS keystore target does not exist");
    }
    std::string result(value);
    secret_password_free(value);
    return result;
#else
    unavailable();
#endif
}

void OsKeyStore::erase() noexcept {
#ifdef _WIN32
    if (!CredDeleteW(target_name_.c_str(), CRED_TYPE_GENERIC, 0) && GetLastError() != ERROR_NOT_FOUND) {
        // Destructors and cleanup paths must not throw. Callers can verify
        // deletion by a subsequent get(), which reports a structured error.
    }
#elif defined(HANDOFFKIT_WITH_MACOS_KEYCHAIN)
    try {
        const auto target = target_utf8(target_name_);
        auto account = make_cf_string(target);
        if (account == nullptr) return;
        auto query = mac_query(account);
        const auto status = SecItemDelete(query);
        CFRelease(query);
        CFRelease(account);
        if (status != errSecSuccess && status != errSecItemNotFound) return;
    } catch (...) {
        // Destructors and cleanup paths must not throw.
    }
#elif defined(HANDOFFKIT_WITH_LIBSECRET)
    try {
        const auto target = target_utf8(target_name_);
        GError* error = nullptr;
        const auto cleared = secret_password_clear_sync(
            &linux_schema(), nullptr, &error, "target", target.c_str(), nullptr);
        if (!cleared && error != nullptr) g_error_free(error);
    } catch (...) {
        // Destructors and cleanup paths must not throw.
    }
#endif
}

}  // namespace handoffkit::csp
