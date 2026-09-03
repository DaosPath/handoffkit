# handoffkit-transport

Experimental HK-CSP 1.0 transports for Rust. Includes bounded NDJSON framing,
stdin/stdout peers, local subprocess workers, Unix/WebSocket/TCP transports,
protocol negotiation, and safe shutdown. Protocol data uses stdout
exclusively; worker logs belong on stderr.

The maintained rustls/ring path supplies real TLS 1.3 client/listener sockets,
configured/native roots, hostname validation, mTLS, certificate-derived
identity, local capability authorization, process-local replay checks, and
structured timeout/authentication failures. It also supplies Ed25519 artifact
sign/verify through `ed25519-dalek`. Optional bounded/checksummed durable replay
and local revocation stores plus atomic certificate/trust reload with
transition-window rotation are integration-tested. Hybrid-PQ, CRL/OCSP, OS
keystores, zeroization guarantees, and general durable session/job recovery
remain unavailable.
