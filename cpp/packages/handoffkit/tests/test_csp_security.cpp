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
    caught = false;
    try {
        cfg.validate_cpp_transport_support();
    } catch (const SecurityError& error) {
        assert(error.code() == "tls_backend_unavailable");
        caught = true;
    }
    assert(caught);
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

int main() {
    test_security_config();
    test_peer_identity();
    test_capability_policy();
    test_replay_protection();
    std::cout << "All C++ security tests passed!" << std::endl;
    return 0;
}
