#include <handoffkit/csp/security.hpp>
#include <cassert>
#include <cstdlib>
#include <iostream>

using namespace handoffkit::csp;

#undef assert
#define assert(condition)           \
    do {                            \
        if (!(condition)) abort();  \
    } while (false)

void test_security_config() {
    SecurityConfig cfg;
    assert(to_string(cfg.profile) == "local");
    cfg.validate_listen_address("127.0.0.1");

    bool caught = false;
    try {
        cfg.validate_listen_address("192.168.1.1");
    } catch (const SecurityError& error) {
        assert(error.code() == "insecure_public_bind");
        caught = true;
    }
    assert(caught);
    cfg.allow_insecure_loopback = true;
    caught = false;
    try {
        cfg.validate_listen_address("0.0.0.0");
    } catch (const SecurityError& error) {
        assert(error.code() == "insecure_public_bind");
        caught = true;
    }
    assert(caught);

    cfg.profile = SecurityProfile::Standard;
#if defined(HANDOFFKIT_WITH_TLS)
    cfg.validate_cpp_transport_support();
#else
    caught = false;
    try {
        cfg.validate_cpp_transport_support();
    } catch (const SecurityError& error) {
        assert(error.code() == "tls_backend_unavailable");
        caught = true;
    }
    assert(caught);
#endif
    std::cout << "[PASS] C++ SecurityConfig test" << std::endl;
}

void test_peer_identity() {
    PeerIdentity peer;
    peer.peer_id = "p1";
    peer.node_id = "n1";
    peer.capabilities = {"job:training"};
    peer.issued_at = 1000;
    peer.expires_at = 2000;

    assert(peer.is_valid_at(1500));
    assert(!peer.is_valid_at(2500));
    std::cout << "[PASS] C++ PeerIdentity test" << std::endl;
}

void test_capability_policy() {
    CapabilityPolicy policy(std::vector<std::string>{"job:training"});
    PeerIdentity peer;
    peer.peer_id = "p1";
    peer.node_id = "n1";
    peer.capabilities = {"job:training"};

    assert(policy.is_operation_authorized("job:training", &peer));
    assert(!policy.is_operation_authorized("job:evaluation", &peer));
    peer.capabilities.clear();
    assert(!policy.is_operation_authorized("job:training", &peer));
    std::cout << "[PASS] C++ CapabilityPolicy test" << std::endl;
}

void test_replay_protection() {
    ReplayProtection rp(300, 10, 1000);
    rp.check_and_record("s1", 1, "nonce-1");
    rp.check_and_record("s1", 2, "nonce-2");

    bool caught_seq = false;
    try {
        rp.check_and_record("s1", 2, "nonce-3");
    } catch (const std::runtime_error&) {
        caught_seq = true;
    }
    assert(caught_seq);

    rp.check_and_record("s2", 1, "nonce-1");
    bool caught_nonce = false;
    try {
        rp.check_and_record("s2", 2, "nonce-1");
    } catch (const std::runtime_error&) {
        caught_nonce = true;
    }
    assert(caught_nonce);

    rp.check_and_record("peer-a", "shared", 1, "scoped");
    rp.check_and_record("peer-b", "shared", 1, "scoped");

    std::cout << "[PASS] C++ ReplayProtection test" << std::endl;
}

void test_unavailable_capabilities_fail_closed() {
    SecurityConfig ocsp;
    ocsp.profile = SecurityProfile::Standard;
    ocsp.ocsp_fetch = true;
    ocsp.ocsp_responder_url = "http://127.0.0.1:8080/ocsp";
    ocsp.require_ocsp = true;
    bool ocsp_rejected = false;
    std::string ocsp_error;
    try {
        ocsp.validate_cpp_transport_support();
    } catch (const SecurityError& error) {
        ocsp_rejected = error.code() == "ocsp_fetch_unavailable" ||
            error.code() == "ocsp_backend_unavailable" ||
            error.code() == "tls_backend_unavailable";
        ocsp_error = error.code();
    }
    if (!ocsp_rejected) std::cerr << "OCSP fail-closed code=" << ocsp_error << std::endl;
    assert(ocsp_rejected);

    SecurityConfig ambiguous;
    ambiguous.profile = SecurityProfile::Standard;
    ambiguous.ocsp_responder_url = "http://127.0.0.1:8080/ocsp";
    bool ambiguous_rejected = false;
    try {
        ambiguous.validate_cpp_transport_support();
    } catch (const SecurityError& error) {
        ambiguous_rejected = error.code() == "ocsp_fetch_unavailable" ||
            error.code() == "ocsp_backend_unavailable" ||
            error.code() == "tls_backend_unavailable";
    }
    if (!ambiguous_rejected) std::cerr << "ambiguous OCSP config was accepted" << std::endl;
    assert(ambiguous_rejected);

    SecurityConfig hybrid;
    hybrid.profile = SecurityProfile::HybridPq;
    bool hybrid_rejected = false;
    try {
        hybrid.validate_cpp_transport_support();
    } catch (const SecurityError& error) {
        hybrid_rejected = error.code() == "security_profile_unavailable" &&
            error.details().value("profile", "") == "hybrid-pq";
    }
    if (!hybrid_rejected) std::cerr << "hybrid profile was accepted" << std::endl;
    assert(hybrid_rejected);
    std::cout << "[PASS] unavailable C++ hybrid-PQ/ambiguous OCSP paths fail closed" << std::endl;
}

int main() {
    test_security_config();
    test_peer_identity();
    test_capability_policy();
    test_replay_protection();
    test_unavailable_capabilities_fail_closed();
    std::cout << "All C++ security tests passed!" << std::endl;
    return 0;
}
