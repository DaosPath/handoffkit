#include <handoffkit/csp/tls_transport.hpp>
#include <handoffkit/csp/os_keystore.hpp>

#include <algorithm>
#include <cerrno>
#include <codecvt>
#include <cstring>
#include <ctime>
#include <fstream>
#include <filesystem>
#include <iomanip>
#include <iterator>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <locale>

#if defined(HANDOFFKIT_WITH_TLS)

#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/ocsp.h>
#include <openssl/pem.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <pthread.h>
#include <signal.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#endif

namespace handoffkit::csp {
namespace {

#ifdef _WIN32
using Socket = SOCKET;
constexpr Socket kInvalidSocket = INVALID_SOCKET;

struct WinsockRuntime {
    WinsockRuntime() {
        WSADATA data{};
        if (WSAStartup(MAKEWORD(2, 2), &data) != 0) {
            throw std::runtime_error("WSAStartup failed");
        }
    }
    ~WinsockRuntime() { WSACleanup(); }
};

void ensure_sockets() {
    static WinsockRuntime runtime;
    (void)runtime;
}

void close_socket(Socket socket) noexcept {
    if (socket != kInvalidSocket) closesocket(socket);
}

int socket_error() noexcept { return WSAGetLastError(); }
bool socket_in_progress(int error) noexcept {
    return error == WSAEWOULDBLOCK || error == WSAEINPROGRESS || error == WSAEALREADY;
}

void set_nonblocking(Socket socket, bool enabled) {
    u_long value = enabled ? 1UL : 0UL;
    if (ioctlsocket(socket, FIONBIO, &value) != 0) {
        throw std::runtime_error("ioctlsocket(FIONBIO) failed");
    }
}
#else
using Socket = int;
constexpr Socket kInvalidSocket = -1;

void ensure_sockets() {}

void close_socket(Socket socket) noexcept {
    if (socket != kInvalidSocket) ::close(socket);
}

int socket_error() noexcept { return errno; }
bool socket_in_progress(int error) noexcept {
    return error == EINPROGRESS || error == EALREADY || error == EWOULDBLOCK;
}

void set_nonblocking(Socket socket, bool enabled) {
    const int flags = fcntl(socket, F_GETFL, 0);
    if (flags < 0 || fcntl(socket, F_SETFL, enabled ? flags | O_NONBLOCK : flags & ~O_NONBLOCK) < 0) {
        throw std::runtime_error("fcntl(O_NONBLOCK) failed");
    }
}

class ScopedSigpipeBlock {
public:
    ScopedSigpipeBlock() noexcept {
        sigemptyset(&set_);
        sigaddset(&set_, SIGPIPE);
        if (pthread_sigmask(SIG_BLOCK, &set_, &previous_) != 0) return;
        active_ = true;
        sigset_t pending{};
        pending_before_ =
            sigpending(&pending) == 0 && sigismember(&pending, SIGPIPE) == 1;
    }

    ScopedSigpipeBlock(const ScopedSigpipeBlock&) = delete;
    ScopedSigpipeBlock& operator=(const ScopedSigpipeBlock&) = delete;

    ~ScopedSigpipeBlock() {
        if (!active_) return;
        const int saved_errno = errno;
        sigset_t pending{};
        const bool pending_after =
            sigpending(&pending) == 0 && sigismember(&pending, SIGPIPE) == 1;
        if (!pending_before_ && pending_after) {
            // `sigtimedwait` is not available on macOS.  Because SIGPIPE is
            // still blocked and `sigpending` just observed it for this
            // thread, `sigwait` removes the newly queued signal without
            // making it observable by the caller on any POSIX platform.
            int signal = 0;
            while (sigwait(&set_, &signal) != 0) {
            }
        }
        (void)pthread_sigmask(SIG_SETMASK, &previous_, nullptr);
        errno = saved_errno;
    }

private:
    sigset_t set_{};
    sigset_t previous_{};
    bool active_{false};
    bool pending_before_{false};
};
#endif

#ifdef _WIN32
struct ScopedSigpipeBlock {};
#endif

std::string openssl_error() {
    const unsigned long code = ERR_get_error();
    if (code == 0) return "no OpenSSL error detail";
    char buffer[256]{};
    ERR_error_string_n(code, buffer, sizeof(buffer));
    return buffer;
}

[[noreturn]] void throw_tls(const std::string& code,
                            const std::string& message,
                            const std::string& operation,
                            const std::string& detail = {}) {
    nlohmann::json details = {{"operation", operation}};
    if (!detail.empty()) details["detail"] = detail;
    throw SecurityError(code, message, std::move(details));
}

std::chrono::milliseconds remaining(std::chrono::steady_clock::time_point deadline) {
    const auto now = std::chrono::steady_clock::now();
    if (now >= deadline) return std::chrono::milliseconds(0);
    return std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now);
}

bool wait_socket(Socket socket,
                 bool readable,
                 std::chrono::steady_clock::time_point deadline) {
    const auto left = remaining(deadline);
    if (left.count() <= 0) return false;
    fd_set set;
    FD_ZERO(&set);
    FD_SET(socket, &set);
    timeval timeout{};
    timeout.tv_sec = static_cast<long>(left.count() / 1000);
    timeout.tv_usec = static_cast<long>((left.count() % 1000) * 1000);
#ifdef _WIN32
    const int result = select(0, readable ? &set : nullptr, readable ? nullptr : &set, nullptr, &timeout);
#else
    const int result = select(socket + 1, readable ? &set : nullptr, readable ? nullptr : &set, nullptr, &timeout);
#endif
    return result > 0;
}

Socket make_server_socket(const std::string& host, std::uint16_t port, std::uint16_t& actual_port) {
    ensure_sockets();
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_flags = AI_PASSIVE;
    addrinfo* addresses = nullptr;
    const std::string service = std::to_string(port);
    const char* node = host.empty() ? nullptr : host.c_str();
    if (getaddrinfo(node, service.c_str(), &hints, &addresses) != 0) {
        throw_tls("tls_socket_error", "could not resolve TLS bind address", "getaddrinfo");
    }
    Socket result = kInvalidSocket;
    for (auto* current = addresses; current != nullptr; current = current->ai_next) {
        result = static_cast<Socket>(socket(current->ai_family, current->ai_socktype, current->ai_protocol));
        if (result == kInvalidSocket) continue;
        int reuse = 1;
        setsockopt(result, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&reuse), sizeof(reuse));
        if (bind(result, current->ai_addr, static_cast<int>(current->ai_addrlen)) == 0 && listen(result, 16) == 0) {
            break;
        }
        close_socket(result);
        result = kInvalidSocket;
    }
    freeaddrinfo(addresses);
    if (result == kInvalidSocket) {
        throw_tls("tls_socket_error", "could not bind TLS listener", "bind/listen");
    }
    sockaddr_storage address{};
#ifdef _WIN32
    int length = sizeof(address);
#else
    socklen_t length = sizeof(address);
#endif
    if (getsockname(result, reinterpret_cast<sockaddr*>(&address), &length) != 0) {
        close_socket(result);
        throw_tls("tls_socket_error", "could not read TLS listener port", "getsockname");
    }
    actual_port = ntohs(address.ss_family == AF_INET
                             ? reinterpret_cast<const sockaddr_in*>(&address)->sin_port
                             : reinterpret_cast<const sockaddr_in6*>(&address)->sin6_port);
    set_nonblocking(result, true);
    return result;
}

Socket connect_socket(const std::string& host,
                      std::uint16_t port,
                      std::chrono::milliseconds timeout) {
    ensure_sockets();
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* addresses = nullptr;
    const std::string service = std::to_string(port);
    if (getaddrinfo(host.c_str(), service.c_str(), &hints, &addresses) != 0) {
        throw_tls("tls_socket_error", "could not resolve TLS peer address", "getaddrinfo");
    }
    Socket result = kInvalidSocket;
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    for (auto* current = addresses; current != nullptr; current = current->ai_next) {
        result = static_cast<Socket>(socket(current->ai_family, current->ai_socktype, current->ai_protocol));
        if (result == kInvalidSocket) continue;
        try {
            set_nonblocking(result, true);
        } catch (...) {
            close_socket(result);
            result = kInvalidSocket;
            continue;
        }
        const int connected = connect(result, current->ai_addr, static_cast<int>(current->ai_addrlen));
        if (connected == 0) break;
        if (!socket_in_progress(socket_error()) || !wait_socket(result, false, deadline)) {
            close_socket(result);
            result = kInvalidSocket;
            continue;
        }
        int socket_status = 0;
#ifdef _WIN32
        int status_length = sizeof(socket_status);
#else
        socklen_t status_length = sizeof(socket_status);
#endif
        if (getsockopt(result, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&socket_status), &status_length) != 0 ||
            socket_status != 0) {
            close_socket(result);
            result = kInvalidSocket;
            continue;
        }
        break;
    }
    freeaddrinfo(addresses);
    if (result == kInvalidSocket) {
        throw_tls("tls_connect_timeout", "could not connect to TLS peer before timeout", "connect");
    }
    return result;
}

std::shared_ptr<SSL_CTX> make_context(const TlsTransportConfig& config, bool server) {
    OPENSSL_init_ssl(OPENSSL_INIT_LOAD_SSL_STRINGS | OPENSSL_INIT_LOAD_CRYPTO_STRINGS, nullptr);
    const SSL_METHOD* method = server ? TLS_server_method() : TLS_client_method();
    SSL_CTX* raw = SSL_CTX_new(method);
    if (raw == nullptr) throw_tls("tls_backend_error", "could not create OpenSSL TLS context", "SSL_CTX_new", openssl_error());
    std::shared_ptr<SSL_CTX> context(raw, [](SSL_CTX* value) { SSL_CTX_free(value); });
    SSL_CTX_set_min_proto_version(raw, TLS1_3_VERSION);
    SSL_CTX_set_max_proto_version(raw, TLS1_3_VERSION);
    SSL_CTX_set_mode(raw, SSL_MODE_AUTO_RETRY);

    if (config.security.ca_cert_path.has_value()) {
        if (SSL_CTX_load_verify_locations(raw, config.security.ca_cert_path->c_str(), nullptr) != 1 &&
            SSL_CTX_load_verify_locations(raw, nullptr, config.security.ca_cert_path->c_str()) != 1) {
            throw_tls("tls_trust_anchor_invalid", "could not load configured CA roots", "SSL_CTX_load_verify_locations", openssl_error());
        }
    } else if (SSL_CTX_set_default_verify_paths(raw) != 1) {
        throw_tls("tls_trust_anchor_unavailable", "system CA roots are unavailable", "SSL_CTX_set_default_verify_paths", openssl_error());
    }

    if (config.security.crl_path.has_value()) {
        BIO* file = BIO_new_file(config.security.crl_path->c_str(), "rb");
        if (file == nullptr) {
            throw_tls("tls_crl_invalid", "could not open configured PEM CRL", "PEM_read_bio_X509_CRL", openssl_error());
        }
        X509_CRL* crl = PEM_read_bio_X509_CRL(file, nullptr, nullptr, nullptr);
        BIO_free(file);
        if (crl == nullptr) {
            throw_tls("tls_crl_invalid", "could not parse configured PEM CRL", "PEM_read_bio_X509_CRL", openssl_error());
        }
        X509_STORE* store = SSL_CTX_get_cert_store(raw);
        const bool added = store != nullptr && X509_STORE_add_crl(store, crl) == 1;
        const bool flagged = added && X509_STORE_set_flags(store, X509_V_FLAG_CRL_CHECK | X509_V_FLAG_CRL_CHECK_ALL) == 1;
        X509_CRL_free(crl);
        if (!flagged) {
            throw_tls("tls_crl_invalid", "could not install configured CRL in the TLS trust store", "X509_STORE_add_crl", openssl_error());
        }
    }

    int verify_mode = SSL_VERIFY_PEER;
    if (server && config.security.require_mtls) verify_mode |= SSL_VERIFY_FAIL_IF_NO_PEER_CERT;
    SSL_CTX_set_verify(raw, verify_mode, nullptr);

    const bool use_os_keystore = config.security.credential_source == "os_keystore";
    const bool has_cert = config.security.cert_path.has_value();
    const bool has_key = config.security.key_path.has_value();
    if (use_os_keystore && (has_cert || has_key)) {
        throw_tls(
            "tls_config_invalid",
            "OS keystore credentials cannot be combined with PEM credential paths",
            "credential_source");
    }
    if (!use_os_keystore && has_cert != has_key) {
        throw_tls("tls_config_invalid", "certificate and private key must be configured together", "certificate_config");
    }
    if (server && !has_cert && !use_os_keystore) {
        throw_tls("tls_config_invalid", "TLS server requires a certificate and private key", "server_certificate");
    }
    if (!server && config.security.require_mtls && !has_cert && !use_os_keystore) {
        throw_tls("tls_config_invalid", "mTLS client requires a certificate and private key", "client_certificate");
    }
    if (has_cert) {
        if (SSL_CTX_use_certificate_chain_file(raw, config.security.cert_path->c_str()) != 1 ||
            SSL_CTX_use_PrivateKey_file(raw, config.security.key_path->c_str(), SSL_FILETYPE_PEM) != 1 ||
            SSL_CTX_check_private_key(raw) != 1) {
            throw_tls("tls_credential_invalid", "could not load or validate TLS certificate/key", "certificate_key", openssl_error());
        }
    } else if (use_os_keystore) {
        if (!config.security.credential_target.has_value() ||
            config.security.credential_target->empty()) {
            throw_tls(
                "tls_config_invalid",
                "OS keystore credentials require credential_target",
                "credential_target");
        }
        if (!OsKeyStore::available()) {
            throw_tls(
                "os_keystore_unavailable",
                "No maintained OS keystore provider is available for this C++ TLS build",
                "credential_target");
        }
        std::wstring target;
        try {
            target = std::wstring_convert<std::codecvt_utf8<wchar_t>>{}.from_bytes(
                *config.security.credential_target);
        } catch (const std::exception&) {
            throw_tls(
                "os_keystore_target_invalid",
                "OS keystore credential_target is not valid UTF-8",
                "credential_target");
        }
        const auto bundle_text = OsKeyStore(std::move(target)).get();
        nlohmann::json bundle;
        try {
            bundle = nlohmann::json::parse(bundle_text);
        } catch (const std::exception& error) {
            throw_tls(
                "tls_credential_invalid",
                "OS keystore credential bundle is not valid JSON",
                "credential_bundle",
                error.what());
        }
        if (!bundle.is_object() || !bundle.contains("certificate_pem") ||
            !bundle.contains("private_key_pem") ||
            !bundle.at("certificate_pem").is_string() ||
            !bundle.at("private_key_pem").is_string()) {
            throw_tls(
                "tls_credential_invalid",
                "OS keystore bundle must contain certificate_pem and private_key_pem",
                "credential_bundle");
        }
        const auto& certificate_pem = bundle.at("certificate_pem").get_ref<const std::string&>();
        const auto& private_key_pem = bundle.at("private_key_pem").get_ref<const std::string&>();
        BIO* certificate_bio = BIO_new_mem_buf(
            certificate_pem.data(), static_cast<int>(certificate_pem.size()));
        BIO* key_bio = BIO_new_mem_buf(
            private_key_pem.data(), static_cast<int>(private_key_pem.size()));
        if (certificate_bio == nullptr || key_bio == nullptr) {
            BIO_free(certificate_bio);
            BIO_free(key_bio);
            throw_tls("tls_credential_invalid", "could not allocate OS keystore credential parser", "credential_bundle");
        }
        X509* certificate = PEM_read_bio_X509(certificate_bio, nullptr, nullptr, nullptr);
        EVP_PKEY* key = PEM_read_bio_PrivateKey(key_bio, nullptr, nullptr, nullptr);
        BIO_free(certificate_bio);
        BIO_free(key_bio);
        if (certificate == nullptr || key == nullptr) {
            X509_free(certificate);
            EVP_PKEY_free(key);
            throw_tls("tls_credential_invalid", "could not parse OS keystore certificate/key", "credential_bundle", openssl_error());
        }
        const bool loaded = SSL_CTX_use_certificate(raw, certificate) == 1 &&
            SSL_CTX_use_PrivateKey(raw, key) == 1 && SSL_CTX_check_private_key(raw) == 1;
        X509_free(certificate);
        EVP_PKEY_free(key);
        if (!loaded) {
            throw_tls("tls_credential_invalid", "OS keystore certificate and key do not match", "credential_bundle", openssl_error());
        }
    }
    return context;
}

template <typename Operation>
void handshake(SSL* ssl,
               Socket socket,
               std::chrono::milliseconds timeout,
               Operation operation,
               const char* name) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    for (;;) {
        int result = 0;
        {
            ScopedSigpipeBlock block;
            result = operation();
        }
        if (result == 1) return;
        const int error = SSL_get_error(ssl, result);
        if (error == SSL_ERROR_WANT_READ && wait_socket(socket, true, deadline)) continue;
        if (error == SSL_ERROR_WANT_WRITE && wait_socket(socket, false, deadline)) continue;
        if (remaining(deadline).count() == 0) {
            throw_tls("tls_handshake_timeout", "TLS handshake timed out", name);
        }
        throw_tls(
            "tls_handshake_failed",
            "TLS handshake failed",
            name,
            std::string(openssl_error()) + "; state=" + SSL_state_string_long(ssl) +
                "; socket_error=" + std::to_string(socket_error()));
    }
}

void write_all(SSL* ssl, Socket socket, const std::byte* bytes, std::size_t length,
               std::chrono::milliseconds timeout) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    std::size_t offset = 0;
    while (offset < length) {
        int result = 0;
        {
            ScopedSigpipeBlock block;
            result = SSL_write(ssl, bytes + offset, static_cast<int>(std::min<std::size_t>(length - offset, std::numeric_limits<int>::max())));
        }
        if (result > 0) {
            offset += static_cast<std::size_t>(result);
            continue;
        }
        const int error = SSL_get_error(ssl, result);
        if (error == SSL_ERROR_WANT_READ && wait_socket(socket, true, deadline)) continue;
        if (error == SSL_ERROR_WANT_WRITE && wait_socket(socket, false, deadline)) continue;
        if (remaining(deadline).count() == 0) throw_tls("tls_write_timeout", "TLS write timed out", "SSL_write");
        throw_tls("tls_write_failed", "TLS write failed", "SSL_write", openssl_error());
    }
}

void read_exact(SSL* ssl, Socket socket, std::byte* bytes, std::size_t length,
                std::chrono::milliseconds timeout) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    std::size_t offset = 0;
    while (offset < length) {
        int result = 0;
        {
            ScopedSigpipeBlock block;
            result = SSL_read(ssl, bytes + offset, static_cast<int>(std::min<std::size_t>(length - offset, std::numeric_limits<int>::max())));
        }
        if (result > 0) {
            offset += static_cast<std::size_t>(result);
            continue;
        }
        const int error = SSL_get_error(ssl, result);
        if (error == SSL_ERROR_ZERO_RETURN) throw_tls("tls_peer_closed", "TLS peer closed the connection", "SSL_read");
        if (error == SSL_ERROR_WANT_READ && wait_socket(socket, true, deadline)) continue;
        if (error == SSL_ERROR_WANT_WRITE && wait_socket(socket, false, deadline)) continue;
        if (remaining(deadline).count() == 0) throw_tls("tls_read_timeout", "TLS read timed out", "SSL_read");
        throw_tls("tls_read_failed", "TLS read failed", "SSL_read", openssl_error());
    }
}

std::vector<std::string> split_path(const std::string& path) {
    std::vector<std::string> result;
    std::size_t start = 0;
    while (start <= path.size()) {
        const auto end = path.find('/', start);
        result.push_back(path.substr(start, end == std::string::npos ? std::string::npos : end - start));
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return result;
}

std::int64_t certificate_time_epoch(const ASN1_TIME* value, const char* field) {
    if (value == nullptr) {
        throw_tls("tls_certificate_time_invalid", "TLS certificate is missing a validity time", "certificate_time", field);
    }
    std::tm parsed{};
    if (ASN1_TIME_to_tm(value, &parsed) != 1) {
        throw_tls("tls_certificate_time_invalid", "TLS certificate validity time could not be decoded", "certificate_time", field);
    }
#ifdef _WIN32
    const std::time_t epoch = _mkgmtime(&parsed);
#else
    const std::time_t epoch = timegm(&parsed);
#endif
    if (epoch < 0) {
        throw_tls("tls_certificate_time_invalid", "TLS certificate validity time is out of range", "certificate_time", field);
    }
    return static_cast<std::int64_t>(epoch);
}

PeerIdentity identity_from_certificate(X509* certificate,
                                       const TlsTransportConfig& config) {
    if (certificate == nullptr) throw_tls("tls_peer_certificate_missing", "TLS peer did not present a certificate", "peer_certificate");
    auto* names = static_cast<GENERAL_NAMES*>(X509_get_ext_d2i(certificate, NID_subject_alt_name, nullptr, nullptr));
    if (names == nullptr) throw_tls("tls_identity_san_missing", "TLS peer certificate has no SAN identity", "subject_alt_name");
    std::vector<std::string> uris;
    const int count = sk_GENERAL_NAME_num(names);
    for (int index = 0; index < count; ++index) {
        const GENERAL_NAME* name = sk_GENERAL_NAME_value(names, index);
        if (name != nullptr && name->type == GEN_URI && name->d.uniformResourceIdentifier != nullptr) {
            const auto* data = ASN1_STRING_get0_data(name->d.uniformResourceIdentifier);
            const int length = ASN1_STRING_length(name->d.uniformResourceIdentifier);
            if (data != nullptr && length > 0) uris.emplace_back(reinterpret_cast<const char*>(data), static_cast<std::size_t>(length));
        }
    }
    GENERAL_NAMES_free(names);
    std::vector<std::string> identity_uris;
    for (const auto& uri : uris) if (uri.rfind("spiffe://", 0) == 0) identity_uris.push_back(uri);
    if (identity_uris.size() != 1) {
        throw_tls("tls_identity_san_invalid", "TLS peer certificate must contain exactly one HK-CSP URI SAN", "subject_alt_name");
    }
    const std::string value = identity_uris.front();
    const std::string rest = value.substr(std::string("spiffe://").size());
    const auto slash = rest.find('/');
    if (slash == std::string::npos || slash == 0) throw_tls("tls_identity_san_invalid", "TLS identity SAN has no trust domain", "identity_uri");
    const std::string trust_domain = rest.substr(0, slash);
    const auto parts = split_path(rest.substr(slash + 1));
    if ((parts.size() != 4 && parts.size() != 6) || parts[0] != "peer" || parts[2] != "node" || parts[1].empty() || parts[3].empty() || (parts.size() == 6 && (parts[4] != "worker" || parts[5].empty()))) {
        throw_tls("tls_identity_san_invalid", "TLS identity SAN must use peer/<id>/node/<id>[/worker/<id>]", "identity_uri");
    }
    if (trust_domain != config.security.trust_domain) {
        throw_tls("tls_trust_domain_mismatch", "TLS peer trust domain does not match local policy", "identity_uri", trust_domain);
    }
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int digest_length = 0;
    if (X509_digest(certificate, EVP_sha256(), digest, &digest_length) != 1 || digest_length != 32) {
        throw_tls("tls_fingerprint_failed", "could not calculate TLS peer fingerprint", "X509_digest", openssl_error());
    }
    std::ostringstream fingerprint;
    fingerprint << "sha256:";
    for (unsigned int index = 0; index < digest_length; ++index) fingerprint << std::hex << std::setw(2) << std::setfill('0') << static_cast<unsigned int>(digest[index]);
    PeerIdentity identity;
    identity.peer_id = parts[1];
    identity.node_id = parts[3];
    identity.trust_domain = trust_domain;
    if (parts.size() == 6) identity.worker_id = parts[5];
    identity.credential_fingerprint = fingerprint.str();
    identity.issued_at = certificate_time_epoch(X509_get0_notBefore(certificate), "not_before");
    identity.expires_at = certificate_time_epoch(X509_get0_notAfter(certificate), "not_after");
    if (!identity.is_valid_at()) {
        throw_tls("tls_certificate_expired", "TLS peer certificate is outside its validity window", "certificate_time");
    }
    const auto policy = config.peer_policy.capabilities_by_fingerprint.find(identity.credential_fingerprint);
    if (!config.peer_policy.capabilities_by_fingerprint.empty() && policy == config.peer_policy.capabilities_by_fingerprint.end()) {
        throw_tls("peer_not_authorized", "TLS peer certificate fingerprint is not authorized by local policy", "capability_policy", identity.credential_fingerprint);
    }
    if (policy != config.peer_policy.capabilities_by_fingerprint.end()) identity.capabilities = policy->second;
    auto require_match = [](const std::optional<std::string>& expected, const std::string& actual, const char* field) {
        if (expected.has_value() && expected.value() != actual) throw_tls("tls_identity_mismatch", std::string("TLS peer ") + field + " does not match local policy", "identity_policy", field);
    };
    require_match(config.peer_policy.expected_peer_id, identity.peer_id, "peer_id");
    require_match(config.peer_policy.expected_node_id, identity.node_id, "node_id");
    if (config.peer_policy.expected_worker_id.has_value()) {
        if (!identity.worker_id.has_value() || identity.worker_id.value() != config.peer_policy.expected_worker_id.value()) {
            throw_tls("tls_identity_mismatch", "TLS peer worker_id does not match local policy", "identity_policy", "worker_id");
        }
    }
    return identity;
}

#if !defined(OPENSSL_NO_OCSP)
using OcspResponsePtr = std::unique_ptr<OCSP_RESPONSE, decltype(&OCSP_RESPONSE_free)>;
using OcspBasicResponsePtr = std::unique_ptr<OCSP_BASICRESP, decltype(&OCSP_BASICRESP_free)>;
using OcspCertIdPtr = std::unique_ptr<OCSP_CERTID, decltype(&OCSP_CERTID_free)>;
using OcspRequestPtr = std::unique_ptr<OCSP_REQUEST, decltype(&OCSP_REQUEST_free)>;
using CertificatePtr = std::unique_ptr<X509, decltype(&X509_free)>;

struct OpenSslStringDeleter {
    void operator()(char* value) const noexcept { OPENSSL_free(value); }
};
using OpenSslStringPtr = std::unique_ptr<char, OpenSslStringDeleter>;

CertificatePtr load_first_certificate(const std::filesystem::path& path) {
    BIO* raw = BIO_new_file(path.string().c_str(), "rb");
    if (raw == nullptr) {
        throw_tls("tls_ocsp_issuer_invalid", "could not open the configured CA certificate", "PEM_read_bio_X509", openssl_error());
    }
    std::unique_ptr<BIO, decltype(&BIO_free)> bio(raw, BIO_free);
    CertificatePtr certificate(PEM_read_bio_X509(bio.get(), nullptr, nullptr, nullptr), X509_free);
    if (!certificate) {
        throw_tls("tls_ocsp_issuer_invalid", "could not parse the configured CA certificate", "PEM_read_bio_X509", openssl_error());
    }
    return certificate;
}

CertificatePtr issuer_for_peer(SSL* ssl, X509* peer, const TlsTransportConfig& config) {
    if (const auto* chain = SSL_get0_verified_chain(ssl); chain != nullptr) {
        const int count = sk_X509_num(chain);
        for (int index = 1; index < count; ++index) {
            X509* candidate = sk_X509_value(chain, index);
            if (candidate != nullptr && X509_check_issued(candidate, peer) == X509_V_OK) {
                X509_up_ref(candidate);
                return CertificatePtr(candidate, X509_free);
            }
        }
    }
    if (config.security.ca_cert_path.has_value()) {
        auto candidate = load_first_certificate(*config.security.ca_cert_path);
        if (X509_check_issued(candidate.get(), peer) == X509_V_OK) return candidate;
    }
    throw_tls("tls_ocsp_issuer_invalid", "could not identify the OCSP issuer for the peer certificate", "X509_check_issued");
}

OcspResponsePtr load_ocsp_response(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw_tls("tls_ocsp_invalid", "could not open the configured OCSP response", "d2i_OCSP_RESPONSE");
    }
    std::vector<unsigned char> bytes{
        std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
    if (bytes.empty()) {
        throw_tls("tls_ocsp_invalid", "configured OCSP response is empty", "d2i_OCSP_RESPONSE");
    }
    const unsigned char* cursor = bytes.data();
    OcspResponsePtr response(d2i_OCSP_RESPONSE(nullptr, &cursor, static_cast<long>(bytes.size())), OCSP_RESPONSE_free);
    if (response != nullptr) return response;

    BIO* raw = BIO_new_mem_buf(bytes.data(), static_cast<int>(bytes.size()));
    if (raw == nullptr) {
        throw_tls("tls_ocsp_invalid", "could not allocate OCSP response parser", "PEM_read_bio");
    }
    std::unique_ptr<BIO, decltype(&BIO_free)> bio(raw, BIO_free);
    char* name = nullptr;
    char* header = nullptr;
    unsigned char* decoded = nullptr;
    long decoded_length = 0;
    const int pem_ok = PEM_read_bio(bio.get(), &name, &header, &decoded, &decoded_length);
    OPENSSL_free(name);
    OPENSSL_free(header);
    if (pem_ok != 1 || decoded == nullptr || decoded_length <= 0) {
        OPENSSL_free(decoded);
        throw_tls("tls_ocsp_invalid", "configured OCSP response is neither DER nor PEM", "d2i_OCSP_RESPONSE", openssl_error());
    }
    const unsigned char* pem_cursor = decoded;
    response.reset(d2i_OCSP_RESPONSE(nullptr, &pem_cursor, decoded_length));
    OPENSSL_free(decoded);
    if (!response) {
        throw_tls("tls_ocsp_invalid", "configured PEM does not contain an OCSP response", "d2i_OCSP_RESPONSE", openssl_error());
    }
    return response;
}

void validate_ocsp_response(SSL* ssl, X509* peer, const TlsTransportConfig& config) {
    if (!config.security.ocsp_response_path.has_value()) {
        if (config.security.require_ocsp) {
            throw_tls("tls_ocsp_required", "TLS peer has no configured OCSP response or fetch policy", "ocsp_response");
        }
        return;
    }
    auto issuer = issuer_for_peer(ssl, peer, config);
    auto response = load_ocsp_response(*config.security.ocsp_response_path);
    if (OCSP_response_status(response.get()) != OCSP_RESPONSE_STATUS_SUCCESSFUL) {
        throw_tls("tls_ocsp_invalid", "OCSP responder returned an unsuccessful status", "OCSP_response_status");
    }
    OcspBasicResponsePtr basic(OCSP_response_get1_basic(response.get()), OCSP_BASICRESP_free);
    if (!basic) {
        throw_tls("tls_ocsp_invalid", "OCSP response has no basic response", "OCSP_response_get1_basic", openssl_error());
    }
    X509_STORE* store = SSL_CTX_get_cert_store(SSL_get_SSL_CTX(ssl));
    if (store == nullptr || OCSP_basic_verify(basic.get(), nullptr, store, 0) != 1) {
        throw_tls("tls_ocsp_signer_invalid", "OCSP response signature is not trusted by the configured CA", "OCSP_basic_verify", openssl_error());
    }
    OcspCertIdPtr id(OCSP_cert_to_id(EVP_sha1(), peer, issuer.get()), OCSP_CERTID_free);
    if (!id) {
        throw_tls("tls_ocsp_invalid", "could not build OCSP certificate identifier", "OCSP_cert_to_id", openssl_error());
    }
    int status = V_OCSP_CERTSTATUS_UNKNOWN;
    int reason = 0;
    ASN1_GENERALIZEDTIME* revocation_time = nullptr;
    ASN1_GENERALIZEDTIME* this_update = nullptr;
    ASN1_GENERALIZEDTIME* next_update = nullptr;
    if (OCSP_resp_find_status(
            basic.get(), id.get(), &status, &reason, &revocation_time, &this_update, &next_update) != 1) {
        throw_tls("tls_ocsp_missing", "OCSP response does not cover the peer certificate", "OCSP_resp_find_status");
    }
    if (status == V_OCSP_CERTSTATUS_REVOKED) {
        throw_tls("tls_ocsp_revoked", "OCSP response marks the peer certificate revoked", "OCSP_resp_find_status", std::to_string(reason));
    }
    if (status != V_OCSP_CERTSTATUS_GOOD) {
        throw_tls("tls_ocsp_unknown", "OCSP response does not mark the peer certificate good", "OCSP_resp_find_status");
    }
    const long freshness = static_cast<long>(std::max<std::uint64_t>(config.security.replay_window_seconds, 60));
    const long skew = static_cast<long>(config.security.max_clock_skew_seconds);
    if (this_update == nullptr || OCSP_check_validity(this_update, next_update, skew, freshness) != 1) {
        throw_tls("tls_ocsp_stale", "OCSP response is outside its validity window", "OCSP_check_validity", openssl_error());
    }
}
#else
void validate_ocsp_response(SSL*, X509*, const TlsTransportConfig& config) {
    if (config.security.ocsp_response_path.has_value() || config.security.require_ocsp) {
        throw_tls("ocsp_backend_unavailable", "OpenSSL was built without OCSP support", "ocsp_response");
    }
}
#endif

}  // namespace

struct TlsConnection::Impl {
    std::shared_ptr<SSL_CTX> context;
    SSL* ssl{nullptr};
    Socket socket{kInvalidSocket};
    TlsTransportConfig config;
    PeerIdentity identity;

    ~Impl() {
        if (ssl != nullptr) {
            {
                ScopedSigpipeBlock block;
                (void)SSL_shutdown(ssl);
            }
            SSL_free(ssl);
        }
        close_socket(socket);
    }
};

struct TlsServer::Impl {
    std::shared_ptr<SSL_CTX> context;
    Socket socket{kInvalidSocket};
    std::uint16_t port{0};
    TlsTransportConfig config;
    mutable std::mutex mutex;

    ~Impl() {
        close_socket(socket);
    }
};

TlsCapabilities detect_cpp_tls_capabilities() noexcept {
#if defined(HANDOFFKIT_WITH_TLS)
#if defined(OPENSSL_NO_OCSP)
    return {true, true, true, true, true, false, false, false};
#else
    return {true, true, true, true, true, true, false, false};
#endif
#else
    return {};
#endif
}

TlsConnection::TlsConnection(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
TlsConnection::TlsConnection(TlsConnection&& other) noexcept = default;
TlsConnection& TlsConnection::operator=(TlsConnection&& other) noexcept = default;
TlsConnection::~TlsConnection() = default;

bool TlsConnection::valid() const noexcept { return impl_ != nullptr && impl_->ssl != nullptr; }

const PeerIdentity& TlsConnection::peer_identity() const {
    if (!valid()) throw SecurityError("tls_connection_closed", "TLS connection is closed");
    return impl_->identity;
}

std::string TlsConnection::negotiated_protocol() const {
    if (!valid()) throw SecurityError("tls_connection_closed", "TLS connection is closed");
    return SSL_get_version(impl_->ssl);
}

std::string TlsConnection::negotiated_group() const {
    if (!valid()) throw SecurityError("tls_connection_closed", "TLS connection is closed");
    const int group = SSL_get_negotiated_group(impl_->ssl);
    if (group == 0) return {};
    const char* name = SSL_group_to_name(impl_->ssl, group);
    return name == nullptr ? std::string{} : std::string(name);
}

void TlsConnection::send_json(const nlohmann::json& value) {
    if (!valid()) throw SecurityError("tls_connection_closed", "TLS connection is closed");
    const std::string encoded = value.dump();
    if (encoded.size() > impl_->config.max_frame_bytes || encoded.size() > std::numeric_limits<std::uint32_t>::max()) {
        throw SecurityError("frame_too_large", "TLS frame exceeds configured maximum", {{"max_frame_bytes", impl_->config.max_frame_bytes}});
    }
    const std::uint32_t network_size = htonl(static_cast<std::uint32_t>(encoded.size()));
    write_all(impl_->ssl, impl_->socket, reinterpret_cast<const std::byte*>(&network_size), sizeof(network_size), impl_->config.timeout);
    write_all(impl_->ssl, impl_->socket, reinterpret_cast<const std::byte*>(encoded.data()), encoded.size(), impl_->config.timeout);
}

nlohmann::json TlsConnection::receive_json() {
    if (!valid()) throw SecurityError("tls_connection_closed", "TLS connection is closed");
    std::uint32_t network_size = 0;
    read_exact(impl_->ssl, impl_->socket, reinterpret_cast<std::byte*>(&network_size), sizeof(network_size), impl_->config.timeout);
    const std::uint32_t size = ntohl(network_size);
    if (size > impl_->config.max_frame_bytes) {
        throw SecurityError("frame_too_large", "TLS frame exceeds configured maximum", {{"max_frame_bytes", impl_->config.max_frame_bytes}, {"frame_bytes", size}});
    }
    std::string encoded(size, '\0');
    if (size > 0) read_exact(impl_->ssl, impl_->socket, reinterpret_cast<std::byte*>(encoded.data()), size, impl_->config.timeout);
    try {
        return nlohmann::json::parse(encoded);
    } catch (const std::exception& error) {
        throw SecurityError("frame_decode_failed", "TLS frame is not valid JSON", {{"error", error.what()}});
    }
}

void TlsConnection::close() noexcept { impl_.reset(); }

TlsServer::TlsServer(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
TlsServer::TlsServer(TlsServer&& other) noexcept = default;
TlsServer& TlsServer::operator=(TlsServer&& other) noexcept = default;
TlsServer::~TlsServer() = default;

TlsServer TlsServer::listen(std::string bind_host,
                            std::uint16_t port,
                            TlsTransportConfig config) {
    config.security.validate_listen_address(bind_host);
    config.security.validate_cpp_transport_support();
    if (config.security.profile != SecurityProfile::Standard) {
        throw SecurityError("tls_profile_invalid", "C++ TLS transport requires the standard profile");
    }
    auto impl = std::make_unique<Impl>();
    impl->config = std::move(config);
    impl->context = make_context(impl->config, true);
    impl->socket = make_server_socket(bind_host, port, impl->port);
    return TlsServer(std::move(impl));
}

std::uint16_t TlsServer::port() const noexcept { return impl_ == nullptr ? 0 : impl_->port; }

void TlsServer::reload(TlsTransportConfig config) {
    if (impl_ == nullptr || impl_->socket == kInvalidSocket) {
        throw SecurityError("tls_listener_closed", "TLS listener is closed");
    }
    config.security.validate_cpp_transport_support();
    if (config.security.profile != SecurityProfile::Standard) {
        throw SecurityError("tls_profile_invalid", "C++ TLS transport requires the standard profile");
    }
    auto context = make_context(config, true);
    std::lock_guard lock(impl_->mutex);
    impl_->context = std::move(context);
    impl_->config = std::move(config);
}

TlsConnection TlsServer::accept() {
    if (impl_ == nullptr || impl_->socket == kInvalidSocket) throw SecurityError("tls_listener_closed", "TLS listener is closed");
    std::shared_ptr<SSL_CTX> context;
    TlsTransportConfig config;
    {
        std::lock_guard lock(impl_->mutex);
        context = impl_->context;
        config = impl_->config;
    }
    const auto deadline = std::chrono::steady_clock::now() + config.timeout;
    if (!wait_socket(impl_->socket, true, deadline)) throw_tls("tls_accept_timeout", "TLS accept timed out", "accept");
    sockaddr_storage address{};
#ifdef _WIN32
    int length = sizeof(address);
#else
    socklen_t length = sizeof(address);
#endif
    Socket peer = static_cast<Socket>(::accept(impl_->socket, reinterpret_cast<sockaddr*>(&address), &length));
    if (peer == kInvalidSocket) throw_tls("tls_socket_error", "could not accept TLS peer", "accept");
    SSL* ssl = nullptr;
    X509* certificate = nullptr;
    try {
        set_nonblocking(peer, true);
        ssl = SSL_new(context.get());
        if (ssl == nullptr) throw_tls("tls_backend_error", "could not allocate TLS session", "SSL_new", openssl_error());
        if (SSL_set_fd(ssl, static_cast<int>(peer)) != 1) {
            throw_tls("tls_socket_error", "could not attach accepted socket to TLS session", "SSL_set_fd", openssl_error());
        }
        handshake(ssl, peer, config.timeout, [ssl] { return SSL_accept(ssl); }, "SSL_accept");
        certificate = SSL_get1_peer_certificate(ssl);
        if (config.security.require_mtls && certificate == nullptr) {
            throw_tls("tls_client_certificate_missing", "mTLS peer did not present a client certificate", "peer_certificate");
        }
        PeerIdentity identity;
        if (certificate != nullptr) {
            validate_ocsp_response(ssl, certificate, config);
            identity = identity_from_certificate(certificate, config);
            X509_free(certificate);
            certificate = nullptr;
        }
        auto connection = std::make_unique<TlsConnection::Impl>();
        connection->context = std::move(context);
        connection->ssl = ssl;
        connection->socket = peer;
        connection->config = std::move(config);
        connection->identity = std::move(identity);
        ssl = nullptr;
        return TlsConnection(std::move(connection));
    } catch (...) {
        if (certificate != nullptr) X509_free(certificate);
        if (ssl != nullptr) SSL_free(ssl);
        close_socket(peer);
        throw;
    }
}

void TlsServer::close() noexcept { impl_.reset(); }

TlsConnection TlsClient::connect(std::string host,
                                 std::uint16_t port,
                                 TlsTransportConfig config) {
    config.security.validate_cpp_transport_support();
    if (config.security.profile != SecurityProfile::Standard) {
        throw SecurityError("tls_profile_invalid", "C++ TLS transport requires the standard profile");
    }
    if (config.server_name.empty()) config.server_name = host;
    auto context = make_context(config, false);
    Socket socket = connect_socket(host, port, config.timeout);
    SSL* ssl = nullptr;
    X509* certificate = nullptr;
    try {
        ssl = SSL_new(context.get());
        if (ssl == nullptr) throw_tls("tls_backend_error", "could not allocate TLS session", "SSL_new", openssl_error());
        if (SSL_set_fd(ssl, static_cast<int>(socket)) != 1) {
            throw_tls("tls_socket_error", "could not attach connected socket to TLS session", "SSL_set_fd", openssl_error());
        }
        if (SSL_set_tlsext_host_name(ssl, config.server_name.c_str()) != 1 || SSL_set1_host(ssl, config.server_name.c_str()) != 1) {
            SSL_free(ssl);
            throw_tls("tls_hostname_invalid", "could not configure TLS server name verification", "server_name", openssl_error());
        }
        handshake(ssl, socket, config.timeout, [ssl] { return SSL_connect(ssl); }, "SSL_connect");
        certificate = SSL_get1_peer_certificate(ssl);
        if (certificate == nullptr) {
            throw_tls("tls_server_certificate_missing", "TLS server did not present a certificate", "peer_certificate");
        }
        validate_ocsp_response(ssl, certificate, config);
        PeerIdentity identity = identity_from_certificate(certificate, config);
        X509_free(certificate);
        certificate = nullptr;
        auto connection = std::make_unique<TlsConnection::Impl>();
        connection->context = std::move(context);
        connection->ssl = ssl;
        connection->socket = socket;
        connection->config = std::move(config);
        connection->identity = std::move(identity);
        ssl = nullptr;
        return TlsConnection(std::move(connection));
    } catch (...) {
        if (certificate != nullptr) X509_free(certificate);
        if (ssl != nullptr) SSL_free(ssl);
        close_socket(socket);
        throw;
    }
}

}  // namespace handoffkit::csp

#else

namespace handoffkit::csp {

TlsCapabilities detect_cpp_tls_capabilities() noexcept { return {}; }

struct TlsConnection::Impl {};
struct TlsServer::Impl {};

TlsConnection::TlsConnection(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
TlsConnection::TlsConnection(TlsConnection&& other) noexcept = default;
TlsConnection& TlsConnection::operator=(TlsConnection&& other) noexcept = default;
TlsConnection::~TlsConnection() = default;
bool TlsConnection::valid() const noexcept { return false; }
const PeerIdentity& TlsConnection::peer_identity() const { throw SecurityError("tls_backend_unavailable", "C++ TLS requires HANDOFFKIT_WITH_TLS=ON"); }
std::string TlsConnection::negotiated_protocol() const { throw SecurityError("tls_backend_unavailable", "C++ TLS requires HANDOFFKIT_WITH_TLS=ON"); }
std::string TlsConnection::negotiated_group() const { throw SecurityError("tls_backend_unavailable", "C++ TLS requires HANDOFFKIT_WITH_TLS=ON"); }
void TlsConnection::send_json(const nlohmann::json&) { throw SecurityError("tls_backend_unavailable", "C++ TLS requires HANDOFFKIT_WITH_TLS=ON"); }
nlohmann::json TlsConnection::receive_json() { throw SecurityError("tls_backend_unavailable", "C++ TLS requires HANDOFFKIT_WITH_TLS=ON"); }
void TlsConnection::close() noexcept { impl_.reset(); }

TlsServer::TlsServer(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
TlsServer::TlsServer(TlsServer&& other) noexcept = default;
TlsServer& TlsServer::operator=(TlsServer&& other) noexcept = default;
TlsServer::~TlsServer() = default;
TlsServer TlsServer::listen(std::string, std::uint16_t, TlsTransportConfig) { throw SecurityError("tls_backend_unavailable", "C++ TLS requires HANDOFFKIT_WITH_TLS=ON"); }
std::uint16_t TlsServer::port() const noexcept { return 0; }
TlsConnection TlsServer::accept() { throw SecurityError("tls_backend_unavailable", "C++ TLS requires HANDOFFKIT_WITH_TLS=ON"); }
void TlsServer::reload(TlsTransportConfig) { throw SecurityError("tls_backend_unavailable", "C++ TLS requires HANDOFFKIT_WITH_TLS=ON"); }
void TlsServer::close() noexcept { impl_.reset(); }
TlsConnection TlsClient::connect(std::string, std::uint16_t, TlsTransportConfig) { throw SecurityError("tls_backend_unavailable", "C++ TLS requires HANDOFFKIT_WITH_TLS=ON"); }

}  // namespace handoffkit::csp

#endif
