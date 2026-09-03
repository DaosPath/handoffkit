#include <handoffkit/csp/tls_transport.hpp>
#include <handoffkit/csp/dispatcher.hpp>
#include <handoffkit/csp/os_keystore.hpp>

#include <cassert>
#include <cstdio>
#include <filesystem>
#include <future>
#include <functional>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iostream>
#include <algorithm>
#include <chrono>
#include <csignal>
#include <ctime>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <iomanip>
#include <sstream>
#include <codecvt>
#include <locale>

#if defined(HANDOFFKIT_WITH_TLS)
#include <openssl/crypto.h>
#include <openssl/evp.h>
#if !defined(OPENSSL_NO_OCSP)
#include <openssl/ocsp.h>
#endif
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
// wincrypt.h reuses OpenSSL identifiers as numeric provider constants.
// Keep the OpenSSL OCSP/X509 types usable in this integration test.
#ifdef X509_NAME
#undef X509_NAME
#endif
#ifdef OCSP_RESPONSE
#undef OCSP_RESPONSE
#endif
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif
#endif

using namespace handoffkit::csp;

#if defined(HANDOFFKIT_WITH_TLS)
namespace {

struct Key {
    EVP_PKEY* value{nullptr};
    Key() = default;
    ~Key() { EVP_PKEY_free(value); }
    Key(const Key&) = delete;
    Key& operator=(const Key&) = delete;
    Key(Key&& other) noexcept : value(other.value) { other.value = nullptr; }
    Key& operator=(Key&& other) noexcept {
        if (this != &other) {
            EVP_PKEY_free(value);
            value = other.value;
            other.value = nullptr;
        }
        return *this;
    }
};

struct Certificate {
    X509* value{nullptr};
    Certificate() = default;
    ~Certificate() { X509_free(value); }
    Certificate(const Certificate&) = delete;
    Certificate& operator=(const Certificate&) = delete;
    Certificate(Certificate&& other) noexcept : value(other.value) { other.value = nullptr; }
    Certificate& operator=(Certificate&& other) noexcept {
        if (this != &other) {
            X509_free(value);
            value = other.value;
            other.value = nullptr;
        }
        return *this;
    }
};

struct Crl {
    X509_CRL* value{nullptr};
    ~Crl() { X509_CRL_free(value); }
    Crl(const Crl&) = delete;
    Crl& operator=(const Crl&) = delete;
    Crl() = default;
};

#if !defined(OPENSSL_NO_OCSP)
struct OcspResponse {
    OCSP_RESPONSE* value{nullptr};
    ~OcspResponse() { OCSP_RESPONSE_free(value); }
    OcspResponse() = default;
    OcspResponse(const OcspResponse&) = delete;
    OcspResponse& operator=(const OcspResponse&) = delete;
};
#endif

Key make_key() {
    EVP_PKEY_CTX* context = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, nullptr);
    if (context == nullptr || EVP_PKEY_keygen_init(context) != 1 || EVP_PKEY_CTX_set_rsa_keygen_bits(context, 2048) != 1) {
        EVP_PKEY_CTX_free(context);
        throw std::runtime_error("could not initialize test RSA key");
    }
    Key key;
    if (EVP_PKEY_keygen(context, &key.value) != 1) {
        EVP_PKEY_CTX_free(context);
        throw std::runtime_error("could not generate test RSA key");
    }
    EVP_PKEY_CTX_free(context);
    return key;
}

void add_extension(X509* certificate, X509* issuer, int nid, const char* value) {
    X509V3_CTX context{};
    X509V3_set_ctx(&context, issuer, certificate, nullptr, nullptr, 0);
    X509_EXTENSION* extension = X509V3_EXT_conf_nid(nullptr, &context, nid, const_cast<char*>(value));
    if (extension == nullptr || X509_add_ext(certificate, extension, -1) != 1) {
        X509_EXTENSION_free(extension);
        throw std::runtime_error("could not add test certificate extension");
    }
    X509_EXTENSION_free(extension);
}

Certificate make_certificate(EVP_PKEY* subject_key,
                              X509* issuer,
                              EVP_PKEY* issuer_key,
                              const std::string& common_name,
                              const std::string& san,
                              bool is_ca) {
    Certificate certificate;
    certificate.value = X509_new();
    if (certificate.value == nullptr ||
        X509_set_version(certificate.value, 2) != 1 ||
        ASN1_INTEGER_set(X509_get_serialNumber(certificate.value), static_cast<long>(std::hash<std::string>{}(common_name) & 0x7fffffff)) != 1 ||
        X509_gmtime_adj(X509_get_notBefore(certificate.value), -60) == nullptr ||
        X509_gmtime_adj(X509_get_notAfter(certificate.value), 86400) == nullptr ||
        X509_set_pubkey(certificate.value, subject_key) != 1) {
        throw std::runtime_error("could not initialize test certificate");
    }
    X509_NAME* subject = X509_get_subject_name(certificate.value);
    if (X509_NAME_add_entry_by_txt(subject, "CN", MBSTRING_ASC,
                                   reinterpret_cast<const unsigned char*>(common_name.c_str()), -1, -1, 0) != 1) {
        throw std::runtime_error("could not set test certificate subject");
    }
    if (issuer == nullptr) {
        if (X509_set_issuer_name(certificate.value, subject) != 1) throw std::runtime_error("could not set CA issuer");
    } else if (X509_set_issuer_name(certificate.value, X509_get_subject_name(issuer)) != 1) {
        throw std::runtime_error("could not set leaf issuer");
    }
    add_extension(certificate.value, issuer == nullptr ? certificate.value : issuer,
                  NID_basic_constraints, is_ca ? "critical,CA:TRUE,pathlen:1" : "critical,CA:FALSE");
    add_extension(certificate.value, issuer == nullptr ? certificate.value : issuer,
                  NID_key_usage, is_ca ? "critical,keyCertSign,cRLSign" : "critical,digitalSignature,keyEncipherment");
    if (!san.empty()) {
        add_extension(certificate.value, issuer == nullptr ? certificate.value : issuer,
                      NID_subject_alt_name, san.c_str());
    }
    if (X509_sign(certificate.value, issuer_key == nullptr ? subject_key : issuer_key, EVP_sha256()) <= 0) {
        throw std::runtime_error("could not sign test certificate");
    }
    return certificate;
}

void write_key(const std::filesystem::path& path, EVP_PKEY* key) {
    FILE* file = std::fopen(path.string().c_str(), "wb");
    if (file == nullptr || PEM_write_PrivateKey(file, key, nullptr, nullptr, 0, nullptr, nullptr) != 1) {
        if (file != nullptr) std::fclose(file);
        throw std::runtime_error("could not write test private key");
    }
    std::fclose(file);
}

void write_certificate(const std::filesystem::path& path, X509* certificate) {
    FILE* file = std::fopen(path.string().c_str(), "wb");
    if (file == nullptr || PEM_write_X509(file, certificate) != 1) {
        if (file != nullptr) std::fclose(file);
        throw std::runtime_error("could not write test certificate");
    }
    std::fclose(file);
}

std::string certificate_fingerprint(const std::filesystem::path& path) {
    FILE* file = std::fopen(path.string().c_str(), "rb");
    if (file == nullptr) throw std::runtime_error("could not read certificate fingerprint fixture");
    Certificate certificate;
    certificate.value = PEM_read_X509(file, nullptr, nullptr, nullptr);
    std::fclose(file);
    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int length = 0;
    if (certificate.value == nullptr || X509_digest(certificate.value, EVP_sha256(), digest, &length) != 1 || length != 32) {
        throw std::runtime_error("could not calculate certificate fingerprint fixture");
    }
    std::ostringstream output;
    output << "sha256:" << std::hex << std::setfill('0');
    for (unsigned int index = 0; index < length; ++index) output << std::setw(2) << static_cast<unsigned int>(digest[index]);
    return output.str();
}

std::string read_text(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("could not read TLS fixture text");
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

std::string now_timestamp() {
    const auto time = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm utc{};
#ifdef _WIN32
    gmtime_s(&utc, &time);
#else
    gmtime_r(&time, &utc);
#endif
    std::ostringstream output;
    output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return output.str();
}

void write_crl(const std::filesystem::path& path,
               X509* issuer,
               EVP_PKEY* issuer_key,
               X509* revoked_certificate) {
    Crl crl;
    crl.value = X509_CRL_new();
    ASN1_TIME* last_update = ASN1_TIME_new();
    ASN1_TIME* next_update = ASN1_TIME_new();
    if (crl.value == nullptr || last_update == nullptr || next_update == nullptr ||
        X509_CRL_set_issuer_name(crl.value, X509_get_subject_name(issuer)) != 1 ||
        X509_gmtime_adj(last_update, -60) == nullptr ||
        X509_gmtime_adj(next_update, 86400) == nullptr ||
        X509_CRL_set1_lastUpdate(crl.value, last_update) != 1 ||
        X509_CRL_set1_nextUpdate(crl.value, next_update) != 1) {
        ASN1_TIME_free(last_update);
        ASN1_TIME_free(next_update);
        throw std::runtime_error("could not initialize test CRL");
    }
    ASN1_TIME_free(last_update);
    ASN1_TIME_free(next_update);
    X509_REVOKED* revoked = X509_REVOKED_new();
    ASN1_TIME* revocation_time = ASN1_TIME_new();
    if (revoked == nullptr || revocation_time == nullptr ||
        X509_REVOKED_set_serialNumber(revoked, X509_get_serialNumber(revoked_certificate)) != 1 ||
        X509_gmtime_adj(revocation_time, -30) == nullptr ||
        X509_REVOKED_set_revocationDate(revoked, revocation_time) != 1) {
        X509_REVOKED_free(revoked);
        ASN1_TIME_free(revocation_time);
        throw std::runtime_error("could not create test CRL");
    }
    if (X509_CRL_add0_revoked(crl.value, revoked) != 1) {
        X509_REVOKED_free(revoked);
        ASN1_TIME_free(revocation_time);
        throw std::runtime_error("could not add revoked certificate to test CRL");
    }
    // X509_CRL_add0_revoked owns the revoked entry after success.
    ASN1_TIME_free(revocation_time);
    if (X509_CRL_sort(crl.value) != 1 || X509_CRL_sign(crl.value, issuer_key, EVP_sha256()) <= 0) {
        throw std::runtime_error("could not sign test CRL");
    }
    FILE* file = std::fopen(path.string().c_str(), "wb");
    if (file == nullptr || PEM_write_X509_CRL(file, crl.value) != 1) {
        if (file != nullptr) std::fclose(file);
        throw std::runtime_error("could not write test CRL");
    }
    std::fclose(file);
}

#if !defined(OPENSSL_NO_OCSP)
void write_ocsp_response(const std::filesystem::path& path,
                         X509* issuer,
                         EVP_PKEY* issuer_key,
                         X509* subject,
                         int status) {
    OCSP_BASICRESP* basic = OCSP_BASICRESP_new();
    OCSP_CERTID* id = OCSP_cert_to_id(EVP_sha1(), subject, issuer);
    ASN1_TIME* this_update = ASN1_TIME_new();
    ASN1_TIME* next_update = ASN1_TIME_new();
    ASN1_TIME* revocation_time = status == V_OCSP_CERTSTATUS_REVOKED ? ASN1_TIME_new() : nullptr;
    if (basic == nullptr || id == nullptr || this_update == nullptr || next_update == nullptr ||
        (status == V_OCSP_CERTSTATUS_REVOKED && revocation_time == nullptr) ||
        X509_gmtime_adj(this_update, -30) == nullptr ||
        X509_gmtime_adj(next_update, 86400) == nullptr ||
        (revocation_time != nullptr && X509_gmtime_adj(revocation_time, -60) == nullptr) ||
        OCSP_basic_add1_status(
            basic, id, status,
            status == V_OCSP_CERTSTATUS_REVOKED ? OCSP_REVOKED_STATUS_KEYCOMPROMISE : 0,
            revocation_time, this_update, next_update) == nullptr ||
        OCSP_basic_sign(basic, issuer, issuer_key, EVP_sha256(), nullptr, 0) != 1) {
        OCSP_BASICRESP_free(basic);
        OCSP_CERTID_free(id);
        ASN1_TIME_free(this_update);
        ASN1_TIME_free(next_update);
        ASN1_TIME_free(revocation_time);
        throw std::runtime_error("could not create test OCSP response");
    }
    // OCSP_basic_add1_status copies the certificate id and validity times.
    OCSP_CERTID_free(id);
    ASN1_TIME_free(this_update);
    ASN1_TIME_free(next_update);
    ASN1_TIME_free(revocation_time);
    OcspResponse response;
    response.value = OCSP_response_create(OCSP_RESPONSE_STATUS_SUCCESSFUL, basic);
    // OCSP_response_create encodes the basic response into the outer object;
    // it does not own the caller's OCSP_BASICRESP. Release it explicitly so
    // sanitizer runs do not retain the fixture's ASN.1 allocations.
    OCSP_BASICRESP_free(basic);
    basic = nullptr;
    if (response.value == nullptr) {
        throw std::runtime_error("could not wrap test OCSP response");
    }
    const int encoded_length = i2d_OCSP_RESPONSE(response.value, nullptr);
    std::vector<unsigned char> encoded(encoded_length > 0 ? static_cast<std::size_t>(encoded_length) : 0U);
    unsigned char* cursor = encoded.data();
    if (encoded_length <= 0 || i2d_OCSP_RESPONSE(response.value, &cursor) != encoded_length) {
        throw std::runtime_error("could not encode test OCSP response");
    }
    FILE* file = std::fopen(path.string().c_str(), "wb");
    if (file == nullptr || std::fwrite(encoded.data(), 1, encoded.size(), file) != encoded.size()) {
        if (file != nullptr) std::fclose(file);
        throw std::runtime_error("could not write test OCSP response");
    }
    std::fclose(file);
}

#endif

struct Fixtures {
    std::filesystem::path root;
    std::filesystem::path ca;
    std::filesystem::path server_cert;
    std::filesystem::path server_key;
    std::filesystem::path client_cert;
    std::filesystem::path client_key;
    std::filesystem::path crl;
    std::filesystem::path ocsp_good;
    std::filesystem::path ocsp_revoked;
};

Fixtures make_fixtures() {
    Fixtures paths;
    paths.root = std::filesystem::temp_directory_path() / ("handoffkit-cpp-tls-" + std::to_string(std::rand()));
    std::filesystem::create_directories(paths.root);
    paths.ca = paths.root / "ca.pem";
    paths.server_cert = paths.root / "server.pem";
    paths.server_key = paths.root / "server.key";
    paths.client_cert = paths.root / "client.pem";
    paths.client_key = paths.root / "client.key";
    paths.crl = paths.root / "revoked-client-crl.pem";
#if !defined(OPENSSL_NO_OCSP)
    paths.ocsp_good = paths.root / "client-good.ocsp.der";
    paths.ocsp_revoked = paths.root / "client-revoked.ocsp.der";
#endif

    auto ca_key = make_key();
    auto ca_cert = make_certificate(ca_key.value, nullptr, nullptr, "HandoffKit Test CA", {}, true);
    auto server_key = make_key();
    auto server_cert = make_certificate(
        server_key.value, ca_cert.value, ca_key.value, "HandoffKit Test Server",
        "DNS:localhost,URI:spiffe://handoffkit.internal/peer/server/node/server-node", false);
    auto client_key = make_key();
    auto client_cert = make_certificate(
        client_key.value, ca_cert.value, ca_key.value, "HandoffKit Test Client",
        "URI:spiffe://handoffkit.internal/peer/client/node/client-node/worker/client-worker", false);
    write_certificate(paths.ca, ca_cert.value);
    write_certificate(paths.server_cert, server_cert.value);
    write_key(paths.server_key, server_key.value);
    write_certificate(paths.client_cert, client_cert.value);
    write_key(paths.client_key, client_key.value);
    write_crl(paths.crl, ca_cert.value, ca_key.value, client_cert.value);
#if !defined(OPENSSL_NO_OCSP)
    write_ocsp_response(paths.ocsp_good, ca_cert.value, ca_key.value, client_cert.value, V_OCSP_CERTSTATUS_GOOD);
    write_ocsp_response(paths.ocsp_revoked, ca_cert.value, ca_key.value, client_cert.value, V_OCSP_CERTSTATUS_REVOKED);
#endif
    return paths;
}

TlsTransportConfig config(const Fixtures& fixtures, bool server) {
    TlsTransportConfig value;
    value.security.profile = SecurityProfile::Standard;
    value.security.require_mtls = true;
    value.security.trust_domain = "handoffkit.internal";
    value.security.ca_cert_path = fixtures.ca.string();
    value.security.cert_path = (server ? fixtures.server_cert : fixtures.client_cert).string();
    value.security.key_path = (server ? fixtures.server_key : fixtures.client_key).string();
    value.server_name = "localhost";
    value.timeout = std::chrono::milliseconds(3000);
    return value;
}

void test_real_mtls_roundtrip() {
    const Fixtures fixtures = make_fixtures();
    auto server_config = config(fixtures, true);
    server_config.peer_policy.expected_peer_id = "client";
    server_config.peer_policy.expected_node_id = "client-node";
    server_config.peer_policy.expected_worker_id = "client-worker";
    auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
    const auto port = listener.port();
    std::promise<nlohmann::json> server_result;
    auto result = server_result.get_future();
    std::thread server_thread([listener = std::move(listener), promise = std::move(server_result)]() mutable {
        try {
            auto connection = listener.accept();
            if (connection.peer_identity().peer_id != "client" || connection.peer_identity().worker_id != "client-worker") {
                throw std::runtime_error("server received incorrect certificate identity");
            }
            const auto request = connection.receive_json();
            connection.send_json({{"ok", true}, {"peer_id", connection.peer_identity().peer_id}});
            promise.set_value(request);
        } catch (...) {
            promise.set_exception(std::current_exception());
        }
    });

    auto client_config = config(fixtures, false);
    client_config.peer_policy.expected_peer_id = "server";
    client_config.peer_policy.expected_node_id = "server-node";
    auto client = TlsClient::connect("127.0.0.1", port, client_config);
    assert(client.negotiated_protocol() == "TLSv1.3");
    assert(client.peer_identity().peer_id == "server");
    client.send_json({{"kind", "cpp-tls-roundtrip"}, {"value", 42}});
    const auto response = client.receive_json();
    assert(response.at("ok").get<bool>());
    assert(response.at("peer_id").get<std::string>() == "client");
    client.close();
    server_thread.join();
    const auto request = result.get();
    assert(request.at("kind").get<std::string>() == "cpp-tls-roundtrip");
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ real TLS 1.3/mTLS roundtrip" << std::endl;
}

void test_hostname_rejection() {
    const Fixtures fixtures = make_fixtures();
    auto server_config = config(fixtures, true);
    auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
    const auto port = listener.port();
    std::thread server_thread([listener = std::move(listener)]() mutable {
        try {
            (void)listener.accept();
        } catch (...) {
        }
    });
    auto client_config = config(fixtures, false);
    client_config.server_name = "wrong.example";
    bool rejected = false;
    try {
        (void)TlsClient::connect("127.0.0.1", port, client_config);
    } catch (const SecurityError& error) {
        rejected = error.code() == "tls_handshake_failed" || error.code() == "tls_hostname_invalid";
    }
    assert(rejected);
    server_thread.join();
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ TLS hostname rejection" << std::endl;
}

void test_crl_rejection() {
    const Fixtures fixtures = make_fixtures();
    auto server_config = config(fixtures, true);
    server_config.security.crl_path = fixtures.crl.string();
    auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
    const auto port = listener.port();
    std::promise<bool> server_result;
    auto server_rejected_result = server_result.get_future();
    std::thread server_thread([listener = std::move(listener), promise = std::move(server_result)]() mutable {
        try {
            (void)listener.accept();
            promise.set_value(false);
        } catch (const SecurityError& error) {
            promise.set_value(error.code() == "tls_handshake_failed");
        } catch (const std::exception& error) {
            promise.set_value(false);
        }
    });
    bool rejected = false;
    try {
        (void)TlsClient::connect("127.0.0.1", port, config(fixtures, false));
    } catch (const SecurityError& error) {
        rejected = error.code() == "tls_handshake_failed" || error.code() == "tls_peer_closed";
    }
    rejected = rejected || server_rejected_result.get();
    assert(rejected);
    server_thread.join();
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ CRL rejects revoked client certificate" << std::endl;
}

#if !defined(OPENSSL_NO_OCSP)
void test_ocsp_good_response() {
    const Fixtures fixtures = make_fixtures();
    auto server_config = config(fixtures, true);
    server_config.security.ocsp_response_path = fixtures.ocsp_good.string();
    auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
    const auto port = listener.port();
    std::promise<bool> server_result;
    auto result = server_result.get_future();
    std::thread server_thread([listener = std::move(listener), promise = std::move(server_result)]() mutable {
        try {
            auto connection = listener.accept();
            const auto request = connection.receive_json();
            promise.set_value(connection.peer_identity().peer_id == "client" && request.at("ocsp").get<bool>());
            connection.send_json({{"ok", true}});
        } catch (const SecurityError&) {
            promise.set_value(false);
        } catch (...) {
            promise.set_value(false);
        }
    });
    try {
        auto client = TlsClient::connect("127.0.0.1", port, config(fixtures, false));
        client.send_json({{"ocsp", true}});
        assert(client.receive_json().at("ok").get<bool>());
        client.close();
    } catch (const SecurityError&) {
        throw;
    }
    assert(result.get());
    server_thread.join();
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ OCSP good response accepted" << std::endl;
}

void test_ocsp_revoked_response() {
    const Fixtures fixtures = make_fixtures();
    auto server_config = config(fixtures, true);
    server_config.security.ocsp_response_path = fixtures.ocsp_revoked.string();
    auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
    const auto port = listener.port();
    std::promise<bool> server_result;
    auto result = server_result.get_future();
    std::thread server_thread([listener = std::move(listener), promise = std::move(server_result)]() mutable {
        try {
            (void)listener.accept();
            promise.set_value(false);
        } catch (const SecurityError& error) {
            promise.set_value(error.code() == "tls_ocsp_revoked");
        } catch (...) {
            promise.set_value(false);
        }
    });
    try {
        auto client = TlsClient::connect("127.0.0.1", port, config(fixtures, false));
        result.wait();
        client.close();
    } catch (...) {
        result.wait();
    }
    assert(result.get());
    server_thread.join();
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ OCSP revoked response rejected" << std::endl;
}

void test_ocsp_missing_response() {
    const Fixtures fixtures = make_fixtures();
    auto server_config = config(fixtures, true);
    server_config.security.ocsp_response_path = (fixtures.root / "missing.ocsp.der").string();
    auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
    const auto port = listener.port();
    std::promise<bool> server_result;
    auto result = server_result.get_future();
    std::thread server_thread([listener = std::move(listener), promise = std::move(server_result)]() mutable {
        try {
            (void)listener.accept();
            promise.set_value(false);
        } catch (const SecurityError& error) {
            promise.set_value(error.code() == "tls_ocsp_invalid");
        } catch (...) {
            promise.set_value(false);
        }
    });
    try {
        auto client = TlsClient::connect("127.0.0.1", port, config(fixtures, false));
        result.wait();
        client.close();
    } catch (...) {
        result.wait();
    }
    assert(result.get());
    server_thread.join();
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ OCSP missing response rejected" << std::endl;
}

void test_ocsp_fetch_unavailable() {
    const Fixtures fixtures = make_fixtures();
    auto server_config = config(fixtures, true);
    server_config.security.ocsp_fetch = true;
    server_config.security.require_ocsp = true;
    server_config.security.ocsp_responder_url = "http://127.0.0.1:1/ocsp";
    bool rejected = false;
    try {
        (void)TlsServer::listen("127.0.0.1", 0, server_config);
    } catch (const SecurityError& error) {
        rejected = error.code() == "ocsp_fetch_unavailable";
    }
    assert(rejected);
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ OCSP fetch unavailable path fails closed" << std::endl;
}
#endif

void test_common_dispatcher_path() {
    const Fixtures fixtures = make_fixtures();
    auto server_config = config(fixtures, true);
    server_config.peer_policy.capabilities_by_fingerprint[certificate_fingerprint(fixtures.client_cert)] = {"evaluate"};
    auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
    const auto port = listener.port();
    std::promise<bool> server_result;
    auto result = server_result.get_future();
    std::thread server_thread([listener = std::move(listener), promise = std::move(server_result)]() mutable {
        try {
            auto connection = listener.accept();
            ReplayProtection replay;
            CspDispatcher dispatcher(connection, replay);
            auto dispatched = dispatcher.receive_and_dispatch([](const PeerIdentity& identity, const MessageEnvelope& envelope) {
                assert(identity.peer_id == "client");
                assert(envelope.payload_type == "evaluate");
                return handoffkit::Result<nlohmann::json>::success({{"accepted", true}});
            });
            if (!dispatched) {
                promise.set_value(false);
                return;
            }
            connection.send_json(dispatched.value());
            bool replay_rejected = false;
            try {
                (void)dispatcher.receive_and_dispatch([](const PeerIdentity&, const MessageEnvelope&) {
                    return handoffkit::Result<nlohmann::json>::success(nlohmann::json{{"unexpected", true}});
                });
            } catch (const SecurityError& error) {
                replay_rejected = error.code() == "replay_sequence" || error.code() == "replay_nonce";
            }
            bool capability_rejected = false;
            try {
                (void)dispatcher.receive_and_dispatch([](const PeerIdentity&, const MessageEnvelope&) {
                    return handoffkit::Result<nlohmann::json>::success(nlohmann::json{{"unexpected", true}});
                });
            } catch (const SecurityError& error) {
                capability_rejected = error.code() == "capability_claim_rejected";
            }
            promise.set_value(replay_rejected && capability_rejected);
        } catch (...) {
            promise.set_value(false);
        }
    });
    auto client_config = config(fixtures, false);
    client_config.peer_policy.expected_peer_id = "server";
    client_config.peer_policy.expected_node_id = "server-node";
    auto client = TlsClient::connect("127.0.0.1", port, client_config);
    MessageEnvelope envelope;
    envelope.message_id = "dispatcher-message";
    envelope.session_id = "dispatcher-session";
    envelope.channel = "jobs";
    envelope.kind = "request";
    envelope.source = "client";
    envelope.sequence = 1;
    envelope.created_at = now_timestamp();
    envelope.idempotency_key = "dispatcher-idempotency";
    envelope.payload_type = "evaluate";
    envelope.payload = {{"input", "artifact://dispatcher"}};
    envelope.metadata = {{"nonce", "dispatcher-nonce"}};
    client.send_json(envelope.to_json());
    assert(client.receive_json().at("accepted").get<bool>());
    client.send_json(envelope.to_json());
    auto spoofed = envelope;
    spoofed.sequence = 2;
    spoofed.metadata["capabilities"] = nlohmann::json::array({"*"});
    spoofed.metadata["nonce"] = "dispatcher-spoofed-nonce";
    client.send_json(spoofed.to_json());
    assert(result.get());
    client.close();
    server_thread.join();
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ common CSP dispatcher receive/validate/replay/authorize/dispatch" << std::endl;
}

void test_os_keystore_credentials_feed_tls() {
    if (!OsKeyStore::available()) {
        std::cout << "[SKIP] C++ TLS OS keystore integration (provider unavailable)" << std::endl;
        return;
    }
    const Fixtures fixtures = make_fixtures();
    const auto target = std::wstring(L"HandoffKit.TlsBundle.") + std::to_wstring(
        std::chrono::steady_clock::now().time_since_epoch().count());
    OsKeyStore store(target);
    try {
        store.put(nlohmann::json{
            {"certificate_pem", read_text(fixtures.server_cert)},
            {"private_key_pem", read_text(fixtures.server_key)}}.dump());
    } catch (const SecurityError& error) {
        // A compiled provider can still be unavailable in a locked-down CI
        // session (for example Credential Manager policy). Keep that result
        // explicit instead of treating an environmental denial as a TLS bug.
        assert(error.code() == "os_keystore_error" ||
               error.code() == "os_keystore_unavailable");
        std::filesystem::remove_all(fixtures.root);
        std::cout << "[SKIP] C++ TLS OS keystore integration (provider denied access)" << std::endl;
        return;
    }
    auto server_config = config(fixtures, true);
    server_config.security.cert_path.reset();
    server_config.security.key_path.reset();
    server_config.security.credential_source = "os_keystore";
    server_config.security.credential_target = "handoffkit-tls-bundle";
    // The C++ transport uses the UTF-8 target value; keep the provider target
    // deterministic for this test while preserving the platform-native store.
    server_config.security.credential_target =
        std::wstring_convert<std::codecvt_utf8<wchar_t>>{}.to_bytes(target);
    auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
    const auto port = listener.port();
    std::promise<bool> accepted;
    auto result = accepted.get_future();
    std::thread server_thread([listener = std::move(listener), promise = std::move(accepted)]() mutable {
        try {
            auto connection = listener.accept();
            const bool identity_ok = connection.peer_identity().peer_id == "client";
            connection.send_json({{"reload", true}});
            promise.set_value(identity_ok);
        } catch (...) {
            promise.set_value(false);
        }
    });
    auto client = TlsClient::connect("127.0.0.1", port, config(fixtures, false));
    assert(client.receive_json().at("reload").get<bool>());
    client.close();
    assert(result.get());
    server_thread.join();
    store.erase();
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ OS keystore certificate bundle feeds real TLS listener" << std::endl;
}

void test_atomic_tls_reload() {
    const Fixtures fixtures = make_fixtures();
    const auto rotated_cert = fixtures.root / "server-rotated.pem";
    const auto rotated_key_path = fixtures.root / "server-rotated.key";
    auto rotated_key = make_key();
    // Reuse the test CA and URI SAN while changing the leaf key/fingerprint.
    Key ca_key = make_key();
    // The CA private key is not persisted by the fixture helper, so create a
    // second self-contained CA/leaf pair for the reload proof.
    auto rotated_ca = make_certificate(ca_key.value, nullptr, nullptr, "HandoffKit Rotated CA", {}, true);
    auto rotated_leaf = make_certificate(
        rotated_key.value,
        rotated_ca.value,
        ca_key.value,
        "HandoffKit Rotated Server",
        "DNS:localhost,URI:spiffe://handoffkit.internal/peer/server/node/server-node",
        false);
    const auto rotated_ca_path = fixtures.root / "rotated-ca.pem";
    write_certificate(rotated_ca_path, rotated_ca.value);
    write_certificate(rotated_cert, rotated_leaf.value);
    write_key(rotated_key_path, rotated_key.value);
    const auto trust_bundle = fixtures.root / "trust-bundle.pem";
    {
        std::ofstream output(trust_bundle, std::ios::binary | std::ios::trunc);
        assert(output);
        output << read_text(fixtures.ca) << read_text(rotated_ca_path);
    }

    // The first connection proves the old context is live before reload.
    auto server_config = config(fixtures, true);
    auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
    const auto port = listener.port();
    std::promise<bool> first;
    auto first_result = first.get_future();
    std::thread first_thread([&listener, promise = std::move(first)]() mutable {
        try {
            auto connection = listener.accept();
            const bool identity_ok = connection.peer_identity().peer_id == "client";
            connection.send_json({{"reload", true}});
            promise.set_value(identity_ok);
        } catch (const SecurityError& error) {
            std::cerr << "reload first accept: " << error.code() << ": "
                      << error.what() << " " << error.details().dump() << std::endl;
            promise.set_value(false);
        } catch (const std::exception& error) {
            std::cerr << "reload first accept: " << error.what() << std::endl;
            promise.set_value(false);
        } catch (...) {
            promise.set_value(false);
        }
    });
    auto client = TlsClient::connect("127.0.0.1", port, config(fixtures, false));
    assert(client.receive_json().at("reload").get<bool>());
    client.close();
    assert(first_result.get());
    first_thread.join();

    // Install a new trust/credential snapshot without changing the listening
    // socket. The rotated CA is also trusted by the client for this test.
    auto reloaded = config(fixtures, true);
    reloaded.security.ca_cert_path = trust_bundle.string();
    reloaded.security.cert_path = rotated_cert.string();
    reloaded.security.key_path = rotated_key_path.string();
    auto rotated_client_config = config(fixtures, false);
    rotated_client_config.security.ca_cert_path = trust_bundle.string();
    rotated_client_config.peer_policy.capabilities_by_fingerprint[
        certificate_fingerprint(rotated_cert)] = {"server"};
    listener.reload(reloaded);
    std::promise<bool> second;
    auto second_result = second.get_future();
    std::thread second_thread([&listener, promise = std::move(second)]() mutable {
        try {
            auto connection = listener.accept();
            const bool identity_ok = connection.peer_identity().peer_id == "client";
            connection.send_json({{"reload", true}});
            promise.set_value(identity_ok);
        } catch (const std::exception& error) {
            std::cerr << "reload second accept: " << error.what() << std::endl;
            promise.set_value(false);
        } catch (...) {
            promise.set_value(false);
        }
    });
    auto second_client = TlsClient::connect("127.0.0.1", port, rotated_client_config);
    assert(second_client.receive_json().at("reload").get<bool>());
    second_client.close();
    assert(second_result.get());
    second_thread.join();

    // A client that still authorizes only the old server fingerprint rejects
    // the rotated credential before any CSP frame is sent.
    std::promise<bool> third;
    auto third_result = third.get_future();
    std::thread third_thread([&listener, promise = std::move(third)]() mutable {
        try {
            (void)listener.accept();
            promise.set_value(true);
        } catch (const SecurityError& error) {
            promise.set_value(error.code() == "tls_handshake_failed");
        } catch (...) {
            promise.set_value(false);
        }
    });
    auto old_client_config = config(fixtures, false);
    old_client_config.security.ca_cert_path = trust_bundle.string();
    old_client_config.peer_policy.capabilities_by_fingerprint[
        certificate_fingerprint(fixtures.server_cert)] = {"server"};
    bool old_rejected = false;
    try {
        (void)TlsClient::connect("127.0.0.1", port, old_client_config);
    } catch (const SecurityError& error) {
        old_rejected = error.code() == "peer_not_authorized" ||
            error.code() == "tls_handshake_failed";
    }
    assert(old_rejected);
    assert(third_result.get());
    third_thread.join();
    std::filesystem::remove_all(fixtures.root);
    std::cout << "[PASS] C++ TLS atomic credential rotation and old-fingerprint rejection" << std::endl;
}

void benchmark_real_tls() {
    constexpr int iterations = 25;
    std::vector<double> samples;
    samples.reserve(iterations);
    for (int index = 0; index < iterations; ++index) {
        const Fixtures fixtures = make_fixtures();
        auto server_config = config(fixtures, true);
        auto listener = TlsServer::listen("127.0.0.1", 0, server_config);
        const auto port = listener.port();
        std::thread server_thread([listener = std::move(listener)]() mutable {
            try {
                auto connection = listener.accept();
                connection.close();
            } catch (...) {
            }
        });
        const auto start = std::chrono::steady_clock::now();
        auto client = TlsClient::connect("127.0.0.1", port, config(fixtures, false));
        client.close();
        server_thread.join();
        const auto elapsed = std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - start).count();
        samples.push_back(elapsed);
        std::filesystem::remove_all(fixtures.root);
    }
    std::sort(samples.begin(), samples.end());
    const auto percentile = [&samples](double fraction) {
        const auto index = static_cast<std::size_t>(fraction * static_cast<double>(samples.size() - 1));
        return samples[index];
    };
    const char* architecture = "unknown";
#if defined(_M_ARM64) || defined(__aarch64__)
    architecture = "arm64";
#elif defined(_M_X64) || defined(__x86_64__)
    architecture = "x86_64";
#elif defined(_M_IX86) || defined(__i386__)
    architecture = "x86";
#elif defined(_M_ARM) || defined(__arm__)
    architecture = "arm";
#endif
    std::cout << "{\"runtime\":\"cpp\",\"architecture\":\"" << architecture
              << "\",\"provider\":\"OpenSSL\",\"provider_version\":\""
              << OpenSSL_version(OPENSSL_VERSION) << "\",\"iterations\":" << iterations
              << ",\"p50_ms\":" << percentile(0.50)
              << ",\"p95_ms\":" << percentile(0.95)
              << ",\"p99_ms\":" << percentile(0.99)
              << ",\"notice\":\"Environmental measurement - not a performance guarantee.\"}"
              << std::endl;
}

}  // namespace
#endif

int main(int argc, char** argv) {
#if !defined(_WIN32)
    // Do not inherit a parent process's SIGPIPE policy: the transport must
    // survive a peer closing during OpenSSL I/O on its own.
    std::signal(SIGPIPE, SIG_DFL);
#endif
    const auto capabilities = detect_cpp_tls_capabilities();
#if defined(HANDOFFKIT_WITH_TLS)
    assert(capabilities.tls13_supported);
    assert(capabilities.mtls_supported);
    assert(capabilities.crl_supported);
#if !defined(OPENSSL_NO_OCSP)
    assert(capabilities.ocsp_supported);
    assert(!capabilities.ocsp_fetch_supported);
#else
    assert(!capabilities.ocsp_supported);
    assert(!capabilities.ocsp_fetch_supported);
#endif
    if (argc > 1 && std::string(argv[1]) == "--benchmark") {
        benchmark_real_tls();
        return 0;
    }
    test_real_mtls_roundtrip();
    test_hostname_rejection();
    test_crl_rejection();
#if !defined(OPENSSL_NO_OCSP)
    test_ocsp_good_response();
    test_ocsp_revoked_response();
    test_ocsp_missing_response();
    test_ocsp_fetch_unavailable();
#endif
    test_common_dispatcher_path();
    test_os_keystore_credentials_feed_tls();
    test_atomic_tls_reload();
#else
    assert(!capabilities.tls13_supported);
    bool rejected = false;
    try {
        (void)TlsClient::connect("127.0.0.1", 1, {});
    } catch (const SecurityError& error) {
        rejected = error.code() == "tls_backend_unavailable";
    }
    assert(rejected);
    std::cout << "[PASS] C++ TLS unavailable path" << std::endl;
#endif
    return 0;
}
