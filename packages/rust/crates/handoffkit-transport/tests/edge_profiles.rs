use handoffkit_protocol::security::{CapabilityPolicy, SecurityConfig, SecurityProfile};
use handoffkit_protocol::EdgeRuntimeProfile;
use handoffkit_transport::{CertificateIdentityPolicy, NetworkConfig, SecureNetworkConfig};
use std::collections::HashMap;
use std::time::Duration;

fn identity_policy() -> CertificateIdentityPolicy {
    let mut policy = CertificateIdentityPolicy::new("edge.example", HashMap::new());
    policy.require_authorized_fingerprint = false;
    policy
}

#[test]
fn edge_profile_drives_real_transport_limits() {
    let profile = EdgeRuntimeProfile::from_name("edge-small").unwrap();
    let network = NetworkConfig::from_edge_profile(&profile).unwrap();
    assert_eq!(network.max_message_bytes, profile.max_frame_bytes);
    assert_eq!(
        network.connect_timeout,
        Duration::from_millis(profile.timeout.connect_ms)
    );
    assert_eq!(
        network.io_timeout,
        Duration::from_millis(profile.timeout.io_ms)
    );

    let secure = SecureNetworkConfig::for_edge_profile(
        &profile,
        SecurityConfig {
            profile: SecurityProfile::Standard,
            require_mtls: true,
            trust_domain: "edge.example".to_string(),
            ..SecurityConfig::default()
        },
        identity_policy(),
        CapabilityPolicy::new(None, None),
    )
    .unwrap();
    assert_eq!(secure.network, network);
}

#[test]
fn edge_transport_rejects_local_profile_downgrade() {
    let profile = EdgeRuntimeProfile::from_name("edge-small").unwrap();
    let error = SecureNetworkConfig::for_edge_profile(
        &profile,
        SecurityConfig {
            profile: SecurityProfile::Local,
            allow_insecure_loopback: true,
            trust_domain: "edge.example".to_string(),
            ..SecurityConfig::default()
        },
        identity_policy(),
        CapabilityPolicy::new(None, None),
    )
    .unwrap_err();
    assert_eq!(error.code, "edge_security_profile_mismatch");
}
